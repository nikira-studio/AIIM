import type { CheckInFrequency } from "./types";

export function nextCheckInDate(frequency: Exclude<CheckInFrequency, "off">, now = new Date(), variation = Math.random()): Date {
  const normalized = Math.min(1, Math.max(0, variation));
  const days = frequency === "rare" ? 5 + normalized * 4 : 2 + normalized * 2;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
