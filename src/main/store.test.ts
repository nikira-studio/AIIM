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
