# joy-agent

A minimal terminal coding agent — like a tiny Pi Coding Agent — with read / write / edit / bash tools,
powered by an Anthropic-compatible model (default: Cici Switch / Claude Sonnet).

```
─────────────────────────────────────────────
  for loop → model picks a tool → execute → repeat
─────────────────────────────────────────────
```

## Quick start

```bash
# env (already set if you use Cici Switch)
export ANTHROPIC_AUTH_TOKEN="..."          # or ANTHROPIC_API_KEY
export ANTHROPIC_BASE_URL="http://..."     # e.g. http://127.0.0.1:15721

# single-shot prompt
node dist/cli.js "list files in /tmp and summarize"

# interactive REPL
node dist/cli.js
```

Optional env vars:
- `JOY_MODEL` — model name override (default: `claude-sonnet-4-6`)
- `ANTHROPIC_DEFAULT_SONNET_MODEL` — fallback model name

## Commands

Inside the REPL:
- Type any prompt and hit Enter — the agent runs its for-loop automatically.
- `/exit` or `/quit` to quit.

## Development

```bash
npm run dev -- "your prompt here"             # run via tsx
npm run build && npm run start -- "prompt"    # build + run compiled JS
```

## Architecture

```
cli.ts          — REPL entry & inline prompt
agent.ts        — for-loop: model → tools → model → ...
tools.ts        — read, write, edit, bash implementations
```

- Tools follow the Anthropic Tool Use format. Every tool result (including errors) feeds back into the messages array.
- The loop stops when the model returns `stop_reason !== "tool_use"`.
- Max 25 tool-call iterations per user prompt (configurable).
