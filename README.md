# eve MCP session leak reproduction

A fresh `npx eve@latest init` agent (eve 0.71.2) with one MCP connection, plus
the smallest stateful MCP server that shows two bugs:

1. **Every step leaks an MCP session.** eve never closes the MCP client a step
   creates, so its session and inbound SSE `GET` stay open until the eve
   process exits.
2. **The inbound SSE `GET` can be opened twice for one session.** When the
   server allows only one stream per session, the second `GET` gets `409`. The
   server then ends the session and the tool call fails with
   `400 No valid session ID provided`.

## What is in here

Everything except these files is untouched `eve init` output:

- `agent/connections/echo.ts` is one MCP connection. The URL defaults to
  `http://127.0.0.1:8000/mcp`, and `ECHO_MCP_URL` overrides it.
- `mcp-stub.mjs` is a dependency-free stdio MCP server with one `echo` tool.
  Each process writes its PID to `.sessions/`.
- `npm run mcp` serves it over Streamable HTTP with
  [supergateway](https://github.com/supercorp-ai/supergateway) 3.4.3 in
  stateful mode: one stub process per MCP session, a 60 s idle timeout, and the
  process killed when the session ends.
- `npm run sessions` prints how many stub processes started and how many are
  still alive. That is the number of open MCP sessions.
- `npm run proxy` (`latency-proxy.mjs`) forwards `:8001` to `:8000` and holds
  each `GET` response for 50 ms, like a network hop. It is only needed for
  bug 2, which does not reproduce reliably on loopback.

## Setup

Node 24. Put an AI Gateway credential in `.env.local`
(`AI_GATEWAY_API_KEY=...`), or run `npx eve link`.

```sh
npm install
```

## Bug 1: one leaked session per step

Terminal 1:

```sh
npm run mcp
```

Terminal 2:

```sh
npx eve dev --no-ui
```

Terminal 3:

```sh
S=$(curl -s -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"message":"Call the echo tool on the echo connection with the text \"one\", then reply with its result."}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessionId')
# wait for the reply (curl -sN http://127.0.0.1:2000/eve/v1/session/$S/stream shows turn.completed)
npm run sessions
```

```
started=2 alive=2
```

The turn ran two steps that touched the connection (`connection_search`, then
`connection_execute`), and each opened its own MCP session. Both are still
open. Send more turns:

```sh
for w in two three four; do
  curl -s -X POST http://127.0.0.1:2000/eve/v1/session/$S \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"Call the echo tool on the echo connection with the text \\\"$w\\\", then reply with its result.\"}"
  sleep 15
done
npm run sessions
```

```
started=5 alive=5
```

Wait past supergateway's 60 s idle timeout and check again. Nothing is closed,
because each session still has eve's inbound SSE `GET` open:

```sh
sleep 75; npm run sessions
lsof -nP -iTCP:8000 -sTCP:ESTABLISHED   # one connection per session, owned by the eve process
```

```
started=5 alive=5
```

The sessions go away only after you stop `eve dev`: the streams close, and
supergateway's idle timeout reaps them 60 s later.

## Bug 2: duplicate inbound `GET`, `409`, failed tool call

Restart with the 50 ms `GET` latency proxy in front of supergateway:

```sh
npm run mcp                                            # terminal 1
npm run proxy                                          # terminal 2
ECHO_MCP_URL=http://127.0.0.1:8001/mcp npx eve dev --no-ui   # terminal 3
```

Send the first message from bug 1 again. The proxy prints, per request,
the method, status and `mcp-session-id`:

```
POST 400 -                                    server/discover (expected: not supported)
POST 200 -                                    initialize
POST 202 01b66f2e-...                         notifications/initialized
POST 400 01b66f2e-...                         tools/list: "No valid session ID provided"
GET 400 -                                     inbound SSE opened before the session ID exists
GET 200 01b66f2e-...                          inbound SSE
GET 409 01b66f2e-...                          second inbound SSE for the same session
```

The proxy logs each line when the response arrives, so the order is response
order. The stream shows the failed call:

```
action.result {"error":{"code":"ACTION_RESULT_FAILED","message":"MCP HTTP Transport Error: POSTing to endpoint (HTTP 400): {\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"Bad Request: No valid session ID provided\"},\"id\":null}"}, ...}
```

The MCP SDK server transport answers the second `GET` with
`409 Conflict: Only one SSE stream is allowed per session` and also calls
`transport.onerror`. supergateway's stateful gateway kills the session's child
process and deletes the session in `onerror`, so the next request on that
session fails.
