import type { Buddy, BuddyId, ChatMessage, MessageId } from "./types";

export type BuddyChatTurn =
  | { kind: "user-message"; responder: Buddy; triggerMessageId: MessageId }
  | { kind: "user-handoff-request"; responder: Buddy; target: Buddy; triggerMessageId: MessageId }
  | { kind: "buddy-handoff"; responder: Buddy; from: Buddy; triggerMessageId: MessageId }
  | { kind: "retry"; responder: Buddy; triggerMessageId: MessageId };

export const buddyChatRequestLimit = 3;

export function buddyChatCurrentTurnMessages(messages: ChatMessage[], latestUserMessageId: MessageId): ChatMessage[] {
  const latestUserIndex = messages.findIndex((message) => message.id === latestUserMessageId);
  return latestUserIndex < 0 ? messages : messages.slice(latestUserIndex);
}

export function buddyChatContextMessages(input: { messages: ChatMessage[]; participants: Buddy[]; userScreenName: string; activeBuddyId: BuddyId; triggerMessageId: MessageId }): ChatMessage[] {
  return input.messages.map((message) => {
    const speaker = message.role === "assistant" ? input.participants.find((buddy) => buddy.id === message.buddyId) : undefined;
    const label = message.role === "user" ? input.userScreenName : speaker?.displayName ?? "AIIM";
    const isActiveBuddy = message.role === "assistant" && message.buddyId === input.activeBuddyId;
    return {
      ...message,
      role: isActiveBuddy ? "assistant" : "user",
      content: `${isActiveBuddy ? message.content : `${label}: ${message.content}`}${message.id === input.triggerMessageId ? "\n[AIIM: This message triggered your turn. Reply to it.]" : ""}`,
    };
  });
}

export function selectBuddyChatResponders(input: { buddies: Buddy[]; latestText: string; recentMessages: ChatMessage[] }): Buddy[] {
  const text = input.latestText.toLocaleLowerCase();
  const recentSpeakers = new Set(input.recentMessages.slice(-4).flatMap((message) => message.role === "assistant" && message.buddyId ? [message.buddyId] : []));
  const ranked = input.buddies
    .map((buddy) => ({ buddy, ...scoreBuddy(buddy, text, recentSpeakers) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.buddy.displayName.localeCompare(right.buddy.displayName))
  const first = ranked[0];
  if (!first) {
    const fallback = input.buddies
      .map((buddy) => ({ buddy, ...scoreBuddy(buddy, text, recentSpeakers) }))
      .sort((left, right) => right.score - left.score || left.buddy.displayName.localeCompare(right.buddy.displayName))[0];
    return fallback ? [fallback.buddy] : [];
  }
  const second = ranked[1];
  const bothBringDistinctTopics = !first.named && first.topicMatches > 0 && Boolean(second && !second.named && second.topicMatches > 0);
  return bothBringDistinctTopics && second ? [first.buddy, second.buddy] : [first.buddy];
}

export function explicitMentionedBuddy(buddies: Buddy[], text: string, excludedBuddyId?: BuddyId): Buddy | undefined {
  const lower = text.toLocaleLowerCase();
  return buddies.find((buddy) => buddy.id !== excludedBuddyId && mentionAliases(buddy).some((mention) => lower.includes(mention)));
}

export function initialBuddyChatTurns(input: { participants: Buddy[]; latestMessage: ChatMessage; recentMessages: ChatMessage[] }): BuddyChatTurn[] {
  const exactMentions = input.participants
    .flatMap((buddy) => {
      const index = screenNameMentionIndex(input.latestMessage.content, buddy.screenName);
      return index < 0 ? [] : [{ buddy, index }];
    })
    .sort((left, right) => left.index - right.index)
    .map(({ buddy }) => buddy)
    .slice(0, 3);
  if (isBuddyCommunicationRequest(input.latestMessage.content) && exactMentions.length > 1) {
    const [responder, target] = exactMentions;
    if (responder && target) return [{ kind: "user-handoff-request", responder, target, triggerMessageId: input.latestMessage.id }];
  }
  const mentioned = explicitMentionedBuddy(input.participants, input.latestMessage.content);
  const responders = exactMentions.length ? exactMentions : mentioned ? [mentioned] : selectBuddyChatResponders({ buddies: input.participants, latestText: input.latestMessage.content, recentMessages: input.recentMessages });
  if (responders.length === 1) {
    const responder = responders[0];
    const target = responder ? requestedHandoffTarget(input.participants, input.latestMessage.content, responder.id) : undefined;
    if (responder && target) return [{ kind: "user-handoff-request", responder, target, triggerMessageId: input.latestMessage.id }];
  }
  return responders.map((responder) => ({ kind: "user-message", responder, triggerMessageId: input.latestMessage.id }));
}

export function handoffBuddyChatTurn(participants: Buddy[], from: Buddy, message: Pick<ChatMessage, "id" | "content">): BuddyChatTurn | undefined {
  const responder = participants.find((buddy) => buddy.id !== from.id && hasScreenNameMention(message.content, buddy.screenName));
  return responder ? { kind: "buddy-handoff", responder, from, triggerMessageId: message.id } : undefined;
}

export function enqueueBuddyChatHandoff(pending: BuddyChatTurn[], handoff: BuddyChatTurn): BuddyChatTurn[] {
  if (handoff.kind !== "buddy-handoff") return pending;
  return [handoff, ...pending.filter((turn) => turn.responder.id !== handoff.responder.id)];
}

export function buddyChatJoinDescriptions(participants: Buddy[], activeBuddyId: BuddyId): string {
  return participants
    .filter((buddy) => buddy.id !== activeBuddyId)
    .map((buddy) => `${buddy.displayName}: ${compactDescription(buddy)}`)
    .join("\n")
    .slice(0, 650);
}

function scoreBuddy(buddy: Buddy, text: string, recentSpeakers: ReadonlySet<BuddyId>): { score: number; named: boolean; topicMatches: number } {
  const firstName = buddy.displayName.split(/\s+/)[0]?.toLocaleLowerCase() ?? "";
  const names = [buddy.displayName, buddy.screenName, ...(firstName.length >= 3 ? [firstName] : [])];
  const named = names.some((name) => hasName(text, name));
  const addressed = names.some((name) => new RegExp(`^\\s*(?:hey\\s+)?${escapeRegExp(name.toLocaleLowerCase())}\\s*,`, "u").test(text));
  const topicMatches = buddy.chatTopics.filter((topic) => text.includes(topic.toLocaleLowerCase())).length;
  const style = buddy.participationStyle === "eager" ? 2 : buddy.participationStyle === "quiet" ? -2 : 0;
  const recentPenalty = recentSpeakers.has(buddy.id) ? -1 : 0;
  return { score: (addressed ? 20 : named ? 10 : 1) + topicMatches * 3 + style + recentPenalty, named, topicMatches };
}

function hasName(text: string, name: string): boolean { return new RegExp(`\\b${escapeRegExp(name.toLocaleLowerCase())}\\b`, "u").test(text); }
function requestedHandoffTarget(participants: Buddy[], text: string, responderId: BuddyId): Buddy | undefined {
  if (!isBuddyCommunicationRequest(text)) return undefined;
  const candidates = participants.filter((buddy) => buddy.id !== responderId && hasBuddyName(text, buddy));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isBuddyCommunicationRequest(text: string): boolean {
  if (/\b(?:did|have|has|had)\s+(?:@?\w+\s+){1,3}(?:ask|tell|message|ping|contact|coordinate|check\s+(?:with|in\s+with)|talk\s+(?:to|with)|speak\s+(?:to|with)|work\s+(?:with|out))\b/iu.test(text)) return false;
  return /\b(?:ask|tell|message|ping|contact|coordinate|check\s+(?:with|in\s+with)|talk\s+(?:to|with)|speak\s+(?:to|with)|work\s+(?:with|out))\b/iu.test(text);
}

function hasBuddyName(text: string, buddy: Buddy): boolean {
  const firstName = buddy.displayName.split(/\s+/)[0] ?? "";
  return hasScreenNameMention(text, buddy.screenName)
    || [buddy.displayName, buddy.screenName, ...(firstName.length >= 3 ? [firstName] : [])].some((name) => hasName(text.toLocaleLowerCase(), name));
}

function screenNameMentionIndex(text: string, screenName: string): number {
  return text.search(new RegExp(`(^|\\s)@${escapeRegExp(screenName)}(?=$|[\\s.,!?;:])`, "iu"));
}

function hasScreenNameMention(text: string, screenName: string): boolean { return screenNameMentionIndex(text, screenName) >= 0; }
function mentionAliases(buddy: Buddy): string[] { return [...new Set([`@${buddy.displayName}`, `@${buddy.displayName.replace(/\s+/g, "")}`, `@${buddy.screenName}`, `@${buddy.displayName.split(/\s+/)[0] ?? ""}`].map((value) => value.toLocaleLowerCase()).filter((value) => value.length > 1))]; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function compactDescription(buddy: Buddy): string { return [buddy.profileBio, buddy.profileInterests, buddy.statusMessage].filter(Boolean).join("; ").slice(0, 150) || `${buddy.screenName}, an AI buddy`; }
