import { describe, expect, it } from "vitest";
import type { UserProfile } from "./types";
import { buildMemoryExtractionInstructions, parseMemoryCandidateText, shouldConsiderMemory } from "./memory-learning";

const profile: UserProfile = { screenName: "retrofan", displayName: "Alex", pronouns: "", location: "", interests: "", aboutMe: "", status: "available" };

describe("automatic memory learning", () => {
  it("considers messages that may reveal something about the person", () => {
    expect(shouldConsiderMemory("My favorite computer is an Amiga.")).toBe(true);
    expect(shouldConsiderMemory("I'm building an AIM-style app.")).toBe(true);
    expect(shouldConsiderMemory("I was nine years old when I first played it.")).toBe(true);
    expect(shouldConsiderMemory("I've been restoring an old IBM computer.")).toBe(true);
    expect(shouldConsiderMemory("My brother introduced me to the series.")).toBe(true);
    expect(shouldConsiderMemory("hello")).toBe(false);
    expect(shouldConsiderMemory("Can you explain this function?")).toBe(false);
    expect(shouldConsiderMemory("Can you help me with this?")).toBe(false);
    expect(shouldConsiderMemory("I'm tired today.")).toBe(false);
  });

  it("gives the memory pass the person's exact identity", () => {
    const instructions = buildMemoryExtractionInstructions(profile, "My favorite computer is an Amiga.");
    expect(instructions).toContain("friendship with Alex");
    expect(instructions).toContain("Refer to the person as Alex");
    expect(instructions).toContain("same language as this newest user message");
    expect(instructions).toContain("Put each concise, complete memory sentence on its own line");
    expect(instructions).toContain("Every memory sentence must begin with Alex or Alex's");
  });

  it("parses tagged or plain memory output and ignores an empty result", () => {
    expect(parseMemoryCandidateText("<memory>\n- Alex restores old computers.\n- Alex prefers concise answers.\n</memory>")).toEqual([
      "Alex restores old computers.",
      "Alex prefers concise answers.",
    ]);
    expect(parseMemoryCandidateText("1. Alex owns an Amiga.")).toEqual(["Alex owns an Amiga."]);
    expect(parseMemoryCandidateText("<memory></memory>")).toEqual([]);
  });

  it("rejects fragments, labels, and Chinese drift from an English conversation", () => {
    const output = `<memory>\nlikes old computers\nNote: Alex mentioned DOS.\nAlex 喜欢老电脑。\nAlex likes old computers.\n</memory>`;
    expect(parseMemoryCandidateText(output, { newestUserMessage: "I like restoring old computers.", subjectName: "Alex" })).toEqual(["Alex likes old computers."]);
  });

  it("rejects conversational prose even when it mentions the person's name", () => {
    const bad = "a Alex, no, it is not true. Not caring would look like walking away. What I am showing you is that *how* we connect matters.";
    expect(parseMemoryCandidateText(`<memory>\n${bad}\n</memory>`, { newestUserMessage: "I care about our relationship.", subjectName: "Alex" })).toEqual([]);
    expect(parseMemoryCandidateText("Alex, no, that is not what I meant.", { newestUserMessage: "I care about our relationship.", subjectName: "Alex" })).toEqual([]);
  });

  it("keeps concise third-person relationship memories", () => {
    const memories = [
      "Alex adopted a dog named Pixel last spring.",
      "Alex and Morgan moved into a new apartment six months ago.",
      "Alex enjoys living in their new home.",
      "Alex wants close friends to express their own preferences instead of agreeing automatically.",
    ];
    expect(parseMemoryCandidateText(memories.join("\n"), { newestUserMessage: "I want you to remember these details.", subjectName: "Alex" })).toEqual(memories);
  });
});
