import { describe, expect, it } from "vitest";
import { presenceState } from "./presence";

describe("buddy presence", () => {
  it("keeps always-online buddies available or briefly idle", () => {
    expect(["available", "idle"]).toContain(presenceState({ pattern: "always", screenName: "friend", now: new Date("2026-09-04T12:00:00") }));
  });

  it("does not show daytime buddies available overnight", () => {
    expect(["away", "offline"]).toContain(presenceState({ pattern: "daytime", screenName: "friend", now: new Date("2026-09-04T03:00:00") }));
  });

  it("shows a buddy as available for a while after they return to reply", () => {
    const now = new Date("2026-09-04T03:00:00.000Z");
    expect(presenceState({ pattern: "daytime", screenName: "friend", activeUntil: "2026-09-04T03:10:00.000Z", now })).toBe("available");
  });
});
