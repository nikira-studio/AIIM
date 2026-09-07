import { describe, expect, it } from "vitest";
import { nextCheckInDate } from "./check-ins";

describe("spontaneous check-in scheduling", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  it("keeps occasional check-ins two to four days apart", () => {
    expect(nextCheckInDate("occasional", now, 0).toISOString()).toBe("2026-09-06T12:00:00.000Z");
    expect(nextCheckInDate("occasional", now, 1).toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });
  it("makes rare check-ins substantially less frequent", () => {
    expect(nextCheckInDate("rare", now, 0).toISOString()).toBe("2026-09-09T12:00:00.000Z");
    expect(nextCheckInDate("rare", now, 1).toISOString()).toBe("2026-09-13T12:00:00.000Z");
  });
});
