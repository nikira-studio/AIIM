import type { Buddy } from "./types";
import type { PresenceState } from "./presence";

export function returnDelayMs(state: PresenceState, variation = Math.random()): number {
  const normalized = Math.min(1, Math.max(0, variation));
  if (state === "offline") return Math.round(5_000 + normalized * 7_000);
  if (state === "away") return Math.round(2_000 + normalized * 4_000);
  return 0;
}

export function replyDelayMs(input: { userText: string; replyText: string; typingStyle: Buddy["typingStyle"]; variation?: number }): number {
  const variation = Math.min(1, Math.max(0, input.variation ?? Math.random()));
  const charactersPerSecond = input.typingStyle === "quick" ? 72 : input.typingStyle === "thoughtful" ? 34 : 48;
  const maximum = input.typingStyle === "quick" ? 10_000 : input.typingStyle === "thoughtful" ? 18_000 : 14_000;
  const reading = 650 + Math.min(3_200, input.userText.length * 6);
  const composing = input.replyText.length / charactersPerSecond * 1000;
  const humanVariation = 0.86 + variation * 0.28;
  return Math.round(Math.min(maximum, Math.max(900, (reading + composing) * humanVariation)));
}

export async function waitForReplyTime(startedAt: number, targetMs: number, signal: AbortSignal): Promise<void> {
  const remaining = Math.max(0, targetMs - (Date.now() - startedAt));
  if (!remaining) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, remaining);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("The reply was cancelled.", "AbortError")); }, { once: true });
  });
}
