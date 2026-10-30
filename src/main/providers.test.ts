import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisibleTextFilter, extractOllamaVisibleDelta, extractOpenAiVisibleDelta, filterVisibleText, ollamaChatBody, openAiStyleToolEndpoint, supportsOpenAiStyleTools, providerToolTurn } from "./providers";

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

  it("removes MiniMax inline thinking from a non-streaming tool reply", () => {
    expect(filterVisibleText("<think>private tool reasoning</think>42")).toBe("42");
  });
});

describe("OpenAI-style capability adapter", () => {
  it("supports the compatible provider family without pretending native providers share its protocol", () => {
    expect(supportsOpenAiStyleTools("openai")).toBe(true);
    expect(supportsOpenAiStyleTools("minimax")).toBe(true);
    expect(supportsOpenAiStyleTools("openrouter")).toBe(true);
    expect(supportsOpenAiStyleTools("openai-compatible")).toBe(true);
    expect(supportsOpenAiStyleTools("anthropic")).toBe(false);
    expect(supportsOpenAiStyleTools("google")).toBe(false);
    expect(supportsOpenAiStyleTools("ollama")).toBe(false);
  });

  it("uses the configured compatible endpoint and the OpenRouter default", () => {
    expect(openAiStyleToolEndpoint({ id: "provider" as never, kind: "openai-compatible", name: "Local", baseUrl: "http://localhost:1234/v1/", hasApiKey: true })).toBe("http://localhost:1234/v1/chat/completions");
    expect(openAiStyleToolEndpoint({ id: "provider" as never, kind: "openrouter", name: "OpenRouter", hasApiKey: true })).toBe("https://openrouter.ai/api/v1/chat/completions");
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

describe("Ollama tool turns", () => {
  afterEach(() => vi.unstubAllGlobals());
  const request = { provider: { kind: "ollama", baseUrl: "http://localhost:11434" }, buddy: { modelId: "qwen3:4b" }, messages: [{ role: "user", content: "Add 17 and 25" }], instructionsOverride: "Be helpful", signal: new AbortController().signal } as Parameters<typeof providerToolTurn>[0];
  const tools = [{ name: "aiim_tool_1", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } }];

  it("passes an Ollama tool call and its result through the two rounds", async () => {
    const assistantMessage = { role: "assistant", content: "", tool_calls: [{ function: { name: "aiim_tool_1", arguments: { a: 17, b: 25 } } }] };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: assistantMessage }))).mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: "assistant", content: "42" } })));
    vi.stubGlobal("fetch", fetchMock);
    const first = await providerToolTurn(request, tools);
    expect(first).toMatchObject({ kind: "tool", name: "aiim_tool_1", argumentsValue: { a: 17, b: 25 } });
    if (first.kind !== "tool") throw new Error("Expected a tool request.");
    const final = await providerToolTurn(request, tools, { assistantMessage: first.assistantMessage, callId: first.id, toolName: first.name, argumentsJson: JSON.stringify(first.argumentsValue), result: "42" });
    expect(final).toEqual({ kind: "final", text: "42" });
    const body = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(body.messages.slice(-2)).toEqual([assistantMessage, { role: "tool", tool_name: "aiim_tool_1", content: "42" }]);
    expect(body.tools).toBeUndefined();
  });

  it("recognizes a model that explicitly does not support tools", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"model does not support tools"}', { status: 400 })));
    await expect(providerToolTurn(request, tools)).resolves.toEqual({ kind: "tools-unsupported" });
  });

  it("does not execute multiple tool calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { tool_calls: [{}, {}] } }))));
    await expect(providerToolTurn(request, tools)).resolves.toEqual({ kind: "multiple-tools" });
  });
});
