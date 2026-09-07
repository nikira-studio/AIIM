import { describe, expect, it } from "vitest";
import { characterTemplates } from "./character-templates";

describe("built-in character prompts", () => {
  it("gives every Dial-Up Friend a late-1990s setting without an anachronistic escape clause", () => {
    const dialUpFriends = characterTemplates.filter((template) => template.pack === "Dial-Up Friends");

    expect(dialUpFriends).toHaveLength(4);
    for (const template of dialUpFriends) {
      expect(template.systemPrompt).toMatch(/late[- ]1990s/i);
      expect(template.systemPrompt).toContain("When the user introduces later");
      expect(template.systemPrompt).not.toMatch(/newer (?:technology|culture).{0,40}(?:naturally|normal subjects)/i);
    }
  });

  it("keeps Lena's BBS troubleshooting grounded in the stated connection type", () => {
    const lena = characterTemplates.find((template) => template.id === "lena-park");

    expect(lena).toBeDefined();
    expect(lena?.systemPrompt).toContain("difference between a dial-up BBS, a telnet BBS, and a website");
    expect(lena?.systemPrompt).toContain("do not pretend that you just checked its console");
    expect(lena?.systemPrompt).toContain("Do not suggest a firewall, internet connection, or web interface unless the user says the BBS uses one");
  });

  it("keeps Vince within arcade and pinball experience", () => {
    const vince = characterTemplates.find((template) => template.id === "vince-calder");

    expect(vince).toBeDefined();
    expect(vince?.systemPrompt).toContain("arcade cabinets, pinball machines, and the electronics common to them");
    expect(vince?.systemPrompt).toContain("Distinguish those machines from home consoles and general-purpose computers");
    expect(vince?.systemPrompt).toContain("Do not invent a cabinet, tournament, score, repair session, or game release");
  });

  it("keeps Theo within record-store and college-radio experience", () => {
    const theo = characterTemplates.find((template) => template.id === "theo-mercer");

    expect(theo).toBeDefined();
    expect(theo?.systemPrompt).toContain("record-store work, physical music collections, college radio");
    expect(theo?.systemPrompt).toContain("Keep records, cassettes, CDs, broadcast radio, and online audio distinct");
    expect(theo?.systemPrompt).toContain("If you are unsure about a release, credit, lyric, or event, say so instead of inventing it");
  });

  it("keeps Mara within film photography and the local art scene", () => {
    const mara = characterTemplates.find((template) => template.id === "mara-voss");

    expect(mara).toBeDefined();
    expect(mara?.systemPrompt).toContain("film photography, darkroom work, photocopied or computer-designed flyers");
    expect(mara?.systemPrompt).toContain("Do not casually replace that work with phone cameras, filters, social media, or modern design services");
    expect(mara?.systemPrompt).toContain("respond only to details actually available");
  });
});
