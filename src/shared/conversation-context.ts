import type { ChatMessage, Conversation, MessageId } from "./types";

const inputBudget = 8_000;
const summaryBudget = 1_200;
const summarySourceBudget = 4_000;

export function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }

export function recentContext(conversation: Conversation, instructionTokens: number): ChatMessage[] {
  const summaryTokens = conversation.summary ? Math.min(summaryBudget, estimateTokens(conversation.summary.content)) : 0;
  let remaining = Math.max(1_000, inputBudget - instructionTokens - summaryTokens - 1_000);
  const selected: ChatMessage[] = [];
  const afterSummary = messagesAfterSummary(conversation);
  for (const message of [...afterSummary].reverse()) {
    const tokens = estimateTokens(message.content);
    if (selected.length && tokens > remaining) continue;
    selected.unshift(message);
    remaining -= tokens;
  }
  return selected;
}

export function summaryText(conversation: Conversation): string {
  if (!conversation.summary) return "";
  return conversation.summary.content.slice(0, summaryBudget * 4);
}

export function nextSummarySource(conversation: Conversation): { messages: ChatMessage[]; throughMessageId: MessageId } | undefined {
  const messages = messagesAfterSummary(conversation);
  let used = 0;
  const selected: ChatMessage[] = [];
  for (const message of messages) {
    if (used + estimateTokens(message.content) > summarySourceBudget) break;
    selected.push(message);
    used += estimateTokens(message.content);
  }
  const latest = selected.at(-1);
  return selected.length >= 6 && latest ? { messages: selected, throughMessageId: latest.id } : undefined;
}

function messagesAfterSummary(conversation: Conversation): ChatMessage[] {
  if (!conversation.summary) return conversation.messages;
  const index = conversation.messages.findIndex((message) => message.id === conversation.summary?.throughMessageId);
  return index < 0 ? conversation.messages : conversation.messages.slice(index + 1);
}
