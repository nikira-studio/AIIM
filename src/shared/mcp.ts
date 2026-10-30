import type { McpToolDefinition } from "./types";

export function canonicalToolPayload(tool: Omit<McpToolDefinition, "fingerprint">): string {
  return stableJson({
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  });
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return "null";
}

export function boundedJson(value: unknown, maxDepth = 8, maxEntries = 160, maxStringLength = 20_000): unknown {
  let entries = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > maxDepth) throw new Error("Tool arguments are nested too deeply.");
    if (typeof item === "string") {
      if (item.length > maxStringLength) throw new Error("Tool arguments are too large.");
      return item;
    }
    if (item === null || typeof item === "boolean" || typeof item === "number") return item;
    if (Array.isArray(item)) return item.map((child) => { if (++entries > maxEntries) throw new Error("Tool arguments have too many values."); return visit(child, depth + 1); });
    if (typeof item === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item)) {
        if (++entries > maxEntries) throw new Error("Tool arguments have too many values.");
        output[key] = visit(child, depth + 1);
      }
      return output;
    }
    throw new Error("Tool arguments must be JSON data.");
  };
  return visit(value, 0);
}
