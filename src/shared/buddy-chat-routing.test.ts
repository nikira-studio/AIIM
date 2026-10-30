import { describe, expect, it } from "vitest";
import type { Buddy, BuddyId, ProviderId } from "./types";
import { buddyChatContextMessages, buddyChatCurrentTurnMessages, buddyChatJoinDescriptions, enqueueBuddyChatHandoff, explicitMentionedBuddy, handoffBuddyChatTurn, initialBuddyChatTurns, selectBuddyChatResponders } from "./buddy-chat-routing";
import { enforceBuddyAddress, stripSelfMentionPrefix } from "./buddy-chat-grounding";

function buddy(id: string, name: string, topics: string[] = []): Buddy {
  return { id: id as BuddyId, providerId: "provider" as ProviderId, screenName: name, displayName: name, modelId: "test", reasoningEffort: "none", systemPrompt: "Friend.", world: "", group: "Friends", color: "#2046a0", status: "available", statusMessage: "Available", awayMessage: "Away", typingStyle: "measured", profileBio: "", profileLocation: "", profileInterests: "", profileQuote: "", presencePattern: "always", notificationSound: "none", fontFamily: "Tahoma", fontColor: "#111111", userRole: "", relationshipNotes: "", chatTopics: topics, participationStyle: "normal", memories: [], memoryMode: "normal", memoryStatus: { lastCheckedUserMessageCount: 0 }, checkInFrequency: "off" };
}

describe("Buddy Chat routing", () => {
  it("selects a named buddy alone and never selects more than two", () => {
    const [lena, vince, theo] = [buddy("lena", "Lena", ["bbs"]), buddy("vince", "Vince", ["pinball"]), buddy("theo", "Theo", ["music"])];
    const selected = selectBuddyChatResponders({ buddies: [lena, vince, theo], latestText: "Vince, which pinball machine should we play?", recentMessages: [] });
    expect(selected.map((item) => item.id)).toEqual([vince.id]);
    expect(selected).toHaveLength(1);
  });

  it("uses chat topics when nobody is named", () => {
    const [lena, vince] = [buddy("lena", "Lena", ["bbs"]), buddy("vince", "Vince", ["pinball"])];
    expect(selectBuddyChatResponders({ buddies: [lena, vince], latestText: "The BBS is acting strange.", recentMessages: [] })[0]?.id).toBe(lena.id);
  });

  it("recognizes a buddy by their first name", () => {
    const [lena, mara] = [buddy("lena", "Lena Park"), buddy("mara", "Mara Voss")];
    expect(selectBuddyChatResponders({ buddies: [lena, mara], latestText: "Mara, ask Lena a question.", recentMessages: [] }).map((item) => item.id)).toEqual([mara.id]);
  });

  it("skips a speaker's own handle when finding a Buddy Chat handoff", () => {
    const [lena, mara] = [buddy("lena", "Lena Park"), buddy("mara", "Mara Voss")];
    lena.screenName = "modemgrrl";
    mara.screenName = "VelvetStatic";
    expect(explicitMentionedBuddy([lena, mara], "@modemgrrl What are you wearing, @VelvetStatic?", lena.id)?.id).toBe(mara.id);
  });

  it("carries the handoff message to the next buddy and requires their exact screen name", () => {
    const [lena, mara] = [buddy("lena", "Lena Park"), buddy("mara", "Mara Voss")];
    lena.screenName = "modemgrrl";
    mara.screenName = "VelvetStatic";
    const userMessage = { id: "user-message" as never, role: "user" as const, content: "@modemgrrl ask Mara about tonight", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    const lenaReply = { id: "lena-reply" as never, content: "@VelvetStatic, what are you wearing tonight?" };
    expect(initialBuddyChatTurns({ participants: [lena, mara], latestMessage: userMessage, recentMessages: [] })[0]).toMatchObject({ kind: "user-handoff-request", responder: lena, target: mara, triggerMessageId: userMessage.id });
    const handoff = handoffBuddyChatTurn([lena, mara], lena, lenaReply);
    expect(handoff).toMatchObject({ kind: "buddy-handoff", responder: mara, from: lena, triggerMessageId: lenaReply.id });
    expect(handoffBuddyChatTurn([lena, mara], lena, { ...lenaReply, content: "Mara, what are you wearing tonight?" })).toBeUndefined();
    expect(handoff && enqueueBuddyChatHandoff([{ kind: "user-message", responder: mara, triggerMessageId: userMessage.id }], handoff)).toEqual([handoff]);
  });

  it("presents another buddy's handoff as incoming speech instead of the active buddy's own output", () => {
    const [lena, mara] = [buddy("lena", "Lena Park"), buddy("mara", "Mara Voss")];
    const userMessage = { id: "user-message" as never, role: "user" as const, content: "Ask Mara what she is wearing.", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    const lenaReply = { id: "lena-reply" as never, role: "assistant" as const, buddyId: lena.id, content: "@Mara, what are you wearing?", createdAt: "2026-01-01T00:00:01.000Z", state: "complete" as const };
    const maraReply = { id: "mara-reply" as never, role: "assistant" as const, buddyId: mara.id, content: "A black jacket.", createdAt: "2026-01-01T00:00:02.000Z", state: "complete" as const };
    const messages = buddyChatContextMessages({ messages: [userMessage, lenaReply, maraReply], participants: [lena, mara], userScreenName: "me", activeBuddyId: mara.id, triggerMessageId: lenaReply.id });
    expect(messages).toMatchObject([
      { role: "user", content: "me: Ask Mara what she is wearing." },
      { role: "user", content: "Lena Park: @Mara, what are you wearing?\n[AIIM: This message triggered your turn. Reply to it.]" },
      { role: "assistant", content: "A black jacket." },
    ]);
  });

  it("keeps a later handoff inside the newest user turn", () => {
    const [lena, mara] = [buddy("lena", "Lena Park"), buddy("mara", "Mara Voss")];
    const earlierUser = { id: "earlier-user" as never, role: "user" as const, content: "@Mara, what are you wearing?", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    const earlierLena = { id: "earlier-lena" as never, role: "assistant" as const, buddyId: lena.id, content: "@Mara, answer that.", createdAt: "2026-01-01T00:00:01.000Z", state: "complete" as const };
    const latestUser = { id: "latest-user" as never, role: "user" as const, content: "Lena, did you see the new flyer?", createdAt: "2026-01-01T00:01:00.000Z", state: "complete" as const };
    const latestLena = { id: "latest-lena" as never, role: "assistant" as const, buddyId: lena.id, content: "@Mara, did you see it?", createdAt: "2026-01-01T00:01:01.000Z", state: "complete" as const };
    const currentTurn = buddyChatCurrentTurnMessages([earlierUser, earlierLena, latestUser, latestLena], latestUser.id);
    expect(currentTurn.map((message) => message.id)).toEqual([latestUser.id, latestLena.id]);
    const context = buddyChatContextMessages({ messages: currentTurn, participants: [lena, mara], userScreenName: "me", activeBuddyId: mara.id, triggerMessageId: latestLena.id });
    expect(context.map((message) => message.content).join("\n")).not.toContain("what are you wearing");
    expect(context.at(-1)?.content).toContain("did you see it?");
  });

  it("routes every exact user handle and gives all-quiet rooms a fallback responder", () => {
    const lena = { ...buddy("lena", "Lena Park"), screenName: "modemgrrl", participationStyle: "quiet" as const };
    const mara = { ...buddy("mara", "Mara Voss"), screenName: "VelvetStatic", participationStyle: "quiet" as const };
    const message = { id: "both" as never, role: "user" as const, content: "@modemgrrl @VelvetStatic are you both free?", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    expect(initialBuddyChatTurns({ participants: [lena, mara], latestMessage: message, recentMessages: [] }).map((turn) => turn.responder.id)).toEqual([lena.id, mara.id]);
    expect(selectBuddyChatResponders({ buddies: [lena, mara], latestText: "hey guys", recentMessages: [] })).toHaveLength(1);
  });

  it("treats the first exact handle as the speaker and the second as the target for communication requests", () => {
    const lena = { ...buddy("lena", "Lena Park"), screenName: "modemgrrl" };
    const mara = { ...buddy("mara", "Mara Voss"), screenName: "VelvetStatic" };
    const message = { id: "coordinate" as never, role: "user" as const, content: "@modemgrrl ask @VelvetStatic what time works", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    expect(initialBuddyChatTurns({ participants: [mara, lena], latestMessage: message, recentMessages: [] })).toEqual([
      { kind: "user-handoff-request", responder: lena, target: mara, triggerMessageId: message.id },
    ]);
  });

  it("does not turn an ordinary mention of another buddy into a required handoff", () => {
    const lena = { ...buddy("lena", "Lena Park"), screenName: "modemgrrl" };
    const mara = { ...buddy("mara", "Mara Voss"), screenName: "VelvetStatic" };
    const message = { id: "ordinary" as never, role: "user" as const, content: "@modemgrrl Mara is joining us tonight", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    expect(initialBuddyChatTurns({ participants: [lena, mara], latestMessage: message, recentMessages: [] })[0]).toMatchObject({ kind: "user-message", responder: lena });
  });

  it("does not treat a past-tense question as a new request to contact a buddy", () => {
    const lena = { ...buddy("lena", "Lena Park"), screenName: "modemgrrl" };
    const mara = { ...buddy("mara", "Mara Voss"), screenName: "VelvetStatic" };
    const message = { id: "status-question" as never, role: "user" as const, content: "@modemgrrl, did you ask Mara that question yet?", createdAt: "2026-01-01T00:00:00.000Z", state: "complete" as const };
    expect(initialBuddyChatTurns({ participants: [lena, mara], latestMessage: message, recentMessages: [] })[0]).toMatchObject({ kind: "user-message", responder: lena });
  });

  it("builds compact room context without private memory", () => {
    const lena = { ...buddy("lena", "Lena Park"), profileBio: "A practical BBS and computer friend.", memories: [{ id: "secret" as never, text: "Private fact.", pinned: false, createdAt: "2026-01-01T00:00:00.000Z" }] };
    const mara = { ...buddy("mara", "Mara Voss"), profileBio: "An observant photographer." };
    expect(buddyChatJoinDescriptions([lena, mara], mara.id)).toContain("Lena Park: A practical BBS");
    expect(buddyChatJoinDescriptions([lena, mara], mara.id)).not.toContain("Private fact");
    expect(stripSelfMentionPrefix("@modemgrrl Yeah, I'm in.", { ...lena, screenName: "modemgrrl" })).toBe("Yeah, I'm in.");
    expect(stripSelfMentionPrefix("Lena Park: Yeah, I'm in.", { ...lena, screenName: "modemgrrl" })).toBe("Yeah, I'm in.");
  });

  it("adds the exact target handle when a required handoff omits it", () => {
    const mara = { ...buddy("mara", "Mara Voss"), screenName: "VelvetStatic" };
    expect(enforceBuddyAddress("Mara, what time works for you?", mara, true)).toBe("@VelvetStatic, what time works for you?");
    expect(enforceBuddyAddress("What time works for you?", mara, true)).toBe("@VelvetStatic What time works for you?");
    expect(enforceBuddyAddress("@VelvetStatic What time works for you?", mara, true)).toBe("@VelvetStatic What time works for you?");
  });

  it("only returns a handoff reply to its sender when it addresses them directly", () => {
    const lena = { ...buddy("lena", "Lena Park"), screenName: "modemgrrl" };
    expect(enforceBuddyAddress("Seven works for me.", lena, false)).toBe("Seven works for me.");
    expect(enforceBuddyAddress("Does seven work for you?", lena, false)).toBe("Does seven work for you?");
    expect(enforceBuddyAddress("Lena, does seven work for you?", lena, false)).toBe("@modemgrrl, does seven work for you?");
  });
});
