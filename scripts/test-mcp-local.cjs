// Optional live check against the public MCP Everything test server.
const { McpManager } = require("../dist-electron/main/mcp.js");

async function main() {
  const manager = new McpManager();
  const connection = { id: "test-service", name: "Test service", transport: "stdio", command: "npx.cmd", args: ["-y", "@modelcontextprotocol/server-everything"], enabled: true, state: "ready", tools: [] };
  const signal = AbortSignal.timeout(120000);
  try {
    const tools = await manager.discover(connection, undefined, signal);
    const sum = tools.find((tool) => /sum/i.test(tool.name));
    if (!sum) throw new Error("The test server did not expose a sum tool.");
    const properties = sum.inputSchema.properties || {};
    const keys = Object.keys(properties);
    if (keys.length !== 2) throw new Error(`Unexpected sum parameters: ${keys.join(", ")}`);
    const result = await manager.call(connection, undefined, sum, { [keys[0]]: 17, [keys[1]]: 25 }, signal);
    if (!result.includes("42")) throw new Error(`Unexpected result: ${result}`);
    console.log("MCP local service discovery, validation, and sum call passed.");
  } finally { await manager.closeAll(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
