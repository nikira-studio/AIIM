import { describe, expect, it } from "vitest";
import type { UserProfile } from "./types";
import { personalizeUserReferences, userDisplayName } from "./user-identity";

const profile: UserProfile = {
  screenName: "retrofan",
  displayName: "Alex",
  pronouns: "they/them",
  location: "",
  interests: "",
  aboutMe: "",
  status: "available",
};

describe("user identity", () => {
  it("uses the saved display name", () => {
    expect(userDisplayName(profile)).toBe("Alex");
  });

  it("expands common placeholders without case sensitivity", () => {
    expect(personalizeUserReferences("Hi [User]. Be honest, [NAME]. {{display_name}} agrees.", profile)).toBe("Hi Alex. Be honest, Alex. Alex agrees.");
  });

  it("falls back to the screen name when no display name is saved", () => {
    expect(userDisplayName({ ...profile, displayName: "" })).toBe("retrofan");
  });
});
