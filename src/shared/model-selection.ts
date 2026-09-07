import type { ModelOption, ProviderConfig, ProviderId, ReasoningEffort } from "./types";

export interface ModelSelection {
  modelId: string;
  isCustom: boolean;
  reasoningEffort: ReasoningEffort;
}

export function resolveProviderSelection(providers: ProviderConfig[], current: ProviderId | ""): ProviderId | "" {
  return providers.some((provider) => provider.id === current) ? current : providers[0]?.id ?? "";
}

export function resolveModelSelection(
  models: ModelOption[],
  currentModelId: string,
  preferredModelId: string,
  currentEffort: ReasoningEffort,
): ModelSelection {
  const current = models.find((model) => model.id === currentModelId);
  if (current) {
    return {
      modelId: current.id,
      isCustom: false,
      reasoningEffort: supportedEffort(current, currentEffort),
    };
  }

  if (currentModelId) return { modelId: currentModelId, isCustom: true, reasoningEffort: currentEffort };

  const selected = models.find((model) => model.id === preferredModelId) ?? models[0];
  if (!selected) return { modelId: preferredModelId, isCustom: true, reasoningEffort: currentEffort };
  return {
    modelId: selected.id,
    isCustom: false,
    reasoningEffort: supportedEffort(selected, currentEffort),
  };
}

function supportedEffort(model: ModelOption, requested: ReasoningEffort): ReasoningEffort {
  const supported = model.reasoningEfforts;
  if (!supported?.length || supported.includes(requested)) return requested;
  return model.defaultReasoningEffort && supported.includes(model.defaultReasoningEffort)
    ? model.defaultReasoningEffort
    : supported[0] ?? "medium";
}
