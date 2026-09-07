import { describe, expect, it } from "vitest";
import type { ModelOption, ProviderConfig, ProviderId } from "./types";
import { resolveModelSelection, resolveProviderSelection } from "./model-selection";

describe("model selection", () => {
  const models: ModelOption[] = [
    { id: "gpt-5.6", name: "GPT-5.6", reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" },
    { id: "gpt-5.5", name: "GPT-5.5", reasoningEfforts: ["none", "low"], defaultReasoningEffort: "low" },
  ];

  it("preserves a valid current model and thinking level", () => {
    expect(resolveModelSelection(models, "gpt-5.6", "gpt-5.6", "high")).toEqual({ modelId: "gpt-5.6", isCustom: false, reasoningEffort: "high" });
  });

  it("uses a supported thinking level after changing models", () => {
    expect(resolveModelSelection(models, "gpt-5.5", "gpt-5.6", "high")).toEqual({ modelId: "gpt-5.5", isCustom: false, reasoningEffort: "low" });
  });

  it("keeps an exact custom model visible and editable", () => {
    expect(resolveModelSelection(models, "future-model", "gpt-5.6", "xhigh")).toEqual({ modelId: "future-model", isCustom: true, reasoningEffort: "xhigh" });
  });

  it("chooses the preferred model for a fresh provider", () => {
    expect(resolveModelSelection(models, "", "gpt-5.6", "medium")).toEqual({ modelId: "gpt-5.6", isCustom: false, reasoningEffort: "medium" });
  });

  it("moves to an existing provider when the selected provider is removed", () => {
    const providers: ProviderConfig[] = [{ id: "openai" as ProviderId, kind: "openai", name: "OpenAI", hasApiKey: true }];
    expect(resolveProviderSelection(providers, "removed" as ProviderId)).toBe("openai");
    expect(resolveProviderSelection([], "removed" as ProviderId)).toBe("");
  });
});
