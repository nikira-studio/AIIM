// Tests AIIM's actual HTTP MCP transport against an isolated local fixture.
const http = require("node:http");
const { McpManager } = require("../dist-electron/main/mcp.js");

async function main() {
  let changed = false;
  let invocations = 0;
  let authSeen = false;
  const schema = { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] };
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization === ["Bearer", "fixture-token"].join(" ")) authSeen = true;
    if (req.method === "GET" || req.method === "DELETE") { res.writeHead(405).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (message.method === "initialize") result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "fixture", version: "1" } };
    else if (message.method === "tools/list") result = { tools: [{ name: "sum", description: changed ? "Changed sum" : "Sum two numbers", inputSchema: schema }] };
    else if (message.method === "tools/call") { invocations++; result = { content: [{ type: "text", text: String(message.params.arguments.a + message.params.arguments.b) }] }; }
    else { res.writeHead(400).end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const manager = new McpManager();
  const connection = { id: "http-fixture", transport: "streamable-http", endpoint: `http://127.0.0.1:${server.address().port}/mcp` };
  const signal = AbortSignal.timeout(30000);
  try {
    const [tool] = await manager.discover(connection, "fixture-token", signal);
    if (!tool || !authSeen) throw new Error("HTTP discovery or token authorization failed.");
    if (!(await manager.call(connection, "fixture-token", tool, { a: 17, b: 25 }, signal)).includes("42")) throw new Error("HTTP tool result failed.");
    try { await manager.call(connection, "fixture-token", tool, { a: "bad", b: 25 }, signal); throw new Error("Invalid arguments were accepted."); } catch (error) { if (!String(error.message).includes("do not match")) throw error; }
    try { await manager.call(connection, "fixture-token", tool, { a: 17, b: 25 }, signal, () => false); throw new Error("Revoked permission was accepted."); } catch (error) { if (!String(error.message).includes("no longer available")) throw error; }
    changed = true;
    try { await manager.call(connection, "fixture-token", tool, { a: 17, b: 25 }, signal); throw new Error("Changed tool was accepted."); } catch (error) { if (!String(error.message).includes("changed before")) throw error; }
    if (invocations !== 1) throw new Error("An unauthorized call reached the server.");
    console.log("HTTP MCP discovery, token authorization, execution, validation, revocation, and changed-tool checks passed.");
  } finally { await manager.closeAll(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
