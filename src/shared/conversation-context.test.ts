import { describe, expect, it } from "vitest";
import type { ChatMessage, Conversation, ConversationId, MessageId } from "./types";
import { nextSummarySource, recentContext, summaryText } from "./conversation-context";

function message(id: string, content: string): ChatMessage {
  return { id: id as MessageId, role: Number(id) % 2 ? "user" : "assistant", content, createdAt: "2026-09-07T00:00:00.000Z", state: "complete" };
}

function conversation(messages: ChatMessage[]): Conversation {
  return { id: "conversation" as ConversationId, kind: "direct", buddyId: "buddy" as never, title: "Test", createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", messages };
}

describe("bounded conversation context", () => {
  it("keeps the newest messages within a bounded working context", () => {
    const messages = Array.from({ length: 20 }, (_item, index) => message(String(index + 1), "x".repeat(2_000)));
    const selected = recentContext(conversation(messages), 2_000);
    expect(selected.length).toBeLessThan(messages.length);
    expect(selected.at(-1)?.id).toBe(messages.at(-1)?.id);
  });

  it("summarizes only a stable prefix and then uses the remaining tail", () => {
    const messages = Array.from({ length: 8 }, (_item, index) => message(String(index + 1), `Message ${index + 1}.`));
    const source = nextSummarySource(conversation(messages));
    expect(source?.messages).toHaveLength(8);
    const summarized = { ...conversation(messages), summary: { content: "Earlier discussion.", throughMessageId: "6" as MessageId, updatedAt: "2026-09-07T00:00:00.000Z" } };
    expect(summaryText(summarized)).toBe("Earlier discussion.");
    expect(recentContext(summarized, 100).map((item) => item.id)).toEqual(["7", "8"]);
  });

  it("waits for enough new conversation before creating a summary", () => {
    expect(nextSummarySource(conversation(Array.from({ length: 5 }, (_item, index) => message(String(index + 1), "Brief."))))).toBeUndefined();
  });
});
