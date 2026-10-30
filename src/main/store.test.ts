import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuddyInput, MessageId } from "../shared/types";
import { AppStore } from "./store";

const encryption = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  encryption.available = true;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function testStore(): Promise<{ store: AppStore; directory: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-store-"));
  temporaryDirectories.push(directory);
  const store = new AppStore(directory);
  await store.load();
  const snapshot = await store.saveProvider({ kind: "minimax", name: "MiniMax" });
  const provider = snapshot.providers[0];
  if (!provider) throw new Error("Test provider was not saved.");
  const buddy: BuddyInput = {
    screenName: "friend",
    displayName: "Friend",
    providerId: provider.id,
    modelId: "MiniMax-M3",
    reasoningEffort: "medium",
    systemPrompt: "Be a friend.",
    group: "Friends",
    color: "#2046a0",
    statusMessage: "Available",
    awayMessage: "Away",
    typingStyle: "measured",
    profileBio: "",
    profileLocation: "",
    profileInterests: "",
    profileQuote: "",
    presencePattern: "always",
    notificationSound: "none",
    fontFamily: "Tahoma",
    fontColor: "#1b489a",
    relationshipNotes: "",
    chatTopics: [],
    participationStyle: "normal",
    checkInFrequency: "off",
  };
  await store.saveBuddy(buddy);
  return { store, directory };
}

describe("Windows chat persistence", () => {
  it("accepts a new message immediately after history is cleared", async () => {
    const { store } = await testStore();
    const buddy = store.snapshot().buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    const conversation = await store.newConversation(buddy.id);
    await store.addMessage(conversation.id, { id: "before" as MessageId, role: "user", content: "old", createdAt: new Date().toISOString(), state: "complete" });
    await store.clearConversation(conversation.id);
    await store.addMessage(conversation.id, { id: "after" as MessageId, role: "user", content: "new", createdAt: new Date().toISOString(), state: "complete" });
    expect(store.conversation(conversation.id).messages.map(({ content }) => content)).toEqual(["new"]);
    expect(store.conversation(conversation.id).summary).toBeUndefined();
  });

  it("keeps memory mode and pinned facts across a restart", async () => {
    const { store, directory } = await testStore();
    const buddy = store.snapshot().buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    await store.saveBuddyMemories(buddy.id, "detailed", [{ text: "Alex prefers old computers.", pinned: true }]);

    const restarted = new AppStore(directory);
    await restarted.load();
    expect(restarted.snapshot().buddies[0]).toMatchObject({ memoryMode: "detailed", memories: [{ text: "Alex prefers old computers.", pinned: true }] });
  });

  it("persists an availability change over an existing history file", async () => {
    const { store } = await testStore();
    await store.setProfileStatus("away");
    expect(store.snapshot().profile.status).toBe("away");
  });

  it("removes a buddy and all of that buddy's conversations together", async () => {
    const { store } = await testStore();
    const buddy = store.snapshot().buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    await store.newConversation(buddy.id);
    await store.removeBuddy(buddy.id);
    expect(store.snapshot().buddies).toHaveLength(0);
    expect(store.snapshot().conversations).toHaveLength(0);
  });

  it("keeps the complete profile, chat, memory, presence, and restart lifecycle coherent", async () => {
    const { store, directory } = await testStore();
    const buddy = store.snapshot().buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    const conversation = await store.newConversation(buddy.id);
    await store.addMessage(conversation.id, { id: "hello" as MessageId, role: "user", content: "I restore old computers.", createdAt: "2026-09-04T12:00:00.000Z", state: "complete" });
    await store.completeAssistant(conversation.id, { id: "reply" as MessageId, role: "assistant", content: "That suits you.", createdAt: "2026-09-04T12:00:02.000Z", state: "complete" });
    await store.addMemories(buddy.id, ["The user restores old computers."]);
    await store.saveProfile({ screenName: "retrofan", displayName: "Alex", pronouns: "they/them", location: "Example City", interests: "Old computers", aboutMe: "Likes practical projects." });
    await store.setProfileStatus("away");

    const restarted = new AppStore(directory);
    await restarted.load();
    const restored = restarted.snapshot();
    expect(restored.profile).toMatchObject({ screenName: "retrofan", displayName: "Alex", status: "away" });
    expect(restored.buddies[0]?.memories.map((memory) => memory.text)).toEqual(["The user restores old computers."]);
    expect(restored.conversations[0]?.messages.map((message) => message.content)).toEqual(["I restore old computers.", "That suits you."]);

    await restarted.clearConversation(conversation.id);
    await restarted.addMessage(conversation.id, { id: "new-start" as MessageId, role: "user", content: "Fresh start.", createdAt: "2026-09-04T13:00:00.000Z", state: "complete" });
    expect(restarted.conversation(conversation.id).messages.map((message) => message.content)).toEqual(["Fresh start."]);
    await restarted.removeBuddy(buddy.id);

    const finalRestart = new AppStore(directory);
    await finalRestart.load();
    expect(finalRestart.snapshot().buddies).toHaveLength(0);
    expect(finalRestart.snapshot().conversations).toHaveLength(0);
  });

  it("restores the automatic backup when the main history file is damaged", async () => {
    const { store, directory } = await testStore();
    await store.saveProfile({ screenName: "backupCopy", displayName: "Backup Copy", pronouns: "", location: "", interests: "", aboutMe: "" });
    await store.setProfileStatus("away");
    await fs.writeFile(path.join(directory, "chats.json"), "{not valid json", "utf8");

    const restarted = new AppStore(directory);
    await restarted.load();

    expect(restarted.snapshot().profile.screenName).toBe("backupCopy");
    expect(restarted.takeStartupNotice()).toContain("damaged history file");
    expect((await fs.readdir(directory)).some((file) => file.startsWith("chats.damaged-"))).toBe(true);
  });

  it("round-trips a validated data backup without replacing saved credentials", async () => {
    const { store } = await testStore();
    const backup = store.snapshot();
    await store.saveProfile({ screenName: "changed", displayName: "Changed", pronouns: "", location: "", interests: "", aboutMe: "" });
    await store.replaceSnapshot(backup);
    expect(store.snapshot().profile.screenName).toBe("me");
  });

  it("restores MCP services disabled and removes their saved permissions and credentials", async () => {
    const { store, directory } = await testStore();
    const saved = await store.saveMcpConnection({ name: "Example service", transport: "streamable-http", endpoint: "https://service.example/mcp", bearerToken: "test-token" });
    const connection = saved.mcpConnections[0];
    const buddy = saved.buddies[0];
    if (!connection || !buddy) throw new Error("Test setup failed.");
    const tool = { name: "lookup", inputSchema: { type: "object" }, fingerprint: "a".repeat(64) };
    await store.updateMcpConnectionRuntime(connection.id, { enabled: true, state: "ready", tools: [tool] });
    await store.setBuddyToolGrant(buddy.id, connection.id, tool.name, true);
    const backup = store.snapshot();
    await store.replaceSnapshot(backup);
    expect(store.snapshot().mcpConnections[0]).toMatchObject({ enabled: false, state: "disabled", hasBearerToken: false });
    expect(store.snapshot().buddyToolGrants).toEqual([]);
    expect(store.mcpBearerToken(connection.id)).toBeUndefined();
    const restarted = new AppStore(directory);
    await restarted.load();
    expect(restarted.snapshot().mcpConnections[0]).toMatchObject({ enabled: false, state: "disabled", hasBearerToken: false });
    expect(restarted.mcpBearerToken(connection.id)).toBeUndefined();
  });


  it("deletes a saved key when a restored provider address changes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(directory);
    await store.load();
    const saved = await store.saveProvider({ kind: "openai-compatible", name: "Hosted", baseUrl: "https://models.example/v1", apiKey: "secret" });
    const provider = saved.providers[0];
    if (!provider) throw new Error("Test provider was not saved.");

    const backup = store.snapshot();
    backup.providers[0] = { ...provider, baseUrl: "https://different.example/v1" };
    await store.replaceSnapshot(backup);

    expect(store.apiKey(provider.id)).toBeUndefined();
    expect(store.snapshot().providers[0]?.hasApiKey).toBe(false);

    const restarted = new AppStore(directory);
    await restarted.load();
    expect(restarted.apiKey(provider.id)).toBeUndefined();
  });

  it("keeps a saved key when only the provider name changes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(directory);
    await store.load();
    const saved = await store.saveProvider({ kind: "openai-compatible", name: "Hosted", baseUrl: "https://models.example/v1", apiKey: "secret" });
    const provider = saved.providers[0];
    if (!provider) throw new Error("Test provider was not saved.");

    await store.saveProvider({ id: provider.id, kind: provider.kind, name: "Renamed", baseUrl: provider.baseUrl });

    expect(store.apiKey(provider.id)).toBe("secret");
    expect(store.snapshot().providers[0]?.hasApiKey).toBe(true);
  });

  it("removes a keyless provider without requiring credential encryption", async () => {
    const { store } = await testStore();
    const provider = store.snapshot().providers[0];
    const buddy = store.snapshot().buddies[0];
    if (!provider) throw new Error("Test provider was not saved.");
    if (!buddy) throw new Error("Test buddy was not saved.");
    await store.removeBuddy(buddy.id);
    encryption.available = false;

    await expect(store.removeProvider(provider.id)).resolves.toMatchObject({ providers: [] });
  });

  it("does not replace a snapshot when required credential deletion fails", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(directory);
    await store.load();
    const saved = await store.saveProvider({ kind: "openai-compatible", name: "Hosted", baseUrl: "https://models.example/v1", apiKey: "secret" });
    const provider = saved.providers[0];
    if (!provider) throw new Error("Test provider was not saved.");
    const replacement = store.snapshot();
    replacement.providers = [];
    encryption.available = false;

    await expect(store.replaceSnapshot(replacement)).rejects.toThrow("credential encryption");
    expect(store.snapshot().providers[0]?.id).toBe(provider.id);
    expect(store.apiKey(provider.id)).toBe("secret");
  });

  it("keeps a Buddy Chat separate and restores its participants", async () => {
    const { store, directory } = await testStore();
    const buddy = store.snapshot().buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    const second = await store.saveBuddy({ ...store.snapshot().buddies[0], id: undefined, screenName: "friend-two", displayName: "Friend Two" });
    const other = second.buddies.find((item) => item.screenName === "friend-two");
    if (!other) throw new Error("Second buddy was not saved.");
    const room = await store.newBuddyChat([buddy.id, other.id]);
    expect(room).toMatchObject({ kind: "buddy-chat", participantIds: [buddy.id, other.id] });
    const userMessageId = "group-user" as MessageId;
    const replyMessageId = "group-reply" as MessageId;
    await store.addMessage(room.id, { id: userMessageId, role: "user", content: "Hello room", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" });
    await store.completeAssistant(room.id, { id: replyMessageId, role: "assistant", buddyId: buddy.id, replyToMessageId: userMessageId, content: "Hello", createdAt: "2026-01-01T00:00:01.000Z", state: "complete" });
    const restarted = new AppStore(directory);
    await restarted.load();
    expect(restarted.snapshot().conversations[0]).toMatchObject({ kind: "buddy-chat", participantIds: [buddy.id, other.id] });
    expect(restarted.snapshot().conversations[0]?.messages[1]).toMatchObject({ id: replyMessageId, buddyId: buddy.id, replyToMessageId: userMessageId });
  });

  it("adds a buddy to an existing chat with a durable join notice", async () => {
    const { store, directory } = await testStore();
    const first = store.snapshot().buddies[0];
    if (!first) throw new Error("Test buddy was not saved.");
    const secondSnapshot = await store.saveBuddy({ ...first, id: undefined, screenName: "second", displayName: "Second" });
    const second = secondSnapshot.buddies.find((buddy) => buddy.screenName === "second");
    const thirdSnapshot = await store.saveBuddy({ ...first, id: undefined, screenName: "third", displayName: "Third" });
    const third = thirdSnapshot.buddies.find((buddy) => buddy.screenName === "third");
    if (!second || !third) throw new Error("Test buddies were not saved.");
    const room = await store.newBuddyChat([first.id, second.id]);

    await store.addBuddyToChat(room.id, third.id);
    const restarted = new AppStore(directory);
    await restarted.load();

    expect(restarted.conversation(room.id)).toMatchObject({
      kind: "buddy-chat",
      participantIds: [first.id, second.id, third.id],
      messages: [{ role: "assistant", content: "Third joined the Buddy Chat.", state: "complete" }],
    });
  });

  it("rejects duplicate screen names and a fifth Buddy Chat participant", async () => {
    const { store } = await testStore();
    const first = store.snapshot().buddies[0];
    if (!first) throw new Error("Test buddy was not saved.");
    await expect(store.saveBuddy({ ...first, id: undefined, displayName: "Duplicate" })).rejects.toThrow("unique screen name");
    const extras = [];
    for (const suffix of ["two", "three", "four", "five"]) {
      const snapshot = await store.saveBuddy({ ...first, id: undefined, screenName: suffix, displayName: suffix });
      const saved = snapshot.buddies.find((buddy) => buddy.screenName === suffix);
      if (!saved) throw new Error("Test buddy was not saved.");
      extras.push(saved);
    }
    const room = await store.newBuddyChat([first.id, extras[0]!.id, extras[1]!.id, extras[2]!.id]);
    await expect(store.addBuddyToChat(room.id, extras[3]!.id)).rejects.toThrow("no more than four");
  });

  it("never uses a newly saved key with the old endpoint after a provider write fails", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(directory);
    await store.load();
    const saved = await store.saveProvider({ kind: "openai-compatible", name: "Hosted", baseUrl: "https://first.example/v1", apiKey: "first-key" });
    const provider = saved.providers[0];
    if (!provider) throw new Error("Test provider was not saved.");

    const writeFailure = Object.assign(new Error("Disk failure"), { code: "EIO" });
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(writeFailure);
    await expect(store.saveProvider({ id: provider.id, kind: "openai-compatible", name: "Hosted", baseUrl: "https://second.example/v1", apiKey: "second-key" })).rejects.toThrow("Disk failure");
    rename.mockRestore();

    const restarted = new AppStore(directory);
    await restarted.load();
    expect(restarted.snapshot().providers[0]).toMatchObject({ baseUrl: "https://first.example/v1", hasApiKey: false });
    expect(restarted.apiKey(provider.id)).toBeUndefined();
  });

  it("does not trust credentials saved before binding was introduced", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiim-store-"));
    temporaryDirectories.push(directory);
    const store = new AppStore(directory);
    await store.load();
    const saved = await store.saveProvider({ kind: "openai-compatible", name: "Hosted", baseUrl: "https://models.example/v1" });
    const provider = saved.providers[0];
    if (!provider) throw new Error("Test provider was not saved.");
    await fs.writeFile(path.join(directory, "credentials.bin"), Buffer.from(JSON.stringify({ [provider.id]: "unbound-key" }), "utf8"));

    const restarted = new AppStore(directory);
    await restarted.load();
    expect(restarted.apiKey(provider.id)).toBeUndefined();
    expect(restarted.snapshot().providers[0]?.hasApiKey).toBe(false);
    expect(restarted.takeStartupNotice()).toContain("security upgrade");
  });

  it("removes only the trailing failed reply before retrying", async () => {
    const { store } = await testStore();
    const buddy = store.snapshot().buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    const conversation = await store.newConversation(buddy.id);
    await store.addMessage(conversation.id, { id: "question" as MessageId, role: "user", content: "Hello?", createdAt: "2026-09-04T12:00:00.000Z", state: "complete" });
    await store.completeAssistant(conversation.id, { id: "failure" as MessageId, role: "assistant", content: "Timed out", createdAt: "2026-09-04T12:02:00.000Z", state: "error" });
    await store.removeTrailingError(conversation.id);
    expect(store.conversation(conversation.id).messages.map((message) => message.content)).toEqual(["Hello?"]);
  });

  it("does not start a spontaneous check-in from a buddy who is offline", async () => {
    const { store } = await testStore();
    const snapshot = store.snapshot();
    const buddy = snapshot.buddies[0];
    if (!buddy) throw new Error("Test buddy was not saved.");
    buddy.screenName = "friend16";
    buddy.presencePattern = "varied";
    buddy.checkInFrequency = "occasional";
    buddy.nextCheckInAt = "2026-09-05T11:00:00-07:00";
    await store.replaceSnapshot(snapshot);
    expect(store.dueCheckIn(new Date("2026-09-05T12:00:00-07:00"))).toBeUndefined();
  });
});
