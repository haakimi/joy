# joy-agent

A minimal terminal coding agent — like a tiny Pi Coding Agent — with read / list_files / glob / grep / write / edit / bash tools,
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
- `JOY_PROVIDER` — provider selection: `anthropic`, `mock`, or `glm` (default: `anthropic`)
- `JOY_MODEL` — model name override (default depends on provider)
- `ANTHROPIC_DEFAULT_SONNET_MODEL` — fallback Anthropic model name

## Providers

Joy uses a provider architecture so the agent loop can run against different model backends.

- `anthropic` — current real provider; uses `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` and optional `ANTHROPIC_BASE_URL`.
- `mock` — deterministic local provider for developing and testing the agent loop without network access.
- `glm` — reserved skeleton for future GLM support. It does not call the real GLM API yet.

Select a provider with:

```sh
JOY_PROVIDER=mock joy "hello"
JOY_PROVIDER=anthropic joy doctor
JOY_PROVIDER=glm joy doctor
```

Mock scripted responses can be provided with `JOY_MOCK_RESPONSES` as a JSON array of provider responses.

`~/.joy-agent/config.json` can include provider settings:

```json
{
  "JOY_PROVIDER": "mock",
  "JOY_MODEL": "mock"
}
```

Future GLM placeholders can be recorded, but GLM is not implemented until API access is available:

```json
{
  "JOY_PROVIDER": "glm",
  "ZHIPUAI_API_KEY": "...",
  "JOY_MODEL": "glm"
}
```

## Commands

Inside the REPL:
- Type any prompt and hit Enter — the agent runs its for-loop automatically.
- `/exit` or `/quit` to quit.

## Eval harness

Joy includes a small local eval harness for testing agent-loop behavior without needing a real model API.

```sh
node dist/cli.js eval                  # run every case in evals/cases/*
node dist/cli.js eval --list           # list case names without running them
node dist/cli.js eval single-file-bugfix
node dist/cli.js eval --case single-file-bugfix
node dist/cli.js eval --cases-dir ./evals/cases
node dist/cli.js eval --provider mock  # override case provider at runtime
node dist/cli.js eval --model mock      # override case model at runtime
node dist/cli.js eval --json            # print a machine-readable report
node dist/cli.js eval --keep-runs       # keep passing run directories for inspection
```

Each eval case is a directory with a `case.json` manifest containing:
- `prompt` — the user task sent to Joy
- `provider` / `model` — usually `mock` / `mock` for deterministic local tests
- `files` — initial workspace files written into an isolated temp run directory
- `mockResponses` — scripted provider responses, including tool calls
- `verify` — a shell command plus expected exit code/stdout/stderr checks

Built-in cases:
- `single-file-bugfix` — English single-file edit.
- `zh-single-file-bugfix` — Chinese prompt plus single-file edit.
- `zh-multi-file-bugfix` — Chinese prompt plus multi-file project.
- `read-and-answer` — read-only code/document understanding flow.

By default, passing run directories are deleted and failing run directories are kept for debugging. Use `--keep-runs` to keep every run directory.

## Development

```bash
npm run dev -- "your prompt here"             # run via tsx
npm run build && npm run start -- "prompt"    # build + run compiled JS
```

## Architecture

```
cli.ts          — REPL entry & inline prompt
agent.ts        — for-loop: model → tools → model → ...
tools.ts        — read, list_files, glob, grep, write, edit, bash implementations
```

- Tools follow the Anthropic Tool Use format. Every tool result (including errors) feeds back into the messages array.
- Use `list_files`, `glob`, and `grep` for capped code discovery before falling back to shell search commands.
- The loop stops when the model returns `stop_reason !== "tool_use"`.
- Max 25 tool-call iterations per user prompt (configurable).
