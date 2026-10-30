// Optional live check: node scripts/test-ollama-tools.cjs [model]
const { providerToolTurn } = require("../dist-electron/main/providers.js");

async function main() {
  const request = {
    provider: { kind: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434" },
    buddy: { modelId: process.argv[2] || "qwen3:4b" },
    messages: [{ role: "user", content: "Use the sum tool to add 17 and 25. Do not calculate it yourself." }],
    instructionsOverride: "You are a helpful assistant. Use the available tool when asked.",
    signal: AbortSignal.timeout(180000),
  };
  const tools = [{ name: "aiim_tool_1", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } }];
  const first = await providerToolTurn(request, tools);
  if (first.kind !== "tool" || first.name !== "aiim_tool_1" || first.argumentsValue.a !== 17 || first.argumentsValue.b !== 25) throw new Error(`Unexpected first response: ${JSON.stringify(first)}`);
  const final = await providerToolTurn(request, tools, { assistantMessage: first.assistantMessage, callId: first.id, toolName: first.name, argumentsJson: JSON.stringify(first.argumentsValue), result: "42" });
  if (final.kind !== "final" || !final.text.includes("42")) throw new Error(`Unexpected final response: ${JSON.stringify(final)}`);
  console.log(`Ollama tool-call round trip passed for ${request.buddy.modelId}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
