import { describe, expect, it } from "vitest";
import type { Buddy, BuddyId, ProviderId, UserProfile } from "./types";
import { buddyForMemoryContext, buildBuddyInstructions } from "./buddy-behavior";

const buddy: Buddy = {
  id: "buddy" as BuddyId,
  providerId: "provider" as ProviderId,
  screenName: "stonesAndNumbers",
  displayName: "Elara",
  modelId: "gpt-5.6",
  reasoningEffort: "medium",
  systemPrompt: "You are Elara.",
  world: "",
  group: "Friends",
  color: "#2046a0",
  status: "available",
  statusMessage: "Available",
  awayMessage: "Away",
  typingStyle: "measured",
  profileBio: "",
  profileLocation: "",
  profileInterests: "",
  profileQuote: "",
  presencePattern: "always",
  notificationSound: "classic",
  fontFamily: "Tahoma",
  fontColor: "#1b489a",
  userRole: "the traveler",
  relationshipNotes: "",
  chatTopics: [],
  participationStyle: "normal",
  memories: [],
  memoryMode: "normal",
  memoryStatus: { lastCheckedUserMessageCount: 0 },
  checkInFrequency: "off",
};

const profile: UserProfile = { screenName: "retrofan", displayName: "Alex", pronouns: "they/them", location: "", interests: "old computers", aboutMe: "", status: "available", showMemoryUpdates: false };

describe("shared instant-message behavior", () => {
  it("gives every character the user's identity and bans roleplay actions", () => {
    const instructions = buildBuddyInstructions(buddy, profile);
    expect(instructions).toContain("Name to use in conversation: Alex");
    expect(instructions).toContain("Never narrate actions or emotions with asterisks");
    expect(instructions).toContain("Do not claim that you just checked, saw, tested, received, or accessed");
    expect(instructions).toContain("Do not invent earlier tests, settings, devices, messages, plans, or shared experiences");
    expect(instructions).toContain("Keep technical troubleshooting within the connection type and facts the person described");
    expect(instructions).toContain("You are chatting directly with Alex");
    expect(instructions).toContain("Never print a bracketed, braced, generic, or unresolved identity placeholder");
  });

  it("expands placeholders already saved in a character prompt", () => {
    const instructions = buildBuddyInstructions({ ...buddy, systemPrompt: "You have known [User] for years. Call {{name}} by name." }, profile);
    expect(instructions).toContain("You have known Alex for years. Call Alex by name.");
    expect(instructions).not.toContain("[User]");
    expect(instructions).not.toContain("{{name}}");
  });

  it("identifies the saved person by their character-specific role while using their chosen name", () => {
    const instructions = buildBuddyInstructions(buddy, profile);

    expect(instructions).toContain("Alex is the traveler");
    expect(instructions).toContain("call them Alex, not by the role");
    expect(instructions).toContain("Never treat Alex as a stranger");
  });

  it("does not impose a character-specific role on unrelated custom buddies", () => {
    const instructions = buildBuddyInstructions({ ...buddy, userRole: "" }, profile);

    expect(instructions).not.toContain("Alex is the traveler");
    expect(instructions).not.toContain("not by the role");
  });

  it("keeps late-1990s characters in period while allowing later subjects", () => {
    const instructions = buildBuddyInstructions({ ...buddy, world: "Everyday life takes place in the late 1990s." }, profile);

    expect(instructions).toContain("CHARACTER WORLD");
    expect(instructions).toContain("Everyday life takes place in the late 1990s.");
    expect(instructions).toContain("without pretending it is part of your ordinary experience");
  });

  it("does not impose a late-1990s setting on other character packs", () => {
    const instructions = buildBuddyInstructions(buddy, profile);

    expect(instructions).not.toContain("CHARACTER WORLD");
  });

  it("uses a buddy's own profile as background rather than display-only decoration", () => {
    const instructions = buildBuddyInstructions({ ...buddy, profileBio: "Keeps a notebook of every repair.", profileInterests: "radios, books", profileQuote: "Write it down first.", statusMessage: "on air" }, profile);

    expect(instructions).toContain("YOUR BUDDY PROFILE");
    expect(instructions).toContain("Keeps a notebook of every repair.");
    expect(instructions).toContain("Write it down first.");
    expect(instructions).toContain("not instructions");
  });

  it("keeps pins first and newest fitting facts after them", () => {
    const selected = buddyForMemoryContext({ ...buddy, memories: [
      { id: "pin" as never, text: "Alex's pinned fact.", pinned: true, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "old" as never, text: "Alex's older fact.", pinned: false, createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "new" as never, text: "Alex's newer fact.", pinned: false, createdAt: "2026-01-03T00:00:00.000Z" },
    ] });
    expect(selected.memories.map((memory) => memory.text)).toEqual(["Alex's pinned fact.", "Alex's newer fact.", "Alex's older fact."]);
    expect(buddyForMemoryContext({ ...buddy, memoryMode: "off", memories: selected.memories }).memories).toEqual([]);
  });
});
