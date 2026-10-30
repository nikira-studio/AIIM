import { describe, expect, it } from "vitest";
import { validateToolArguments } from "./mcp";

describe("MCP tool input schema validation", () => {
  const sumSchema = {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    additionalProperties: false,
  };

  it.each([undefined, "https://json-schema.org/draft/2020-12/schema", "http://json-schema.org/draft-07/schema#"])("validates sum arguments with schema dialect %s", (dialect) => {
    const schema = { ...sumSchema, ...(dialect ? { $schema: dialect } : {}) };
    expect(() => validateToolArguments(schema, { a: 17, b: 25 })).not.toThrow();
    expect(() => validateToolArguments(schema, { a: "17", b: 25 })).toThrow("do not match");
    expect(() => validateToolArguments(schema, { a: 17 })).toThrow("do not match");
  });

  it("rejects an unknown schema dialect without running the tool", () => {
    expect(() => validateToolArguments({ ...sumSchema, $schema: "https://example.com/unknown" }, { a: 17, b: 25 })).toThrow("unsupported or invalid tool schema");
  });
});
