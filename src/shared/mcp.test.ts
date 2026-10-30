import { describe, expect, it } from "vitest";
import { boundedJson, canonicalToolPayload, stableJson } from "./mcp";

describe("MCP canonical data", () => {
  it("keeps a tool fingerprint payload stable when object keys are reordered", () => {
    const left = canonicalToolPayload({ name: "lookup", description: "Find a thing", inputSchema: { type: "object", properties: { city: { type: "string" }, units: { type: "string" } } }, annotations: { readOnlyHint: true } });
    const right = canonicalToolPayload({ name: "lookup", description: "Find a thing", inputSchema: { properties: { units: { type: "string" }, city: { type: "string" } }, type: "object" }, annotations: { readOnlyHint: true } });
    expect(left).toBe(right);
  });

  it("rejects deeply nested or overly large tool arguments", () => {
    expect(() => boundedJson({ a: { b: { c: { d: { e: { f: { g: { h: { i: true } } } } } } } } })).toThrow("nested too deeply");
    expect(() => boundedJson({ note: "x".repeat(20_001) })).toThrow("too large");
  });

  it("serializes arrays and primitive JSON deterministically", () => {
    expect(stableJson({ b: [true, null, 2], a: "ok" })).toBe('{"a":"ok","b":[true,null,2]}');
  });
});
