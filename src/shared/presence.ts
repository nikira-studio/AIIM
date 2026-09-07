import type { Buddy, PresencePattern } from "./types";

export type PresenceState = "available" | "idle" | "away" | "offline";

export interface BuddyPresence {
  state: PresenceState;
  label: string;
}

export function buddyPresence(buddy: Buddy, now = new Date()): BuddyPresence {
  const state = presenceState({ pattern: buddy.presencePattern, screenName: buddy.screenName, activeUntil: buddy.activeUntil, now });
  const label = state === "available" ? buddy.statusMessage : state === "idle" ? `Idle · ${buddy.statusMessage}` : state === "away" ? buddy.awayMessage : "Offline";
  return { state, label };
}

export function presenceState(input: { pattern: PresencePattern; screenName: string; activeUntil?: string; now: Date }): PresenceState {
  if (input.activeUntil && Date.parse(input.activeUntil) > input.now.getTime()) return "available";
  const hour = input.now.getHours();
  const slot = Math.floor(input.now.getTime() / (15 * 60_000));
  const roll = Math.abs(hash(`${input.screenName}:${slot}`)) % 12;
  if (input.pattern === "always") return roll === 0 ? "idle" : "available";
  if (input.pattern === "daytime") return hour >= 8 && hour < 22 ? (roll < 2 ? "idle" : "available") : (roll < 6 ? "away" : "offline");
  if (input.pattern === "evening") return hour >= 17 || hour < 1 ? (roll < 2 ? "idle" : "available") : (roll < 5 ? "away" : "offline");
  if (roll === 0) return "offline";
  if (roll < 3) return "away";
  if (roll < 5) return "idle";
  return "available";
}

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = Math.imul(31, result) + character.charCodeAt(0) | 0;
  return result;
}
