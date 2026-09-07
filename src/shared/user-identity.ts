import type { UserProfile } from "./types";

const placeholder = /\[(?:user(?:\s+name)?|name|display\s+name)\]|\{\{\s*(?:user(?:_name)?|name|display_name)\s*\}\}/gi;

export function userDisplayName(profile: UserProfile): string {
  return profile.displayName.trim() || profile.screenName.trim() || "Me";
}

export function personalizeUserReferences(text: string, profile: UserProfile): string {
  return text.replace(placeholder, userDisplayName(profile));
}
