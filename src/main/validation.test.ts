import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeOllamaBaseUrl, parseBuddyInput, parseProviderInput, parseStoredSnapshot, parseUserProfileInput } from "./validation";

describe("provider boundary", () => {
  it("requires a URL for custom providers", () => {
    expect(() => parseProviderInput({ kind: "openai-compatible", name: "Local" })).toThrow("base URL");
  });

  it("allows secure remote and local loopback compatible endpoints", () => {
    expect(parseProviderInput({ kind: "openai-compatible", name: "Hosted", baseUrl: "https://models.example/v1/" }).baseUrl).toBe("https://models.example/v1");
    expect(parseProviderInput({ kind: "openai-compatible", name: "Local", baseUrl: "http://localhost:1234/v1/" }).baseUrl).toBe("http://localhost:1234/v1");
  });

  it("rejects credential-bearing plain HTTP remote endpoints", () => {
    expect(() => parseProviderInput({ kind: "openai-compatible", name: "Unsafe", baseUrl: "http://models.example/v1" })).toThrow("HTTPS");
  });

  it("does not accept a custom address for a fixed provider", () => {
    expect(() => parseProviderInput({ kind: "openai", name: "OpenAI", baseUrl: "https://models.example/v1" })).toThrow("official service address");
  });

  it("uses Ollama's standard local address without an API key", () => {
    expect(parseProviderInput({ kind: "ollama", name: "Ollama" })).toEqual({ kind: "ollama", name: "Ollama", baseUrl: "http://localhost:11434" });
    expect(normalizeOllamaBaseUrl("localhost:11434/api")).toBe("http://localhost:11434");
    expect(normalizeOllamaBaseUrl("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434");
  });

  it("fully validates providers restored from a backup", () => {
    const snapshot = parseStoredSnapshot(storedSnapshot([
      { id: "provider", kind: "openai-compatible", name: "Hosted", baseUrl: "https://models.example/v1", hasApiKey: true },
    ]));
    expect(snapshot?.providers[0]).toMatchObject({ id: "provider", kind: "openai-compatible", baseUrl: "https://models.example/v1", hasApiKey: false });
  });

  it.each([
    [{ id: "provider", kind: "unknown", name: "Unknown" }],
    [{ id: "provider", kind: "openai", name: "OpenAI", baseUrl: "https://models.example/v1" }],
    [{ id: "provider", kind: "openai-compatible", name: "Unsafe", baseUrl: "http://models.example/v1" }],
    [
      { id: "duplicate", kind: "openai", name: "First" },
      { id: "duplicate", kind: "anthropic", name: "Second" },
    ],
  ])("rejects unsafe or ambiguous restored provider data", (providers) => {
    expect(parseStoredSnapshot(storedSnapshot(providers))).toBeUndefined();
  });
});

describe("buddy boundary", () => {
  it("turns a screen name into one token", () => {
    expect(parseBuddyInput({ displayName: "Helpful AI", screenName: "helpful ai", providerId: "p", modelId: "m", color: "nope" })).toMatchObject({ screenName: "helpfulai", color: "#2046a0", group: "AI Buddies", userRole: "" });
  });

  it("does not accept arbitrary file portraits from the renderer boundary", () => {
    const portraitDirectory = path.join(os.tmpdir(), "aiim-portraits");
    const outside = pathToFileURL(path.join(os.tmpdir(), "outside.png")).href;
    expect(() => parseBuddyInput({ displayName: "Helpful AI", screenName: "helpful ai", providerId: "p", modelId: "m", avatarUrl: outside }, { managedPortraitDirectory: portraitDirectory })).toThrow("chosen through AIIM");
  });

  it("defaults a missing character-specific user role to empty", () => {
    const snapshot = parseStoredSnapshot({
      providers: [{ id: "p", kind: "ollama", name: "Local", baseUrl: "http://localhost:11434" }],
      buddies: [{ id: "friend", displayName: "Friend", screenName: "friend", providerId: "p", modelId: "m", systemPrompt: "A longtime friend.", relationshipNotes: "" }],
      conversations: [],
      profile: { screenName: "retrofan" },
    });

    expect(snapshot?.buddies[0]?.userRole).toBe("");
  });

  it("rejects buddies with malformed data or missing providers", () => {
    const base = completeStoredSnapshot();
    expect(parseStoredSnapshot({ ...base, buddies: [null] })).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, providers: [] })).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, buddies: [{ ...base.buddies[0], memories: [{ id: "memory", text: "Known fact", createdAt: "not-a-date" }] }] })).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, buddies: [{ ...base.buddies[0], avatarUrl: "https://tracker.example/avatar.png" }] })).toBeUndefined();
  });

  it("keeps only managed local portrait files from stored data", () => {
    const base = completeStoredSnapshot();
    const portraitDirectory = path.join(os.tmpdir(), "aiim-portraits");
    const managed = pathToFileURL(path.join(portraitDirectory, "friend.png")).href;
    const outside = pathToFileURL(path.join(os.tmpdir(), "outside.png")).href;

    expect(parseStoredSnapshot({ ...base, buddies: [{ ...base.buddies[0], avatarUrl: managed }] }, { managedPortraitDirectory: portraitDirectory })?.buddies[0]?.avatarUrl).toBe(managed);
    expect(parseStoredSnapshot({ ...base, buddies: [{ ...base.buddies[0], avatarUrl: outside }] }, { managedPortraitDirectory: portraitDirectory })?.buddies[0]?.avatarUrl).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, buddies: [{ ...base.buddies[0], avatarUrl: "file://attacker.example/share/private.png" }] }, { managedPortraitDirectory: portraitDirectory })?.buddies[0]?.avatarUrl).toBeUndefined();
  });
});

describe("snapshot boundary", () => {
  it("parses complete stored data without mutating the imported object", () => {
    const raw = completeStoredSnapshot();
    const before = structuredClone(raw);
    const snapshot = parseStoredSnapshot(raw);

    expect(snapshot).toMatchObject({
      buddies: [{ id: "friend", memories: [{ id: "memory", text: "Likes pinball" }] }],
      conversations: [{ id: "conversation", messages: [{ id: "message", role: "user", content: "hello" }] }],
      profile: { screenName: "retrofan", displayName: "Retro Fan", status: "away" },
    });
    expect(raw).toEqual(before);
  });

  it("rejects dangling, duplicate, or malformed conversation data", () => {
    const base = completeStoredSnapshot();
    expect(parseStoredSnapshot({ ...base, conversations: [{ ...base.conversations[0], buddyId: "missing" }] })).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, conversations: [base.conversations[0], base.conversations[0]] })).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, conversations: [{ ...base.conversations[0], messages: [{ ...base.conversations[0].messages[0], role: "system" }] }] })).toBeUndefined();
    expect(parseStoredSnapshot({ ...base, conversations: [{ ...base.conversations[0], messages: [{ ...base.conversations[0].messages[0], createdAt: "yesterday-ish" }] }] })).toBeUndefined();
  });

  it("keeps chats while disabling an old insecure compatible provider", () => {
    const base = completeStoredSnapshot();
    const legacy = {
      ...base,
      providers: [{ id: "provider", kind: "openai-compatible", name: "Old HTTP", baseUrl: "http://198.51.100.50:1234/v1" }],
    };
    const snapshot = parseStoredSnapshot(legacy);

    expect(snapshot?.providers[0]).toMatchObject({ id: "provider", baseUrl: "http://198.51.100.50:1234/v1", hasApiKey: false });
    expect(snapshot?.providers[0]?.disabledReason).toContain("disabled for security");
    expect(snapshot?.conversations[0]?.messages[0]?.content).toBe("hello");
  });
});

describe("user profile boundary", () => {
  it("normalizes the screen name and keeps optional context", () => {
    expect(parseUserProfileInput({ screenName: "retro fan", displayName: "Alex", interests: "old computers" })).toMatchObject({ screenName: "retrofan", displayName: "Alex", interests: "old computers" });
  });
});

function storedSnapshot(providers: unknown[]): unknown {
  return { providers, buddies: [], conversations: [], profile: { screenName: "retrofan" } };
}

function completeStoredSnapshot() {
  return {
    providers: [{ id: "provider", kind: "ollama", name: "Local", baseUrl: "http://localhost:11434" }],
    buddies: [{
      id: "friend",
      displayName: "Friend",
      screenName: "friend",
      providerId: "provider",
      modelId: "model",
      status: "available",
      systemPrompt: "A longtime friend.",
      memories: [{ id: "memory", text: "Likes pinball", createdAt: "2026-09-01T12:00:00.000Z" }],
      avatarUrl: "portraits/friend.png",
    }],
    conversations: [{
      id: "conversation",
      buddyId: "friend",
      title: "Friend",
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:01:00.000Z",
      messages: [{ id: "message", role: "user", content: "hello", createdAt: "2026-09-01T12:01:00.000Z", state: "complete" }],
    }],
    profile: { screenName: "retrofan", displayName: "Retro Fan", status: "away" },
  };
}
