// Forwards :8001 to supergateway on :8000 and holds each GET response for 50 ms,
// like a network hop between the agent and the MCP server. Logs one line per
// response: method, JSON-RPC method, status, mcp-session-id.
import http from "node:http";

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const rpc = req.method === "POST" ? (() => { try { return JSON.parse(body).method; } catch { return "?"; } })() : "";
    const upstream = http.request({ host: "127.0.0.1", port: 8000, path: req.url, method: req.method, headers: req.headers }, async (reply) => {
      if (req.method === "GET") await new Promise((resolve) => setTimeout(resolve, 50));
      console.log(req.method.padEnd(6), rpc.padEnd(26), reply.statusCode, req.headers["mcp-session-id"] ?? reply.headers["mcp-session-id"] ?? "-");
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => res.destroy());
    upstream.end(body);
  });
}).listen(8001, "127.0.0.1", () => console.log("proxy listening on http://127.0.0.1:8001/mcp"));
