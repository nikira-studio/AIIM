import { describe, expect, it } from "vitest";
import { createVisibleTextFilter, extractOllamaVisibleDelta, extractOpenAiVisibleDelta, ollamaChatBody } from "./providers";

function filter(chunks: string[]): string {
  let result = "";
  const visible = createVisibleTextFilter((text) => { result += text; });
  for (const chunk of chunks) visible.push(chunk);
  visible.finish();
  return result;
}

describe("visible response filtering", () => {
  it("removes complete thinking blocks", () => {
    expect(filter(["<think>private reasoning</think>The answer."])).toBe("The answer.");
  });

  it("removes thinking tags split across stream chunks", () => {
    expect(filter(["<thi", "nk>secret", "</thi", "nk>Visible"])).toBe("Visible");
  });

  it("preserves normal angle-bracket text", () => {
    expect(filter(["Use x < 5 and ", "y > 2."])).toBe("Use x < 5 and y > 2.");
  });

  it("removes whitespace surrounding hidden reasoning", () => {
    expect(filter(["<think>private</think>\n\n  ", "hey"])).toBe("hey");
    expect(filter(["Before<think>private</think>\n\nAfter"])).toBe("Before After");
  });

  it("captures memory notes without showing them", () => {
    let visible = "";
    const memories: string[] = [];
    const filter = createVisibleTextFilter((text) => { visible += text; }, (memory) => memories.push(memory));
    for (const chunk of ["Nice to know.<mem", "ory>User prefers tea", "</memory>\n\n"]) filter.push(chunk);
    filter.finish();
    expect(visible).toBe("Nice to know.");
    expect(memories).toEqual(["User prefers tea"]);
  });
});

describe("MiniMax OpenAI-compatible streaming", () => {
  it("ignores separate reasoning content", () => {
    expect(extractOpenAiVisibleDelta({ choices: [{ delta: { reasoning_content: "private chain of thought" } }] })).toBeUndefined();
    expect(extractOpenAiVisibleDelta({ choices: [{ delta: { content: "Visible answer", reasoning_content: "private" } }] })).toBe("Visible answer");
  });
});

describe("Ollama streaming", () => {
  it("disables model thinking so hidden reasoning cannot consume the whole reply", () => {
    expect(ollamaChatBody("qwen3.5:4b", [{ role: "user", content: "hello" }])).toEqual({
      model: "qwen3.5:4b",
      stream: true,
      think: false,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("uses visible content and ignores the separate thinking field", () => {
    expect(extractOllamaVisibleDelta({ message: { thinking: "private reasoning" } })).toBeUndefined();
    expect(extractOllamaVisibleDelta({ message: { content: "Visible answer", thinking: "private reasoning" } })).toBe("Visible answer");
  });
});
