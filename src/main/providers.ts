import type { Buddy, ChatMessage, ProviderConfig, UserProfile } from "../shared/types";
import { buildBuddyInstructions } from "../shared/buddy-behavior";
import { readSseData } from "../shared/sse";

interface CompletionRequest { provider: ProviderConfig; apiKey?: string; buddy: Buddy; profile: UserProfile; messages: ChatMessage[]; signal: AbortSignal; instructionsOverride?: string; }
interface WireMessage { role: string; content: string; }

export async function streamCompletion(request: CompletionRequest, onDelta: (text: string) => void, onMemory?: (text: string) => void): Promise<void> {
  if (request.provider.kind !== "ollama" && !request.apiKey) throw new Error(`Add an API key for ${request.provider.name} in Preferences.`);
  const visible = createVisibleTextFilter(onDelta, onMemory);
  switch (request.provider.kind) {
    case "anthropic": await streamAnthropic(request, visible.push); break;
    case "google": await streamGoogle(request, visible.push); break;
    case "ollama": await streamOllama(request, visible.push); break;
    case "openai":
    case "minimax":
    case "openrouter":
    case "openai-compatible": await streamOpenAiCompatible(request, visible.push); break;
    case "openai-subscription": throw new Error("ChatGPT subscription requests use the authenticated subscription connection.");
    default: {
      const exhaustive: never = request.provider.kind;
      throw new Error(`Unsupported provider: ${exhaustive}`);
    }
  }
  visible.finish();
}

async function streamOllama(request: CompletionRequest, onDelta: (text: string) => void): Promise<void> {
  const baseUrl = request.provider.baseUrl ?? "http://localhost:11434";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ollamaChatBody(request.buddy.modelId, wireMessages(request))),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    throw new Error(`Could not reach Ollama at ${baseUrl}. Make sure Ollama is running.`);
  }
  await assertOk(response);
  await readNdjson(response, (payload) => {
    const text = extractOllamaVisibleDelta(payload);
    if (text) onDelta(text);
  });
}

export function extractOllamaVisibleDelta(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.message)) return undefined;
  return typeof payload.message.content === "string" && payload.message.content ? payload.message.content : undefined;
}

export function ollamaChatBody(model: string, messages: WireMessage[]): { model: string; stream: true; think: false; messages: WireMessage[] } {
  return { model, stream: true, think: false, messages };
}

async function streamOpenAiCompatible(request: CompletionRequest, onDelta: (text: string) => void): Promise<void> {
  const baseUrl = request.provider.baseUrl ?? (request.provider.kind === "openrouter" ? "https://openrouter.ai/api/v1" : request.provider.kind === "minimax" ? "https://api.minimax.io/v1" : "https://api.openai.com/v1");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({ model: request.buddy.modelId, stream: true, messages: wireMessages(request), ...(request.provider.kind === "openai" ? { reasoning_effort: request.buddy.reasoningEffort } : {}) }),
    signal: request.signal,
  });
  await assertOk(response);
  await readSseData(response, (data) => {
    if (data === "[DONE]") return;
    const payload: unknown = JSON.parse(data);
    const text = extractOpenAiVisibleDelta(payload);
    if (text) onDelta(text);
  }, "The provider returned an empty response.");
}

export function extractOpenAiVisibleDelta(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const first: unknown = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.delta)) return undefined;
  return typeof first.delta.content === "string" ? first.delta.content : undefined;
}

async function streamAnthropic(request: CompletionRequest, onDelta: (text: string) => void): Promise<void> {
  const response = await fetch(`${request.provider.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": request.apiKey ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: request.buddy.modelId, max_tokens: 4096, stream: true, system: instructions(request), messages: request.messages.map(({ role, content }) => ({ role, content })) }),
    signal: request.signal,
  });
  await assertOk(response);
  await readSseData(response, (data) => {
    const payload: unknown = JSON.parse(data);
    if (isRecord(payload) && payload.type === "content_block_delta" && isRecord(payload.delta) && typeof payload.delta.text === "string") onDelta(payload.delta.text);
  }, "The provider returned an empty response.");
}

async function streamGoogle(request: CompletionRequest, onDelta: (text: string) => void): Promise<void> {
  const endpoint = `${request.provider.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"}/models/${encodeURIComponent(request.buddy.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(request.apiKey ?? "")}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions(request) }] },
      contents: request.messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
    }),
    signal: request.signal,
  });
  await assertOk(response);
  await readSseData(response, (data) => {
    const payload: unknown = JSON.parse(data);
    if (!isRecord(payload) || !Array.isArray(payload.candidates)) return;
    const candidate: unknown = payload.candidates[0];
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return;
    for (const part of candidate.content.parts) if (isRecord(part) && part.thought !== true && typeof part.text === "string") onDelta(part.text);
  }, "The provider returned an empty response.");
}

function wireMessages(request: CompletionRequest): WireMessage[] {
  return [{ role: "system", content: instructions(request) }, ...request.messages.map(({ role, content }) => ({ role, content }))];
}

function instructions(request: CompletionRequest): string {
  return request.instructionsOverride ?? buildBuddyInstructions(request.buddy, request.profile);
}

async function readNdjson(response: Response, onData: (data: unknown) => void): Promise<void> {
  if (!response.body) throw new Error("Ollama returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onData(JSON.parse(line));
    if (chunk.done) break;
  }
  if (buffer.trim()) onData(JSON.parse(buffer));
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 500);
  throw new Error(`${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const hiddenTags = ["think", "thinking", "analysis", "memory"];

export function createVisibleTextFilter(onText: (text: string) => void, onMemory?: (text: string) => void): { push(text: string): void; finish(): void } {
  let buffer = "";
  let hiddenTag: string | undefined;
  let hiddenContent = "";
  let afterHidden = false;
  let emittedVisible = false;
  const opening = /<(think|thinking|analysis|memory)(?:\s[^>]*)?>/i;
  const closing = /<\/(?:think|thinking|analysis|memory)>/i;

  const drain = (final: boolean) => {
    while (buffer) {
      const marker = hiddenTag ? closing.exec(buffer) : opening.exec(buffer);
      if (marker?.index !== undefined) {
        if (!hiddenTag && marker.index > 0) emit(buffer.slice(0, marker.index));
        if (hiddenTag) hiddenContent += buffer.slice(0, marker.index);
        buffer = buffer.slice(marker.index + marker[0].length);
        if (hiddenTag) {
          if (hiddenTag === "memory" && hiddenContent.trim()) onMemory?.(hiddenContent.trim());
          hiddenTag = undefined;
          hiddenContent = "";
          afterHidden = true;
        } else {
          hiddenTag = marker[1]?.toLowerCase();
          hiddenContent = "";
        }
        continue;
      }
      if (hiddenTag) {
        const lastTag = buffer.lastIndexOf("<");
        if (lastTag >= 0) { hiddenContent += buffer.slice(0, lastTag); buffer = buffer.slice(lastTag); }
        else { hiddenContent += buffer; buffer = ""; }
        return;
      }
      if (afterHidden) {
        const trimmed = buffer.replace(/^\s+/, "");
        if (!trimmed && !final) { buffer = ""; return; }
        buffer = emittedVisible && trimmed ? ` ${trimmed}` : trimmed;
        afterHidden = false;
      }
      const lastTag = buffer.lastIndexOf("<");
      const possibleTag = lastTag >= 0 ? buffer.slice(lastTag).toLowerCase() : "";
      const isPartial = !final && possibleTag && hiddenTags.some((tag) => `<${tag}`.startsWith(possibleTag));
      const emitUntil = isPartial ? lastTag : buffer.length;
      if (emitUntil > 0) emit(buffer.slice(0, emitUntil));
      buffer = buffer.slice(emitUntil);
      return;
    }
  };

  return {
    push(text) { buffer += text; drain(false); },
    finish() { drain(true); buffer = ""; },
  };

  function emit(text: string): void {
    if (!text) return;
    emittedVisible = true;
    onText(text);
  }
}
