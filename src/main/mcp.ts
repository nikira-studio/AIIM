import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import type { McpConnection, McpToolDefinition } from "../shared/types";
import { boundedJson, canonicalToolPayload } from "../shared/mcp";

interface RuntimeConnection {
  client: Client;
  transport: StreamableHTTPClientTransport | StdioClientTransport;
}

export class McpManager {
  private readonly runtimes = new Map<string, RuntimeConnection>();

  async discover(connection: McpConnection, bearerToken?: string, signal?: AbortSignal): Promise<McpToolDefinition[]> {
    const runtime = await this.connected(connection, bearerToken, signal, true);
    const result = await runtime.client.listTools(undefined, { cacheMode: "refresh", signal });
    return result.tools.map(toToolDefinition).filter((tool): tool is McpToolDefinition => tool !== undefined);
  }

  async call(connection: McpConnection, bearerToken: string | undefined, tool: McpToolDefinition, argumentsValue: unknown, signal: AbortSignal, authorize?: () => boolean): Promise<string> {
    const runtime = await this.connected(connection, bearerToken, signal);
    const refreshed = await runtime.client.listTools(undefined, { cacheMode: "refresh", signal });
    const current = refreshed.tools.map(toToolDefinition).find((candidate): candidate is McpToolDefinition => candidate !== undefined && candidate.name === tool.name);
    if (!current || current.fingerprint !== tool.fingerprint) throw new Error("This tool changed before it could run. Review it again in Capabilities.");
    const args = boundedJson(argumentsValue);
    if (!isRecord(args)) throw new Error("Tool arguments must be an object.");
    validateToolArguments(current.inputSchema, args);
    if (signal.aborted || (authorize && !authorize())) throw new Error("That capability is no longer available.");
    const result = await runtime.client.callTool({ name: tool.name, arguments: args }, { signal });
    if (result.isError) throw new Error("The connected service could not complete that request.");
    const text = result.content.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n");
    const structured = result.structuredContent === undefined ? "" : JSON.stringify(boundedJson(result.structuredContent));
    const output = [text, structured].filter(Boolean).join("\n").slice(0, 24_000);
    if (!output) throw new Error("The connected service returned no usable result.");
    return output;
  }

  async close(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    this.runtimes.delete(id);
    await runtime?.client.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> { await Promise.all([...this.runtimes.keys()].map((id) => this.close(id))); }

  private async connected(connection: McpConnection, bearerToken: string | undefined, signal?: AbortSignal, replace = false): Promise<RuntimeConnection> {
    if (replace) await this.close(connection.id);
    const existing = this.runtimes.get(connection.id);
    if (existing) return existing;
    const client = new Client({ name: "AI Instant Messenger", version: "1.1.0" }, { versionNegotiation: { mode: "auto" } });
    const transport: StreamableHTTPClientTransport | StdioClientTransport = connection.transport === "streamable-http"
      ? new StreamableHTTPClientTransport(new URL(requiredEndpoint(connection)), {
        authProvider: bearerToken ? { token: async () => bearerToken } : undefined,
        requestInit: { redirect: "error" },
      })
      : new StdioClientTransport({ command: requiredCommand(connection), args: connection.args ?? [], env: getDefaultEnvironment(), stderr: "pipe", maxBufferSize: 1_000_000 });
    if (transport instanceof StdioClientTransport && transport.stderr) {
      let seen = 0;
      transport.stderr.on("data", (chunk: Buffer) => { seen += chunk.length; if (seen > 16_000) transport.stderr?.removeAllListeners("data"); });
    }
    try {
      await client.connect(transport, { signal });
      const runtime = { client, transport };
      this.runtimes.set(connection.id, runtime);
      return runtime;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }
}

export function validateToolArguments(schema: Record<string, unknown>, args: Record<string, unknown>): void {
  let validator: ReturnType<AjvJsonSchemaValidator["getValidator"]>;
  try {
    validator = new AjvJsonSchemaValidator().getValidator(schema);
  } catch {
    throw new Error("The connected service provided an unsupported or invalid tool schema.");
  }
  if (!validator(args).valid) throw new Error("The requested tool arguments do not match the reviewed tool.");
}

export function toToolDefinition(value: unknown): McpToolDefinition | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name || !isRecord(value.inputSchema)) return undefined;
  const tool = {
    name: value.name,
    ...(typeof value.title === "string" ? { title: value.title.slice(0, 400) } : {}),
    ...(typeof value.description === "string" ? { description: value.description.slice(0, 4_000) } : {}),
    inputSchema: boundedJson(value.inputSchema) as Record<string, unknown>,
    ...(isRecord(value.outputSchema) ? { outputSchema: boundedJson(value.outputSchema) as Record<string, unknown> } : {}),
    ...(isRecord(value.annotations) ? { annotations: boundedJson(value.annotations) as Record<string, unknown> } : {}),
  } satisfies Omit<McpToolDefinition, "fingerprint">;
  return { ...tool, fingerprint: createHash("sha256").update(canonicalToolPayload(tool)).digest("hex") };
}

function requiredEndpoint(connection: McpConnection): string {
  if (!connection.endpoint) throw new Error("This connected service needs a web address.");
  return connection.endpoint;
}

function requiredCommand(connection: McpConnection): string {
  if (!connection.command) throw new Error("This connected service needs a local program.");
  return connection.command;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
