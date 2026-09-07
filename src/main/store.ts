import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type { AppSnapshot, Buddy, BuddyId, BuddyInput, ChatMessage, CheckInFrequency, Conversation, ConversationId, MemoryId, ProfileStatus, ProviderConfig, ProviderId, ProviderInput, ProviderKind, UserProfileInput } from "../shared/types";
import { nextCheckInDate } from "../shared/check-ins";
import { buddyPresence } from "../shared/presence";
import { parseStoredSnapshot } from "./validation";

interface StoredDocument { version: 1; snapshot: AppSnapshot; }
interface CredentialBinding { kind: ProviderKind; baseUrl: string; }
interface StoredCredential extends CredentialBinding { value: string; }
type SecretMap = Record<string, StoredCredential>;

export class AppStore {
  private snapshotValue: AppSnapshot = emptySnapshot();
  private secrets: SecretMap = {};
  private persistQueue: Promise<void> = Promise.resolve();
  private startupNoticeValue: string | undefined;
  constructor(private readonly directory: string) {}

  async load(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    this.snapshotValue = await this.readSnapshot();
    this.secrets = await this.readSecrets();
    syncKeyFlags(this.snapshotValue, this.secrets);
  }

  snapshot(): AppSnapshot { return structuredClone(this.snapshotValue); }

  takeStartupNotice(): string | undefined {
    const notice = this.startupNoticeValue;
    this.startupNoticeValue = undefined;
    return notice;
  }

  async replaceSnapshot(snapshot: AppSnapshot): Promise<AppSnapshot> {
    const previousProviders = new Map(this.snapshotValue.providers.map((provider) => [provider.id, provider]));
    const nextSnapshot = structuredClone(snapshot);
    const nextSecrets = { ...this.secrets };
    for (const [id, previous] of previousProviders) {
      const restored = nextSnapshot.providers.find((provider) => provider.id === id);
      if (!restored || !sameCredentialTarget(previous, restored)) {
        delete nextSecrets[id];
      }
    }
    syncKeyFlags(nextSnapshot, nextSecrets);
    if (!sameSecrets(this.secrets, nextSecrets)) await this.writeSecrets(nextSecrets);
    await this.persist(nextSnapshot);
    this.secrets = nextSecrets;
    this.snapshotValue = nextSnapshot;
    return this.snapshot();
  }

  async saveProvider(input: ProviderInput): Promise<AppSnapshot> {
    const id = input.id ?? (randomUUID() as ProviderId);
    const current = this.snapshotValue.providers.find((provider) => provider.id === id);
    const provider: ProviderConfig = {
      id,
      kind: input.kind,
      name: input.name,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      hasApiKey: false,
    };
    const nextSecrets = { ...this.secrets };
    if (current && !sameCredentialTarget(current, provider) && !input.apiKey) {
      delete nextSecrets[id];
    }
    if (input.apiKey) {
      nextSecrets[id] = { ...credentialBinding(provider), value: input.apiKey };
    }
    const nextSnapshot = structuredClone(this.snapshotValue);
    nextSnapshot.providers = current
      ? nextSnapshot.providers.map((item) => item.id === id ? provider : item)
      : [...nextSnapshot.providers, provider];
    syncKeyFlags(nextSnapshot, nextSecrets);
    if (!sameSecrets(this.secrets, nextSecrets)) await this.writeSecrets(nextSecrets);
    await this.persist(nextSnapshot);
    this.secrets = nextSecrets;
    this.snapshotValue = nextSnapshot;
    return this.snapshot();
  }

  async removeProvider(id: ProviderId): Promise<AppSnapshot> {
    if (this.snapshotValue.buddies.some((buddy) => buddy.providerId === id)) throw new Error("Remove or edit this provider's buddies first.");
    const nextSecrets = { ...this.secrets };
    delete nextSecrets[id];
    const nextSnapshot = structuredClone(this.snapshotValue);
    nextSnapshot.providers = nextSnapshot.providers.filter((provider) => provider.id !== id);
    if (!sameSecrets(this.secrets, nextSecrets)) await this.writeSecrets(nextSecrets);
    await this.persist(nextSnapshot);
    this.secrets = nextSecrets;
    this.snapshotValue = nextSnapshot;
    return this.snapshot();
  }

  apiKey(id: ProviderId): string | undefined {
    const provider = this.snapshotValue.providers.find((item) => item.id === id);
    return provider ? credentialValue(this.secrets[id], provider) : undefined;
  }

  async saveBuddy(input: BuddyInput): Promise<AppSnapshot> {
    if (!this.snapshotValue.providers.some((provider) => provider.id === input.providerId)) throw new Error("That provider no longer exists.");
    const id = input.id ?? (randomUUID() as BuddyId);
    const existing = this.snapshotValue.buddies.find((buddy) => buddy.id === id);
    const frequencyChanged = existing?.checkInFrequency !== input.checkInFrequency;
    const nextCheckInAt = input.checkInFrequency === "off" ? undefined : frequencyChanged || !existing?.nextCheckInAt ? nextCheckInDate(input.checkInFrequency).toISOString() : existing.nextCheckInAt;
    const buddy: Buddy = { ...input, id, status: existing?.status ?? "available", memories: existing?.memories ?? [], ...(nextCheckInAt ? { nextCheckInAt } : {}), ...(existing?.activeUntil ? { activeUntil: existing.activeUntil } : {}) };
    this.snapshotValue.buddies = existing
      ? this.snapshotValue.buddies.map((item) => item.id === id ? buddy : item)
      : [...this.snapshotValue.buddies, buddy];
    await this.persist();
    return this.snapshot();
  }

  async removeBuddy(id: BuddyId): Promise<AppSnapshot> {
    this.snapshotValue.buddies = this.snapshotValue.buddies.filter((buddy) => buddy.id !== id);
    this.snapshotValue.conversations = this.snapshotValue.conversations.filter((conversation) => conversation.buddyId !== id);
    await this.persist();
    return this.snapshot();
  }

  async newConversation(buddyId: BuddyId): Promise<Conversation> {
    const buddy = this.snapshotValue.buddies.find((item) => item.id === buddyId);
    if (!buddy) throw new Error("That buddy no longer exists.");
    const now = new Date().toISOString();
    const conversation: Conversation = { id: randomUUID() as ConversationId, buddyId, title: `Chat with ${buddy.displayName}`, createdAt: now, updatedAt: now, messages: [] };
    this.snapshotValue.conversations.unshift(conversation);
    await this.persist();
    return structuredClone(conversation);
  }

  conversation(id: ConversationId): Conversation {
    const conversation = this.snapshotValue.conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("Conversation not found.");
    return conversation;
  }

  latestConversation(buddyId: BuddyId): Conversation | undefined {
    return this.snapshotValue.conversations.find((conversation) => conversation.buddyId === buddyId);
  }

  buddy(id: BuddyId): Buddy {
    const buddy = this.snapshotValue.buddies.find((item) => item.id === id);
    if (!buddy) throw new Error("Buddy not found.");
    return buddy;
  }

  provider(id: ProviderId): ProviderConfig {
    const provider = this.snapshotValue.providers.find((item) => item.id === id);
    if (!provider) throw new Error("Provider not found.");
    return provider;
  }

  async addMessage(conversationId: ConversationId, message: ChatMessage): Promise<void> {
    const conversation = this.conversation(conversationId);
    conversation.messages.push(message);
    conversation.updatedAt = message.createdAt;
    if (conversation.messages.length === 1) conversation.title = message.content.slice(0, 52) || conversation.title;
    await this.persist();
  }

  async completeAssistant(conversationId: ConversationId, message: ChatMessage): Promise<void> {
    const conversation = this.conversation(conversationId);
    conversation.messages.push(message);
    conversation.updatedAt = message.createdAt;
    this.snapshotValue.conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    await this.persist();
  }

  async removeTrailingError(conversationId: ConversationId): Promise<void> {
    const conversation = this.conversation(conversationId);
    if (conversation.messages.at(-1)?.state !== "error") return;
    conversation.messages.pop();
    conversation.updatedAt = conversation.messages.at(-1)?.createdAt ?? conversation.createdAt;
    await this.persist();
  }

  async deleteConversation(id: ConversationId): Promise<AppSnapshot> {
    this.snapshotValue.conversations = this.snapshotValue.conversations.filter((conversation) => conversation.id !== id);
    await this.persist();
    return this.snapshot();
  }

  async clearConversation(id: ConversationId): Promise<AppSnapshot> {
    const conversation = this.conversation(id);
    const buddy = this.buddy(conversation.buddyId);
    const now = new Date().toISOString();
    conversation.messages = [];
    conversation.title = `Chat with ${buddy.displayName}`;
    conversation.updatedAt = now;
    await this.persist();
    return this.snapshot();
  }

  async clearAllHistory(): Promise<AppSnapshot> {
    this.snapshotValue.conversations = [];
    await this.persist();
    return this.snapshot();
  }

  async saveBuddyMemories(id: BuddyId, entries: string[]): Promise<AppSnapshot> {
    const buddy = this.buddy(id);
    const now = new Date().toISOString();
    const unique = [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))].slice(-30);
    buddy.memories = unique.map((text) => {
      const existing = buddy.memories.find((memory) => memory.text.toLowerCase() === text.toLowerCase());
      return existing ?? { id: randomUUID() as MemoryId, text: text.slice(0, 500), createdAt: now };
    });
    await this.persist();
    return this.snapshot();
  }

  async addMemories(id: BuddyId, entries: string[]): Promise<void> {
    const buddy = this.buddy(id);
    await this.saveBuddyMemories(id, [...buddy.memories.map((memory) => memory.text), ...entries]);
  }

  async markBuddyActive(id: BuddyId, durationMs = 10 * 60_000): Promise<void> {
    this.buddy(id).activeUntil = new Date(Date.now() + durationMs).toISOString();
    await this.persist();
  }

  async setProfileStatus(status: ProfileStatus): Promise<AppSnapshot> {
    this.snapshotValue.profile.status = status;
    if (status === "available") {
      const now = Date.now();
      for (const buddy of this.snapshotValue.buddies) {
        if (buddy.checkInFrequency !== "off" && (!buddy.nextCheckInAt || Date.parse(buddy.nextCheckInAt) <= now)) buddy.nextCheckInAt = nextCheckInDate(buddy.checkInFrequency).toISOString();
      }
    }
    await this.persist();
    return this.snapshot();
  }

  async saveProfile(input: UserProfileInput): Promise<AppSnapshot> {
    this.snapshotValue.profile = { ...input, status: this.snapshotValue.profile.status };
    await this.persist();
    return this.snapshot();
  }

  dueCheckIn(now = new Date()): Buddy | undefined {
    if (this.snapshotValue.profile.status !== "available" || now.getHours() < 9 || now.getHours() >= 21) return undefined;
    return this.snapshotValue.buddies.find((buddy) => buddyPresence(buddy, now).state !== "offline" && buddy.checkInFrequency !== "off" && buddy.nextCheckInAt !== undefined && Date.parse(buddy.nextCheckInAt) <= now.getTime());
  }

  async scheduleNextCheckIn(id: BuddyId): Promise<void> {
    const buddy = this.buddy(id);
    if (buddy.checkInFrequency === "off") delete buddy.nextCheckInAt;
    else buddy.nextCheckInAt = nextCheckInDate(buddy.checkInFrequency).toISOString();
    await this.persist();
  }

  private async readSnapshot(): Promise<AppSnapshot> {
    const target = path.join(this.directory, "chats.json");
    const backup = path.join(this.directory, "chats.backup.json");
    try { return await readStoredSnapshot(target); }
    catch (error) {
      if (isMissingFile(error)) {
        try {
          const recovered = await readStoredSnapshot(backup);
          this.startupNoticeValue = "AIIM restored your saved data from its automatic backup.";
          return recovered;
        } catch (backupError) {
          if (isMissingFile(backupError)) return emptySnapshot();
          throw backupError;
        }
      }
      const damaged = path.join(this.directory, `chats.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      await fs.rename(target, damaged).catch(() => undefined);
      try {
        const recovered = await readStoredSnapshot(backup);
        this.startupNoticeValue = "AIIM found a damaged history file and restored the latest automatic backup. The damaged file was kept for recovery.";
        return recovered;
      } catch (backupError) {
        if (!isMissingFile(backupError)) throw backupError;
        this.startupNoticeValue = "AIIM found a damaged history file. It was kept for recovery, and AIIM started with an empty buddy list.";
        return emptySnapshot();
      }
    }
  }

  private async readSecrets(): Promise<SecretMap> {
    try {
      const encrypted = await fs.readFile(path.join(this.directory, "credentials.bin"));
      if (!safeStorage.isEncryptionAvailable()) return {};
      const raw: unknown = JSON.parse(safeStorage.decryptString(encrypted));
      const parsed = parseStoredSecrets(raw);
      if (parsed.legacyCredentialsDiscarded) {
        this.startupNoticeValue = "AIIM signed out saved API keys to complete a security upgrade. Re-enter keys for providers you still use.";
      }
      return parsed.secrets;
    } catch (error) {
      if (!isMissingFile(error)) return {};
      return {};
    }
  }

  private async persist(snapshot = this.snapshotValue): Promise<void> {
    const target = path.join(this.directory, "chats.json");
    const backup = path.join(this.directory, "chats.backup.json");
    const serialized = JSON.stringify({ version: 1, snapshot } satisfies StoredDocument, null, 2);
    const operation = this.persistQueue.catch(() => undefined).then(async () => {
      const temporary = path.join(this.directory, `chats.${randomUUID()}.tmp`);
      const file = await fs.open(temporary, "wx");
      try {
        await file.writeFile(serialized, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      try { await fs.copyFile(target, backup); }
      catch (error) { if (!isMissingFile(error)) { await fs.rm(temporary, { force: true }); throw error; } }
      try { await fs.rename(temporary, target); }
      catch (error) {
        if (!isReplaceConflict(error)) { await fs.rm(temporary, { force: true }); throw error; }
        await fs.rm(target, { force: true });
        await fs.rename(temporary, target);
      }
    });
    this.persistQueue = operation;
    await operation;
  }

  private async writeSecrets(secrets: SecretMap): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    await fs.writeFile(path.join(this.directory, "credentials.bin"), safeStorage.encryptString(JSON.stringify(secrets)));
  }
}

function credentialBinding(provider: Pick<ProviderConfig, "kind" | "baseUrl">): CredentialBinding {
  return { kind: provider.kind, baseUrl: provider.baseUrl ?? "" };
}

function sameCredentialTarget(left: Pick<ProviderConfig, "kind" | "baseUrl">, right: Pick<ProviderConfig, "kind" | "baseUrl">): boolean {
  const leftBinding = credentialBinding(left);
  const rightBinding = credentialBinding(right);
  return leftBinding.kind === rightBinding.kind && leftBinding.baseUrl === rightBinding.baseUrl;
}

function sameSecrets(left: SecretMap, right: SecretMap): boolean {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length && leftEntries.every(([id, value]) => {
    const next = right[id];
    return next?.value === value.value && next.kind === value.kind && next.baseUrl === value.baseUrl;
  });
}

function credentialValue(credential: StoredCredential | undefined, provider: ProviderConfig): string | undefined {
  if (!credential || provider.kind === "ollama" || provider.kind === "openai-subscription") return undefined;
  const binding = credentialBinding(provider);
  return credential.kind === binding.kind && credential.baseUrl === binding.baseUrl ? credential.value : undefined;
}

function syncKeyFlags(snapshot: AppSnapshot, secrets: SecretMap): void {
  snapshot.providers = snapshot.providers.map((provider) => ({ ...provider, hasApiKey: Boolean(credentialValue(secrets[provider.id], provider)) }));
}

function parseStoredSecrets(value: unknown): { secrets: SecretMap; legacyCredentialsDiscarded: boolean } {
  if (!isRecord(value)) return { secrets: {}, legacyCredentialsDiscarded: false };
  let legacyCredentialsDiscarded = false;
  const secrets: SecretMap = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (typeof candidate === "string") { legacyCredentialsDiscarded = true; continue; }
    if (!isRecord(candidate) || typeof candidate.value !== "string" || !isProviderKind(candidate.kind) || typeof candidate.baseUrl !== "string") continue;
    secrets[id] = { value: candidate.value, kind: candidate.kind, baseUrl: candidate.baseUrl };
  }
  return { secrets, legacyCredentialsDiscarded };
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === "openai" || value === "openai-subscription" || value === "anthropic" || value === "google" || value === "minimax" || value === "ollama" || value === "openrouter" || value === "openai-compatible";
}

function emptySnapshot(): AppSnapshot {
  return { providers: [], buddies: [], conversations: [], profile: { screenName: "me", displayName: "Me", pronouns: "", location: "", interests: "", aboutMe: "", status: "available" } };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isReplaceConflict(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "EPERM");
}

async function readStoredSnapshot(file: string): Promise<AppSnapshot> {
  const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!isRecord(raw) || raw.version !== 1 || !("snapshot" in raw)) throw new Error("The AIIM data file has an unsupported format.");
  const snapshot = parseStoredSnapshot(raw.snapshot, { managedPortraitDirectory: path.join(path.dirname(file), "portraits") });
  if (!snapshot) throw new Error("The AIIM data file is incomplete or damaged.");
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
