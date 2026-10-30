import type { Buddy } from "./types";

export function stripSelfMentionPrefix(reply: string, buddy: Buddy): string {
  const escapedScreenName = buddy.screenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedDisplayName = buddy.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return reply.replace(new RegExp(`^\\s*(?:@${escapedScreenName}(?:(?:[,:-]\\s*)|\\s+)|${escapedDisplayName}\\s*[:,-]\\s*|${escapedScreenName}\\s*[:,-]\\s*)`, "iu"), "").trim();
}

export function enforceBuddyAddress(reply: string, target: Buddy, required: boolean): string {
  const trimmed = reply.trim();
  if (hasExactMention(trimmed, target.screenName)) return trimmed;
  const aliases = [target.displayName, target.screenName, target.displayName.split(/\s+/)[0] ?? ""]
    .filter((alias, index, values) => alias.length >= 3 && values.indexOf(alias) === index)
    .map(escapeRegExp)
    .join("|");
  const directlyAddressesTarget = aliases
    ? new RegExp(`(^|\\n)(\\s*)(?:${aliases})(?=\\s*[,,:-])`, "iu").test(trimmed)
    : false;
  if (!required && !directlyAddressesTarget) return trimmed;
  if (directlyAddressesTarget) {
    return trimmed.replace(new RegExp(`(^|\\n)(\\s*)(?:${aliases})(?=\\s*[,,:-])`, "iu"), `$1$2@${target.screenName}`);
  }
  return `@${target.screenName} ${trimmed}`;
}

function hasExactMention(text: string, screenName: string): boolean {
  return new RegExp(`(^|\\s)@${escapeRegExp(screenName)}(?=$|[\\s.,!?;:])`, "iu").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
