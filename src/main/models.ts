import type { ModelOption, ProviderConfig, ReasoningEffort } from "../shared/types";

const openAiEfforts: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

export const subscriptionFallbackModels: ModelOption[] = [
  { id: "gpt-5.6", name: "GPT-5.6 Sol", reasoningEfforts: openAiEfforts, defaultReasoningEffort: "medium" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (exact)", reasoningEfforts: openAiEfforts, defaultReasoningEffort: "medium" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", reasoningEfforts: openAiEfforts, defaultReasoningEffort: "medium" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", reasoningEfforts: openAiEfforts, defaultReasoningEffort: "medium" },
  { id: "gpt-5.5", name: "GPT-5.5", reasoningEfforts: openAiEfforts, defaultReasoningEffort: "medium" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
];

const minimaxModels: ModelOption[] = [
  "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2",
].map((id) => ({ id, name: id }));

export async function listProviderModels(provider: ProviderConfig, apiKey?: string, verifyConnection = false): Promise<ModelOption[]> {
  if (provider.kind === "openai-subscription") return subscriptionFallbackModels;
  if (provider.kind === "minimax" && !verifyConnection) return minimaxModels;
  if (provider.kind === "ollama") return listOllamaModels(provider);
  if (!apiKey) throw new Error(`Add an API key for ${provider.name} before loading models.`);
  if (provider.kind === "google") return listGoogleModels(provider, apiKey);
  if (provider.kind === "anthropic") return listAnthropicModels(provider, apiKey);
  return listOpenAiModels(provider, apiKey);
}

async function listOllamaModels(provider: ProviderConfig): Promise<ModelOption[]> {
  const baseUrl = provider.baseUrl ?? "http://localhost:11434";
  let response: Response;
  try { response = await fetchModels(`${baseUrl}/api/tags`); }
  catch { throw new Error(`Could not reach Ollama at ${baseUrl}. Make sure Ollama is running.`); }
  if (!response.ok) throw new Error(`Ollama at ${baseUrl} returned ${response.status}. Check the address in Preferences.`);
  const models = parseOllamaModels(await response.json());
  if (!models.length) throw new Error("Ollama is running, but no chat models were found. Install a model in Ollama first.");
  return models;
}

export function parseOllamaModels(value: unknown): ModelOption[] {
  if (!isRecord(value) || !Array.isArray(value.models)) return [];
  return value.models.flatMap((entry): ModelOption[] => {
    if (!isRecord(entry)) return [];
    const id = typeof entry.model === "string" ? entry.model : typeof entry.name === "string" ? entry.name : undefined;
    if (!id || /(?:^|[-_:])embed(?:ding)?(?:[-_:]|$)/i.test(id)) return [];
    const details = isRecord(entry.details) ? entry.details : undefined;
    const size = details && typeof details.parameter_size === "string" ? details.parameter_size : undefined;
    return [{ id, name: size ? `${id} (${size})` : id }];
  }).sort(byName);
}

export function parseSubscriptionModels(value: unknown): ModelOption[] {
  if (!isRecord(value) || !Array.isArray(value.models)) return [];
  return value.models.flatMap((entry): ModelOption[] => {
    if (!isRecord(entry) || typeof entry.slug !== "string") return [];
    const efforts = Array.isArray(entry.supported_reasoning_levels)
      ? entry.supported_reasoning_levels.flatMap((level): ReasoningEffort[] => isRecord(level) && isReasoningEffort(level.effort) ? [level.effort] : [])
      : [];
    const defaultEffort = isReasoningEffort(entry.default_reasoning_level) ? entry.default_reasoning_level : undefined;
    return [{ id: entry.slug, name: typeof entry.display_name === "string" ? entry.display_name : entry.slug, ...(efforts.length ? { reasoningEfforts: efforts } : {}), ...(defaultEffort ? { defaultReasoningEffort: defaultEffort } : {}) }];
  });
}

async function listOpenAiModels(provider: ProviderConfig, apiKey: string): Promise<ModelOption[]> {
  const baseUrl = provider.baseUrl ?? (provider.kind === "openrouter" ? "https://openrouter.ai/api/v1" : provider.kind === "minimax" ? "https://api.minimax.io/v1" : "https://api.openai.com/v1");
  const response = await fetchModels(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  const payload = await readJson(response);
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error("The provider returned an invalid model list.");
  return payload.data.flatMap((item): ModelOption[] => isRecord(item) && typeof item.id === "string" ? [withOpenAiCapabilities({ id: item.id, name: typeof item.name === "string" ? item.name : item.id })] : []).sort(byName);
}

async function listAnthropicModels(provider: ProviderConfig, apiKey: string): Promise<ModelOption[]> {
  const response = await fetchModels(`${provider.baseUrl ?? "https://api.anthropic.com"}/v1/models`, { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } });
  const payload = await readJson(response);
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error("Anthropic returned an invalid model list.");
  return payload.data.flatMap((item): ModelOption[] => isRecord(item) && typeof item.id === "string" ? [{ id: item.id, name: typeof item.display_name === "string" ? item.display_name : item.id }] : []).sort(byName);
}

async function listGoogleModels(provider: ProviderConfig, apiKey: string): Promise<ModelOption[]> {
  const baseUrl = provider.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const response = await fetchModels(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
  const payload = await readJson(response);
  if (!isRecord(payload) || !Array.isArray(payload.models)) throw new Error("Google returned an invalid model list.");
  return payload.models.flatMap((item): ModelOption[] => {
    if (!isRecord(item) || typeof item.name !== "string") return [];
    if (Array.isArray(item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes("generateContent")) return [];
    const id = item.name.replace(/^models\//, "");
    return [{ id, name: typeof item.displayName === "string" ? item.displayName : id }];
  }).sort(byName);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Could not load models (${response.status}).`);
  const payload: unknown = await response.json();
  return payload;
}

function byName(left: ModelOption, right: ModelOption): number { return left.name.localeCompare(right.name); }
async function fetchModels(url: string, init?: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("The provider did not answer within 20 seconds.");
    throw error;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function withOpenAiCapabilities(model: ModelOption): ModelOption { return /^gpt-(?:5\.[5-9]|6)/.test(model.id) ? { ...model, reasoningEfforts: openAiEfforts, defaultReasoningEffort: "medium" } : model; }
function isReasoningEffort(value: unknown): value is ReasoningEffort { return value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"; }
