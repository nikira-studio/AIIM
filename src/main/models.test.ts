import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderId } from "../shared/types";
import { listProviderModels, parseOllamaModels, parseSubscriptionModels } from "./models";

function provider(kind: ProviderConfig["kind"]): ProviderConfig {
  return { id: "provider" as ProviderId, kind, name: kind, hasApiKey: false };
}

afterEach(() => vi.unstubAllGlobals());

describe("built-in model choices", () => {
  it("offers MiniMax reasoning models without a discovery request", async () => {
    const models = await listProviderModels(provider("minimax"));
    expect(models.map(({ id }) => id)).toContain("MiniMax-M3");
    expect(models.map(({ id }) => id)).toContain("MiniMax-M2.5");
  });

  it("checks MiniMax over the network when the user tests its connection", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const models = await listProviderModels(provider("minimax"), "secret", true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(models.map(({ id }) => id)).toEqual(["MiniMax-M3"]);
  });

  it("offers models for a connected ChatGPT subscription", async () => {
    const models = await listProviderModels(provider("openai-subscription"));
    expect(models.map(({ id }) => id)).toContain("gpt-5.6");
  });

  it("uses the signed-in account catalog and its thinking levels", () => {
    expect(parseSubscriptionModels({ models: [{ slug: "gpt-5.6-terra", display_name: "GPT-5.6 Terra", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }] }] })).toEqual([{ id: "gpt-5.6-terra", name: "GPT-5.6 Terra", defaultReasoningEffort: "medium", reasoningEfforts: ["low", "medium", "high"] }]);
  });

  it("parses Ollama chat models and leaves out embedding-only models", () => {
    expect(parseOllamaModels({ models: [
      { name: "qwen3.5:9b", model: "qwen3.5:9b", details: { parameter_size: "9.0B" } },
      { name: "nomic-embed-text:latest", model: "nomic-embed-text:latest", details: { parameter_size: "137M" } },
    ] })).toEqual([{ id: "qwen3.5:9b", name: "qwen3.5:9b (9.0B)" }]);
  });
});
