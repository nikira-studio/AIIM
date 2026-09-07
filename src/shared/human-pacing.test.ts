import { describe, expect, it } from "vitest";
import { replyDelayMs, returnDelayMs } from "./human-pacing";

describe("human-paced replies", () => {
  it("takes longer for longer messages", () => {
    const short = replyDelayMs({ userText: "hi", replyText: "hey", typingStyle: "measured", variation: 0.5 });
    const long = replyDelayMs({ userText: "A long question. ".repeat(20), replyText: "A considered answer. ".repeat(20), typingStyle: "measured", variation: 0.5 });
    expect(long).toBeGreaterThan(short);
  });

  it("keeps delays within a usable cap", () => {
    expect(replyDelayMs({ userText: "x".repeat(10_000), replyText: "y".repeat(10_000), typingStyle: "thoughtful", variation: 1 })).toBe(18_000);
  });

  it("waits for away and offline buddies before they begin typing", () => {
    expect(returnDelayMs("available", 0.5)).toBe(0);
    expect(returnDelayMs("away", 0.5)).toBe(4_000);
    expect(returnDelayMs("offline", 0.5)).toBe(8_500);
  });
});
