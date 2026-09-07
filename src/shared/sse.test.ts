import { describe, expect, it } from "vitest";
import { readSseData } from "./sse";

describe("SSE stream reader", () => {
  it("emits delimited events and the final undelimited event", async () => {
    const events: string[] = [];
    await readSseData(new Response("data: first\n\ndata: second"), (data) => events.push(data), "empty");
    expect(events).toEqual(["first", "second"]);
  });

  it("joins multiple data lines and ignores event metadata", async () => {
    const events: string[] = [];
    await readSseData(new Response("event: update\ndata: one\ndata: two\n\n"), (data) => events.push(data), "empty");
    expect(events).toEqual(["one\ntwo"]);
  });
});
