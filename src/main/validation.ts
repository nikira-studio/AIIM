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
  McpConnection,
  McpConnectionId,
  McpConnectionInput,
  McpToolDefinition,
  BuddyToolGrant,
  CapabilityActivity,
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
    world: parseBuddyWorld(value.world, value.era),
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
    chatTopics: parseChatTopics(value.chatTopics),
    participationStyle: parseParticipationStyle(value.participationStyle),
    checkInFrequency: parseCheckInFrequency(value.checkInFrequency),
  };
}

export function parseMcpConnectionInput(value: unknown): McpConnectionInput {
  if (!isRecord(value)) throw new Error("Enter valid connected-service details.");
  const transport = value.transport === "stdio" ? "stdio" : value.transport === "streamable-http" ? "streamable-http" : undefined;
  if (!transport) throw new Error("Choose a valid connection type.");
  const name = requiredString(value.name, "Service name");
  const input = { ...(typeof value.id === "string" ? { id: value.id as McpConnectionId } : {}), name, transport } satisfies McpConnectionInput;
  if (transport === "streamable-http") {
    const endpoint = normalizeMcpEndpoint(requiredString(value.endpoint, "Service address"));
    return { ...input, endpoint, ...(typeof value.bearerToken === "string" ? { bearerToken: value.bearerToken.trim() } : {}) };
  }
  const command = requiredString(value.command, "Program");
  const args = Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 32) : [];
  return { ...input, command, args };
}

export function normalizeMcpEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid service address."); }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.has(url.hostname.toLowerCase()))) throw new Error("Connected web services must use HTTPS. Plain HTTP is allowed only on this computer.");
  if (url.username || url.password || url.search || url.hash) throw new Error("The service address cannot include credentials, a query, or a fragment.");
  return url.toString();
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
    if (conversations.some((conversation) => conversationParticipants(conversation).some((id) => !buddyIds.has(id)))) {
      throw new Error("A conversation refers to a buddy that does not exist.");
    }

    const mcpConnections = Array.isArray(value.mcpConnections) ? value.mcpConnections.map(parseStoredMcpConnection) : [];
    requireUniqueIds(mcpConnections, "connected service");
    const connectionIds = new Set(mcpConnections.map((connection) => connection.id));
    const buddyToolGrants = Array.isArray(value.buddyToolGrants) ? value.buddyToolGrants.map(parseStoredBuddyToolGrant) : [];
    if (buddyToolGrants.some((grant) => !buddyIds.has(grant.buddyId) || !connectionIds.has(grant.connectionId))) throw new Error("A tool grant refers to a missing buddy or service.");
    const capabilityActivity = Array.isArray(value.capabilityActivity) ? value.capabilityActivity.map(parseStoredCapabilityActivity) : [];
    return { providers, buddies, conversations, profile: parseStoredProfile(value.profile), mcpConnections, buddyToolGrants, capabilityActivity };
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
    world: parseBuddyWorld(value.world, value.era),
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
    chatTopics: parseChatTopics(value.chatTopics).length ? parseChatTopics(value.chatTopics) : topicsFromInterests(storedString(value.profileInterests)),
    participationStyle: parseParticipationStyle(value.participationStyle),
    memories,
    memoryMode: value.memoryMode === "off" || value.memoryMode === "detailed" ? value.memoryMode : "normal",
    memoryStatus: parseMemoryStatus(value.memoryStatus),
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
    pinned: value.pinned === true,
  };
}

function parseStoredConversation(value: unknown): Conversation {
  if (!isRecord(value)) throw new Error("Invalid stored conversation.");
  const messages = requiredArray(value.messages, "Conversation messages").map(parseStoredMessage);
  requireUniqueIds(messages, "message");
  const summary = parseStoredSummary(value.summary, messages);
  const base = {
    id: storedId(value.id, "Conversation ID") as ConversationId,
    title: requiredString(value.title, "Conversation title"),
    createdAt: requiredDate(value.createdAt, "Conversation creation time"),
    updatedAt: requiredDate(value.updatedAt, "Conversation update time"),
    messages,
    ...(summary ? { summary } : {}),
  };
  if (value.kind === "buddy-chat") {
    const participantIds = requiredArray(value.participantIds, "Buddy Chat participants").map((id) => storedId(id, "Buddy Chat participant ID") as BuddyId);
    if (new Set(participantIds).size !== participantIds.length) throw new Error("Buddy Chat participants must be unique.");
    if (participantIds.length < 2) throw new Error("A Buddy Chat needs at least two participants.");
    if (messages.some((message) => message.buddyId && !participantIds.includes(message.buddyId))) throw new Error("A Buddy Chat message names a buddy outside the chat.");
    return { ...base, kind: "buddy-chat", participantIds };
  }
  return { ...base, kind: "direct", buddyId: storedId(value.buddyId, "Conversation buddy ID") as BuddyId };
}

function parseStoredMcpConnection(value: unknown): McpConnection {
  if (!isRecord(value)) throw new Error("Invalid connected service.");
  const id = storedId(value.id, "Connected service ID") as McpConnectionId;
  const parsed = parseMcpConnectionInput({ id, name: value.name, transport: value.transport, endpoint: value.endpoint, command: value.command, args: value.args });
  const tools = Array.isArray(value.tools) ? value.tools.map(parseStoredMcpTool) : [];
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error("Duplicate connected-service tool.");
  return {
    ...parsed,
    id,
    enabled: value.enabled === true,
    hasBearerToken: value.hasBearerToken === true,
    state: value.state === "ready" || value.state === "unavailable" || value.state === "needs-review" ? value.state : "disabled",
    ...(typeof value.lastError === "string" && value.lastError.trim() ? { lastError: value.lastError.trim().slice(0, 500) } : {}),
    tools,
    updatedAt: parseOptionalDate(value.updatedAt, "Connected-service update time") ?? new Date(0).toISOString(),
  };
}

function parseStoredMcpTool(value: unknown): McpToolDefinition {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name || !isRecord(value.inputSchema) || typeof value.fingerprint !== "string" || !value.fingerprint) throw new Error("Invalid connected-service tool.");
  return {
    name: value.name,
    ...(typeof value.title === "string" ? { title: value.title.slice(0, 400) } : {}),
    ...(typeof value.description === "string" ? { description: value.description.slice(0, 4_000) } : {}),
    inputSchema: value.inputSchema,
    ...(isRecord(value.outputSchema) ? { outputSchema: value.outputSchema } : {}),
    ...(isRecord(value.annotations) ? { annotations: value.annotations } : {}),
    fingerprint: value.fingerprint.slice(0, 128),
  };
}

function parseStoredBuddyToolGrant(value: unknown): BuddyToolGrant {
  if (!isRecord(value)) throw new Error("Invalid tool grant.");
  return {
    buddyId: storedId(value.buddyId, "Granted buddy") as BuddyId,
    connectionId: storedId(value.connectionId, "Granted service") as McpConnectionId,
    toolName: requiredString(value.toolName, "Granted tool").slice(0, 400),
    reviewedFingerprint: requiredString(value.reviewedFingerprint, "Granted tool fingerprint").slice(0, 128),
    grantedAt: requiredDate(value.grantedAt, "Tool grant time"),
    executionMode: value.executionMode === "trusted" ? "trusted" : "ask",
  };
}

function parseStoredCapabilityActivity(value: unknown): CapabilityActivity {
  if (!isRecord(value)) throw new Error("Invalid capability activity.");
  const decision = value.decision === "allowed" || value.decision === "denied" || value.decision === "failed" || value.decision === "completed" ? value.decision : undefined;
  if (!decision) throw new Error("Invalid capability activity.");
  return { id: storedId(value.id, "Capability activity ID"), createdAt: requiredDate(value.createdAt, "Capability activity time"), buddyId: storedId(value.buddyId, "Capability buddy") as BuddyId, connectionId: storedId(value.connectionId, "Capability service") as McpConnectionId, toolName: requiredString(value.toolName, "Capability tool").slice(0, 400), decision };
}

function conversationParticipants(conversation: Conversation): BuddyId[] { return conversation.kind === "direct" ? [conversation.buddyId] : conversation.participantIds; }
function parseChatTopics(value: unknown): string[] { return Array.isArray(value) ? value.filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0).map((topic) => topic.trim().slice(0, 100)).slice(0, 12) : []; }
function parseParticipationStyle(value: unknown): Buddy["participationStyle"] { return value === "quiet" || value === "eager" ? value : "normal"; }
function parseBuddyWorld(value: unknown, legacyEra: unknown): string { return optionalPlainString(value) ?? (legacyEra === "late-1990s" ? "Everyday life takes place in the late 1990s." : ""); }
function topicsFromInterests(interests: string): string[] { return interests.split(/[^\p{L}\p{N}]+/u).map((topic) => topic.trim().toLocaleLowerCase()).filter((topic) => topic.length >= 3).slice(0, 12); }

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
    ...(typeof value.buddyId === "string" ? { buddyId: storedId(value.buddyId, "Message buddy ID") as BuddyId } : {}),
    ...(typeof value.replyToMessageId === "string" ? { replyToMessageId: storedId(value.replyToMessageId, "Reply-to message ID") as MessageId } : {}),
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
    showMemoryUpdates: value.showMemoryUpdates === true,
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
    showMemoryUpdates: value.showMemoryUpdates === true,
  };
}

function parseMemoryStatus(value: unknown): Buddy["memoryStatus"] {
  if (!isRecord(value)) return { lastCheckedUserMessageCount: 0 };
  return {
    ...(parseOptionalDate(value.lastCheckedAt, "Memory check time") ? { lastCheckedAt: parseOptionalDate(value.lastCheckedAt, "Memory check time") } : {}),
    ...(parseOptionalDate(value.lastUpdatedAt, "Memory update time") ? { lastUpdatedAt: parseOptionalDate(value.lastUpdatedAt, "Memory update time") } : {}),
    ...(typeof value.lastError === "string" && value.lastError.trim() ? { lastError: value.lastError.trim().slice(0, 300) } : {}),
    lastCheckedUserMessageCount: typeof value.lastCheckedUserMessageCount === "number" && value.lastCheckedUserMessageCount >= 0 ? Math.floor(value.lastCheckedUserMessageCount) : 0,
  };
}

function parseStoredSummary(value: unknown, messages: ChatMessage[]): Conversation["summary"] {
  if (!isRecord(value) || typeof value.content !== "string" || !value.content.trim() || typeof value.throughMessageId !== "string" || !messages.some((message) => message.id === value.throughMessageId)) return undefined;
  const updatedAt = parseOptionalDate(value.updatedAt, "Summary update time");
  return updatedAt ? { content: value.content.trim().slice(0, 12_000), throughMessageId: value.throughMessageId as MessageId, updatedAt } : undefined;
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
