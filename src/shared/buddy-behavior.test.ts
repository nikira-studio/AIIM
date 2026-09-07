import { describe, expect, it } from "vitest";
import type { Buddy, BuddyId, ProviderId, UserProfile } from "./types";
import { buildBuddyInstructions } from "./buddy-behavior";

const buddy: Buddy = {
  id: "buddy" as BuddyId,
  providerId: "provider" as ProviderId,
  screenName: "stonesAndNumbers",
  displayName: "Elara",
  modelId: "gpt-5.6",
  reasoningEffort: "medium",
  systemPrompt: "You are Elara.",
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
  memories: [],
  checkInFrequency: "off",
};

const profile: UserProfile = { screenName: "retrofan", displayName: "Alex", pronouns: "they/them", location: "", interests: "old computers", aboutMe: "", status: "available" };

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
    const instructions = buildBuddyInstructions({ ...buddy, systemPrompt: "Your daily life is set in the late 1990s." }, profile);

    expect(instructions).toContain("Your ordinary day-to-day setting is the late 1990s");
    expect(instructions).toContain("When Alex introduces a later subject, discuss it without pretending that it already exists in your everyday world");
    expect(instructions).toContain("Do not derail the conversation with repeated timeline remarks");
  });

  it("does not impose a late-1990s setting on other character packs", () => {
    const instructions = buildBuddyInstructions(buddy, profile);

    expect(instructions).not.toContain("TIME AND SETTING");
  });
});
