import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { readSseData } from "../shared/sse";
import path from "node:path";
import { safeStorage } from "electron";
import type { Buddy, ChatMessage, ModelOption, SubscriptionStatus, UserProfile } from "../shared/types";
import { createVisibleTextFilter } from "./providers";
import { buildBuddyInstructions } from "../shared/buddy-behavior";
import { parseSubscriptionModels, subscriptionFallbackModels } from "./models";
import { appVersion } from "../shared/version";

const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const issuer = "https://auth.openai.com";
const responseEndpoint = "https://chatgpt.com/backend-api/codex/responses";
const callbackPort = 1455;
const callbackUrl = `http://localhost:${callbackPort}/auth/callback`;

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  accountId?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

interface Claims {
  email?: string;
  chatgpt_account_id?: string;
  chatgpt_plan_type?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    chatgpt_plan_type?: string;
  };
}

interface StreamInput {
  buddy: Buddy;
  profile: UserProfile;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onMemory?: (text: string) => void;
  instructionsOverride?: string;
}

export class OpenAiSubscriptionClient {
  private tokens?: StoredTokens;
  private refreshPromise?: Promise<StoredTokens>;
  private sessionEpoch = 0;
  private readonly tokenPath: string;

  constructor(private readonly directory: string) {
    this.tokenPath = path.join(directory, "openai-subscription.bin");
  }

  async load(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const encrypted = await fs.readFile(this.tokenPath);
      this.tokens = parseStoredTokens(JSON.parse(safeStorage.decryptString(encrypted)) as unknown);
    } catch (error) {
      if (!isMissingFile(error)) this.tokens = undefined;
    }
  }

  async status(): Promise<SubscriptionStatus> {
    if (!safeStorage.isEncryptionAvailable()) return { kind: "unavailable", message: "Windows credential encryption is unavailable." };
    if (!this.tokens) return { kind: "signed-out" };
    const claims = parseClaims(this.tokens.idToken) ?? parseClaims(this.tokens.accessToken);
    return {
      kind: "signed-in",
      ...(claims?.email ? { email: claims.email } : {}),
      plan: friendlyPlan(claims),
    };
  }

  async connect(openExternal: (url: string) => Promise<void>): Promise<SubscriptionStatus> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(32));
    const server = await listenForCallback(state);
    const authorizeUrl = new URL(`${issuer}/oauth/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "ai-messenger",
    }).toString();

    try {
      await openExternal(authorizeUrl.toString());
      const code = await server.code;
      const response = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl, client_id: clientId, code_verifier: verifier }),
      });
      const exchanged = await readTokenResponse(response, "ChatGPT sign-in");
      if (!exchanged.refresh_token) throw new Error("ChatGPT sign-in did not return a refresh token.");
      this.tokens = toStoredTokens(exchanged);
      await this.save();
      return this.status();
    } finally {
      server.close();
    }
  }

  async disconnect(): Promise<SubscriptionStatus> {
    this.sessionEpoch += 1;
    await fs.rm(this.tokenPath, { force: true });
    this.tokens = undefined;
    this.refreshPromise = undefined;
    return this.status();
  }

  async stream(input: StreamInput): Promise<void> {
    const tokens = await this.validTokens();
    const visible = createVisibleTextFilter(input.onDelta, input.onMemory);
    const response = await fetch(responseEndpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "chatgpt-account-id": tokens.accountId ?? "",
        "content-type": "application/json",
        originator: "ai-messenger",
        "user-agent": `AIIM/${appVersion}`,
      },
      body: JSON.stringify({
        model: input.buddy.modelId,
        instructions: input.instructionsOverride ?? buildBuddyInstructions(input.buddy, input.profile),
        input: input.messages.map((message) => ({
          role: message.role,
          content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content }],
        })),
        stream: true,
        store: false,
        reasoning: { effort: input.buddy.reasoningEffort },
      }),
      signal: input.signal,
    });
    await assertOk(response);
    await readSse(response, (payload) => {
      if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") visible.push(payload.delta);
    });
    visible.finish();
  }

  async models(): Promise<ModelOption[]> {
    const tokens = await this.validTokens();
    try {
      const response = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(appVersion)}`, {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          "chatgpt-account-id": tokens.accountId ?? "",
          originator: "ai-messenger",
          "user-agent": `AIIM/${appVersion}`,
        },
      });
      await assertOk(response);
      const payload: unknown = await response.json();
      const models = parseSubscriptionModels(payload);
      return models.length ? models : subscriptionFallbackModels;
    } catch {
      return subscriptionFallbackModels;
    }
  }

  private async validTokens(): Promise<StoredTokens> {
    if (!this.tokens) throw new Error("Connect your ChatGPT subscription in Preferences first.");
    if (this.tokens.expiresAt > Date.now() + 30_000) return this.tokens;
    this.refreshPromise ??= this.refresh(this.tokens, this.sessionEpoch).finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async refresh(current: StoredTokens, epoch: number): Promise<StoredTokens> {
    const response = await fetch(`${issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refreshToken, client_id: clientId }),
    });
    const refreshed = await readTokenResponse(response, "ChatGPT session refresh");
    if (epoch !== this.sessionEpoch) throw new Error("The ChatGPT session was disconnected.");
    this.tokens = toStoredTokens(refreshed, current);
    await this.save();
    return this.tokens;
  }

  private async save(): Promise<void> {
    if (!this.tokens || !safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    await fs.writeFile(this.tokenPath, safeStorage.encryptString(JSON.stringify(this.tokens)));
  }
}

function listenForCallback(expectedState: string): Promise<{ code: Promise<string>; close(): void }> {
  let server: Server;
  const code = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("ChatGPT sign-in timed out.")), 5 * 60_000);
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", callbackUrl);
      if (url.pathname !== "/auth/callback") { response.writeHead(404).end("Not found"); return; }
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      const authorizationCode = url.searchParams.get("code");
      if (error || !authorizationCode || url.searchParams.get("state") !== expectedState) {
        const message = error ?? (!authorizationCode ? "Missing authorization code." : "The sign-in response could not be verified.");
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(callbackPage(message, false));
        clearTimeout(timeout);
        reject(new Error(message));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(callbackPage("You can close this window and return to AI Instant Messenger.", true));
      clearTimeout(timeout);
      resolve(authorizationCode);
    });
    server.once("error", (error) => { clearTimeout(timeout); reject(new Error(`Could not start ChatGPT sign-in: ${error.message}`)); });
    server.listen(callbackPort, "127.0.0.1");
  });
  return Promise.resolve({ code, close: () => server?.close() });
}

function callbackPage(message: string, success: boolean): string {
  const safeMessage = message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
  return `<!doctype html><meta charset="utf-8"><title>AI Instant Messenger</title><style>body{font:16px system-ui;background:#efefe7;color:#222;display:grid;place-items:center;height:100vh;margin:0}.box{border:1px solid #999;background:white;padding:28px;max-width:460px;box-shadow:4px 4px #bbb}h1{color:${success ? "#245d20" : "#8b1e1e"}}</style><div class="box"><h1>${success ? "ChatGPT connected" : "Sign-in failed"}</h1><p>${safeMessage}</p></div>`;
}

function toStoredTokens(tokens: TokenResponse, previous?: StoredTokens): StoredTokens {
  const accessToken = requiredString(tokens.access_token, "access token");
  const idToken = tokens.id_token ?? previous?.idToken;
  return {
    accessToken,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? "",
    ...(idToken ? { idToken } : {}),
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: accountId(idToken, accessToken) ?? previous?.accountId,
  };
}

function parseStoredTokens(value: unknown): StoredTokens | undefined {
  if (!isRecord(value) || typeof value.accessToken !== "string" || typeof value.refreshToken !== "string" || typeof value.expiresAt !== "number") return undefined;
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, ...(typeof value.idToken === "string" ? { idToken: value.idToken } : {}), ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}) };
}

function parseClaims(token?: string): Claims | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try { const value: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); return isRecord(value) ? value as Claims : undefined; }
  catch { return undefined; }
}

function accountId(...tokens: Array<string | undefined>): string | undefined {
  for (const token of tokens) {
    const claims = parseClaims(token);
    const value = claims?.chatgpt_account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? claims?.organizations?.[0]?.id;
    if (value) return value;
  }
  return undefined;
}

function friendlyPlan(claims?: Claims): string {
  const plan = claims?.chatgpt_plan_type ?? claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type;
  return plan ? `ChatGPT ${plan.slice(0, 1).toUpperCase()}${plan.slice(1)}` : "ChatGPT subscription";
}

async function readTokenResponse(response: Response, operation: string): Promise<TokenResponse> {
  if (!response.ok) throw new Error(`${operation} failed (${response.status}).`);
  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value.access_token !== "string") throw new Error(`${operation} returned an invalid response.`);
  return value as unknown as TokenResponse;
}

async function readSse(response: Response, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  await readSseData(response, (data) => {
    if (data === "[DONE]") return;
    const value: unknown = JSON.parse(data);
    if (isRecord(value)) onEvent(value);
  }, "ChatGPT returned an empty response.");
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 400);
  throw new Error(`ChatGPT request failed (${response.status})${body ? `: ${body}` : "."}`);
}

function requiredString(value: unknown, label: string): string { if (typeof value !== "string" || !value) throw new Error(`Missing ${label}.`); return value; }
function base64Url(value: Buffer): string { return value.toString("base64url"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isMissingFile(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
