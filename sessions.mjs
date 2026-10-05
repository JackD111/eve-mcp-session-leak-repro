// Prints how many MCP server processes started by supergateway are still alive.
import { readdirSync } from "node:fs";

const started = (() => { try { return readdirSync(".sessions").map(Number); } catch { return []; } })();
const alive = started.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
console.log(`started=${started.length} alive=${alive.length}`);
