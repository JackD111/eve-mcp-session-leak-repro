// Minimal stdio MCP server with one `echo` tool. Each process records its PID in
// ./.sessions so `npm run sessions` can count the ones still alive.
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

mkdirSync(".sessions", { recursive: true });
writeFileSync(`.sessions/${process.pid}`, "");

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) continue;
  if (method === "initialize") send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo-stub", version: "1.0.0" } } });
  else if (method === "tools/list") send({ id, result: { tools: [{ name: "echo", description: "Echo the given text back.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
  else if (method === "tools/call") send({ id, result: { content: [{ type: "text", text: params.arguments.text }] } });
  else send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}
