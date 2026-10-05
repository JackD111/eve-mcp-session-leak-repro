import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: process.env.ECHO_MCP_URL ?? "http://127.0.0.1:8000/mcp",
  description: "Echo service. Its echo tool returns the text it is given.",
});
