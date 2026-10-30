import type { CharacterTemplateData } from "./types";

export interface ImportedCharacterFile {
  template: CharacterTemplateData;
  avatarFile?: string;
  avatarDataUrl?: string;
}

export function parseCharacterFile(value: unknown, allowBundledAvatar = false): ImportedCharacterFile {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) throw new Error("This is not an AIIM character file (schemaVersion must be 1 or 2).");
  const displayName = required(value.displayName, "Display name");
  const screenName = required(value.screenName, "Screen name").replace(/\s+/g, "");
  const systemPrompt = required(value.systemPrompt, "Personality / system prompt");
  const id = optional(value.id) ?? screenName.toLowerCase();
  return {
    template: {
      id,
      displayName,
      screenName,
      tagline: optional(value.tagline) ?? "Imported AI friend",
      pack: optional(value.pack) ?? "Imported",
      group: optional(value.group) ?? "AI Friends",
      userRole: optional(value.userRole) ?? "",
      color: color(value.color, "#2046a0"),
      statusMessage: optional(value.statusMessage) ?? "Available",
      awayMessage: optional(value.awayMessage) ?? "Away from the computer.",
      typingStyle: value.typingStyle === "quick" || value.typingStyle === "thoughtful" ? value.typingStyle : "measured",
      profileBio: optional(value.profileBio) ?? "",
      profileLocation: optional(value.profileLocation) ?? "",
      profileInterests: optional(value.profileInterests) ?? "",
      profileQuote: optional(value.profileQuote) ?? "",
      presencePattern: value.presencePattern === "daytime" || value.presencePattern === "evening" || value.presencePattern === "varied" ? value.presencePattern : "always",
      notificationSound: value.notificationSound === "soft" || value.notificationSound === "digital" || value.notificationSound === "none" ? value.notificationSound : "classic",
      fontFamily: value.fontFamily === "Verdana" || value.fontFamily === "Arial" || value.fontFamily === "Georgia" || value.fontFamily === "Courier New" ? value.fontFamily : "Tahoma",
      fontColor: color(value.fontColor, "#1b489a"),
      relationshipNotes: optional(value.relationshipNotes) ?? "",
      chatTopics: topics(value.chatTopics),
      participationStyle: value.participationStyle === "quiet" || value.participationStyle === "eager" ? value.participationStyle : "normal",
      systemPrompt,
      world: optional(value.world) ?? (value.era === "late-1990s" ? "Everyday life takes place in the late 1990s." : ""),
      ...(allowBundledAvatar && optional(value.avatarUrl) ? { avatarUrl: optional(value.avatarUrl) } : {}),
    },
    ...(optional(value.avatarFile) ? { avatarFile: optional(value.avatarFile) } : {}),
    ...(optional(value.avatarDataUrl) ? { avatarDataUrl: optional(value.avatarDataUrl) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function optional(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function required(value: unknown, label: string): string { const result = optional(value); if (!result) throw new Error(`${label} is required.`); return result; }
function color(value: unknown, fallback: string): string { return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback; }
function topics(value: unknown): string[] { return Array.isArray(value) ? value.filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0).map((topic) => topic.trim().slice(0, 100)).slice(0, 12) : []; }
