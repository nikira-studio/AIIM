import { describe, expect, it } from "vitest";
import { parseCharacterFile } from "../shared/character-format";

describe("AIIM character files", () => {
  it("loads the required identity and applies safe defaults", () => {
    expect(parseCharacterFile({ schemaVersion: 1, displayName: "Ani", screenName: "ani friend", systemPrompt: "Be a kind friend." }).template).toMatchObject({ displayName: "Ani", screenName: "anifriend", pack: "Imported", group: "AI Friends", userRole: "", typingStyle: "measured", presencePattern: "always" });
  });
  it("rejects files without the versioned format", () => {
    expect(() => parseCharacterFile({ displayName: "Ani" })).toThrow("schemaVersion");
  });
});
