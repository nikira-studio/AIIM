import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppSnapshot,
  Buddy,
  BuddyFont,
  BuddyId,
  BuddyInput,
  BuddyMemory,
  BuddySound,
  ChatMessage,
  CheckInFrequency,
  Conversation,
  ConversationId,
  MemoryId,
  MessageId,
  PresencePattern,
  ProviderConfig,
  ProviderId,
  ProviderInput,
  ProviderKind,
  ReasoningEffort,
  UserProfile,
  UserProfileInput,
} from "../shared/types";

const providerKinds = ["openai", "openai-subscription", "anthropic", "google", "minimax", "ollama", "openrouter", "openai-compatible"] as const satisfies readonly ProviderKind[];
const fixedEndpointKinds: readonly ProviderKind[] = ["openai", "openai-subscription", "anthropic", "google", "minimax", "openrouter"];

export interface SnapshotParseOptions {
  managedPortraitDirectory?: string;
}

export function parseProviderInput(value: unknown): ProviderInput {
  if (!isRecord(value) || !isProviderKind(value.kind)) throw new Error("Choose a valid provider type.");
  const kind = value.kind;
  const name = requiredString(value.name, "Provider name");
  const suppliedBaseUrl = optionalString(value.baseUrl);

  if (fixedEndpointKinds.includes(kind) && suppliedBaseUrl) {
    throw new Error("This provider uses its official service address and cannot use a custom base URL.");
  }

  const baseUrl = kind === "ollama"
    ? normalizeOllamaBaseUrl(suppliedBaseUrl)
    : kind === "openai-compatible"
      ? normalizeCompatibleBaseUrl(suppliedBaseUrl)
      : undefined;

  return {
    ...(typeof value.id === "string" ? { id: value.id as ProviderInput["id"] } : {}),
    kind,
    name,
    ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey.trim() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function normalizeOllamaBaseUrl(value?: string): string {
  const raw = value?.trim() || "http://localhost:11434";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new Error("Enter a valid Ollama address, such as http://localhost:11434."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("The Ollama address must start with http:// or https://.");
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/(?:api(?:\/(?:chat|tags))?|v1)\/?$/i, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeCompatibleBaseUrl(value?: string): string {
  if (!value) throw new Error("A base URL is required for a compatible provider.");
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("Enter a valid compatible provider URL."); }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname.toLowerCase()))) {
    throw new Error("Compatible providers must use HTTPS. Plain HTTP is allowed only for this computer.");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeLegacyInsecureCompatibleBaseUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid stored provider.");
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("Invalid stored provider."); }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol !== "http:" || loopbackHosts.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    throw new Error("Invalid stored provider.");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function parseBuddyInput(value: unknown, options: SnapshotParseOptions = {}): BuddyInput {
  if (!isRecord(value)) throw new Error("Invalid buddy details.");
  const avatarUrl = parseBuddyAvatarUrl(value.avatarUrl, options.managedPortraitDirectory);
  return {
    ...(typeof value.id === "string" ? { id: value.id as BuddyInput["id"] } : {}),
    screenName: requiredString(value.screenName, "Screen name").replace(/\s+/g, ""),
    displayName: requiredString(value.displayName, "Display name"),
    providerId: requiredString(value.providerId, "Provider") as BuddyInput["providerId"],
    modelId: requiredString(value.modelId, "Model"),
    reasoningEffort: parseReasoningEffort(value.reasoningEffort),
    systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt.trim() : "",
    group: typeof value.group === "string" && value.group.trim() ? value.group.trim() : "AI Buddies",
    color: /^#[0-9a-f]{6}$/i.test(String(value.color)) ? String(value.color) : "#2046a0",
    statusMessage: optionalString(value.statusMessage) ?? "Available",
    awayMessage: optionalString(value.awayMessage) ?? "Away from the computer.",
    typingStyle: value.typingStyle === "quick" || value.typingStyle === "thoughtful" ? value.typingStyle : "measured",
    ...(avatarUrl ? { avatarUrl } : {}),
    profileBio: optionalString(value.profileBio) ?? "",
    profileLocation: optionalString(value.profileLocation) ?? "",
    profileInterests: optionalString(value.profileInterests) ?? "",
    profileQuote: optionalString(value.profileQuote) ?? "",
    presencePattern: parsePresencePattern(value.presencePattern),
    notificationSound: parseBuddySound(value.notificationSound),
    fontFamily: parseBuddyFont(value.fontFamily),
    fontColor: /^#[0-9a-f]{6}$/i.test(String(value.fontColor)) ? String(value.fontColor) : "#1b489a",
    userRole: optionalString(value.userRole) ?? "",
    relationshipNotes: optionalString(value.relationshipNotes) ?? "",
    checkInFrequency: parseCheckInFrequency(value.checkInFrequency),
  };
}

export function parseStoredSnapshot(value: unknown, options: SnapshotParseOptions = {}): AppSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.buddies) || !Array.isArray(value.conversations)) return undefined;
  try {
    const providers = value.providers.map(parseStoredProvider);
    requireUniqueIds(providers, "provider");
    const providerIds = new Set(providers.map(({ id }) => id));

    const buddies = value.buddies.map((buddy) => parseStoredBuddy(buddy, options));
    requireUniqueIds(buddies, "buddy");
    if (buddies.some(({ providerId }) => !providerIds.has(providerId))) {
      throw new Error("A buddy refers to a provider that does not exist.");
    }
    const buddyIds = new Set(buddies.map(({ id }) => id));

    const conversations = value.conversations.map(parseStoredConversation);
    requireUniqueIds(conversations, "conversation");
    if (conversations.some(({ buddyId }) => !buddyIds.has(buddyId))) {
      throw new Error("A conversation refers to a buddy that does not exist.");
    }

    return { providers, buddies, conversations, profile: parseStoredProfile(value.profile) };
  } catch {
    return undefined;
  }
}

function parseStoredProvider(value: unknown): ProviderConfig {
  if (!isRecord(value)) throw new Error("Invalid stored provider.");
  const id = storedId(value.id, "Provider ID") as ProviderId;
  try {
    const parsed = parseProviderInput({ id, kind: value.kind, name: value.name, baseUrl: value.baseUrl });
    return { ...parsed, id, hasApiKey: false };
  } catch (error) {
    if (value.kind !== "openai-compatible") throw error;
    return {
      id,
      kind: "openai-compatible",
      name: requiredString(value.name, "Provider name"),
      baseUrl: normalizeLegacyInsecureCompatibleBaseUrl(value.baseUrl),
      hasApiKey: false,
      disabledReason: "This older HTTP provider was disabled for security. Edit it and use HTTPS or a loopback address before sending messages.",
    };
  }
}

function parseStoredBuddy(value: unknown, options: SnapshotParseOptions): Buddy {
  if (!isRecord(value)) throw new Error("Invalid stored buddy.");
  const memories = value.memories === undefined ? [] : requiredArray(value.memories, "Buddy memories").map(parseStoredMemory);
  requireUniqueIds(memories, "memory");
  const avatarUrl = parseStoredAvatarUrl(value.avatarUrl, options.managedPortraitDirectory);
  const nextCheckInAt = parseOptionalDate(value.nextCheckInAt, "Next check-in");
  const activeUntil = parseOptionalDate(value.activeUntil, "Active-until time");
  return {
    id: storedId(value.id, "Buddy ID") as BuddyId,
    screenName: requiredString(value.screenName, "Screen name").replace(/\s+/g, ""),
    displayName: requiredString(value.displayName, "Display name"),
    providerId: storedId(value.providerId, "Buddy provider ID") as ProviderId,
    modelId: requiredString(value.modelId, "Buddy model"),
    reasoningEffort: parseReasoningEffort(value.reasoningEffort),
    systemPrompt: storedString(value.systemPrompt),
    group: optionalPlainString(value.group) ?? "AI Buddies",
    color: parseColor(value.color, "#2046a0"),
    status: value.status === "away" ? "away" : "available",
    statusMessage: optionalPlainString(value.statusMessage) ?? "Available",
    awayMessage: optionalPlainString(value.awayMessage) ?? "Away from the computer.",
    typingStyle: value.typingStyle === "quick" || value.typingStyle === "thoughtful" ? value.typingStyle : "measured",
    ...(avatarUrl ? { avatarUrl } : {}),
    profileBio: storedString(value.profileBio),
    profileLocation: storedString(value.profileLocation),
    profileInterests: storedString(value.profileInterests),
    profileQuote: storedString(value.profileQuote),
    presencePattern: parsePresencePattern(value.presencePattern),
    notificationSound: parseBuddySound(value.notificationSound),
    fontFamily: parseBuddyFont(value.fontFamily),
    fontColor: parseColor(value.fontColor, "#1b489a"),
    userRole: storedString(value.userRole),
    relationshipNotes: storedString(value.relationshipNotes),
    memories,
    checkInFrequency: parseCheckInFrequency(value.checkInFrequency),
    ...(nextCheckInAt ? { nextCheckInAt } : {}),
    ...(activeUntil ? { activeUntil } : {}),
  };
}

function parseStoredMemory(value: unknown): BuddyMemory {
  if (!isRecord(value)) throw new Error("Invalid stored memory.");
  return {
    id: storedId(value.id, "Memory ID") as MemoryId,
    text: requiredString(value.text, "Memory text"),
    createdAt: requiredDate(value.createdAt, "Memory creation time"),
  };
}

function parseStoredConversation(value: unknown): Conversation {
  if (!isRecord(value)) throw new Error("Invalid stored conversation.");
  const messages = requiredArray(value.messages, "Conversation messages").map(parseStoredMessage);
  requireUniqueIds(messages, "message");
  return {
    id: storedId(value.id, "Conversation ID") as ConversationId,
    buddyId: storedId(value.buddyId, "Conversation buddy ID") as BuddyId,
    title: requiredString(value.title, "Conversation title"),
    createdAt: requiredDate(value.createdAt, "Conversation creation time"),
    updatedAt: requiredDate(value.updatedAt, "Conversation update time"),
    messages,
  };
}

function parseStoredMessage(value: unknown): ChatMessage {
  if (!isRecord(value)) throw new Error("Invalid stored message.");
  if (value.role !== "user" && value.role !== "assistant") throw new Error("Invalid stored message role.");
  if (value.state !== "complete" && value.state !== "streaming" && value.state !== "error") throw new Error("Invalid stored message state.");
  return {
    id: storedId(value.id, "Message ID") as MessageId,
    role: value.role,
    content: storedString(value.content),
    createdAt: requiredDate(value.createdAt, "Message creation time"),
    state: value.state,
  };
}

function parseStoredProfile(value: unknown): UserProfile {
  if (!isRecord(value)) throw new Error("Invalid stored profile.");
  const screenName = requiredString(value.screenName, "Profile screen name").replace(/\s+/g, "");
  if (!screenName) throw new Error("Profile screen name is required.");
  return {
    screenName,
    displayName: optionalPlainString(value.displayName) ?? screenName,
    pronouns: storedString(value.pronouns),
    location: storedString(value.location),
    interests: storedString(value.interests),
    aboutMe: storedString(value.aboutMe),
    status: value.status === "away" ? "away" : "available",
  };
}

export function parseUserProfileInput(value: unknown): UserProfileInput {
  if (!isRecord(value)) throw new Error("Invalid profile details.");
  const screenName = requiredString(value.screenName, "Screen name").replace(/\s+/g, "");
  return {
    screenName,
    displayName: optionalString(value.displayName) ?? screenName,
    pronouns: optionalString(value.pronouns) ?? "",
    location: optionalString(value.location) ?? "",
    interests: optionalString(value.interests) ?? "",
    aboutMe: optionalString(value.aboutMe) ?? "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && providerKinds.some((kind) => kind === value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function storedId(value: unknown, label: string): string {
  const id = requiredString(value, label);
  if (id.length > 200 || id === "__proto__" || id === "constructor" || id === "prototype") throw new Error(`${label} is invalid.`);
  return id;
}

function storedString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalPlainString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  return value;
}

function requiredDate(value: unknown, label: string): string {
  const date = requiredString(value, label);
  if (!Number.isFinite(Date.parse(date))) throw new Error(`${label} is invalid.`);
  return date;
}

function parseOptionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredDate(value, label);
}

function parseStoredAvatarUrl(value: unknown, managedPortraitDirectory?: string): string | undefined {
  const avatarUrl = optionalPlainString(value);
  if (!avatarUrl) return undefined;
  if (/^file:/i.test(avatarUrl)) return managedPortraitUrl(avatarUrl, managedPortraitDirectory);
  if (/^[a-z][a-z\d+.-]*:/i.test(avatarUrl)) throw new Error("Stored buddy portraits must be local files.");
  const normalized = avatarUrl.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Stored buddy portrait path is invalid.");
  return avatarUrl;
}

function parseBuddyAvatarUrl(value: unknown, managedPortraitDirectory?: string): string | undefined {
  const avatarUrl = optionalPlainString(value);
  if (!avatarUrl) return undefined;
  if (/^file:/i.test(avatarUrl)) {
    const managed = managedPortraitUrl(avatarUrl, managedPortraitDirectory);
    if (!managed) throw new Error("Buddy portraits must be chosen through AIIM or imported from a character file.");
    return managed;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(avatarUrl)) throw new Error("Buddy portraits must be local files.");
  const normalized = avatarUrl.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Buddy portrait path is invalid.");
  return avatarUrl;
}

function managedPortraitUrl(value: string, managedPortraitDirectory?: string): string | undefined {
  if (!managedPortraitDirectory) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:" || parsed.hostname) return undefined;
    const source = fileURLToPath(parsed);
    const directory = path.resolve(managedPortraitDirectory);
    const relative = path.relative(directory, path.resolve(source));
    const validExtension = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(source).toLowerCase());
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || !validExtension) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function parseColor(value: unknown, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
}

function requireUniqueIds(values: ReadonlyArray<{ id: string }>, label: string): void {
  if (new Set(values.map(({ id }) => id)).size !== values.length) throw new Error(`Duplicate ${label} ID.`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\/$/, "") : undefined;
}

function parsePresencePattern(value: unknown): PresencePattern { return value === "daytime" || value === "evening" || value === "varied" ? value : "always"; }
function parseBuddySound(value: unknown): BuddySound { return value === "soft" || value === "digital" || value === "none" ? value : "classic"; }
function parseBuddyFont(value: unknown): BuddyFont { return value === "Verdana" || value === "Arial" || value === "Georgia" || value === "Courier New" ? value : "Tahoma"; }
function parseCheckInFrequency(value: unknown): CheckInFrequency { return value === "rare" || value === "occasional" ? value : "off"; }
function parseReasoningEffort(value: unknown): ReasoningEffort { return value === "none" || value === "low" || value === "high" || value === "xhigh" || value === "max" ? value : "medium"; }
