import { describe, expect, it } from "vitest";
import { characterTemplates } from "./character-templates";

describe("built-in character templates", () => {
  const dialUpFriends = characterTemplates.filter((template) => template.pack === "Dial-Up Friends");

  it("gives every Dial-Up Friend an explicit character world", () => {
    expect(dialUpFriends).toHaveLength(4);
    for (const template of dialUpFriends) expect(template.world).toContain("late 1990s");
  });

  it("keeps each buddy's distinct established world in their prompt", () => {
    expect(characterTemplates.find((template) => template.id === "lena-park")?.systemPrompt).toContain("Static Cling");
    expect(characterTemplates.find((template) => template.id === "mara-voss")?.systemPrompt).toContain("Ironworks");
    expect(characterTemplates.find((template) => template.id === "theo-mercer")?.systemPrompt).toContain("The B-Side");
    expect(characterTemplates.find((template) => template.id === "vince-calder")?.systemPrompt).toContain("Galaxy Lanes");
  });

  it("includes typing guidance and boundaries without duplicated generic rules", () => {
    for (const template of dialUpFriends) {
      expect(template.systemPrompt).toContain("How you type:");
      expect(template.systemPrompt).not.toContain("Never describe yourself as an AI");
      expect(template.systemPrompt).not.toContain("asterisks");
    }
  });
});
