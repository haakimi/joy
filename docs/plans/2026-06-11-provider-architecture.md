# Provider Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Joy Agent so the model backend is provider-based, keeping Anthropic as the current working provider, adding a deterministic mock provider for local agent-loop testing, and reserving a GLM provider skeleton for future API access.

**Architecture:** Introduce a provider boundary between `runAgent` and the model API. The agent loop will operate on Joy-owned request/response types, while provider adapters translate between Joy types and vendor SDK/wire formats. Anthropic remains the default real provider; mock provides scripted responses for tests; GLM initially validates configuration and fails with a clear “not implemented/API unavailable” message.

**Tech Stack:** TypeScript ESM, Node.js built-in test runner (`node --import tsx --test`), existing `@anthropic-ai/sdk`, existing local tools in `src/tools.ts`.

---

## Current Context

- `src/agent.ts` currently imports `@anthropic-ai/sdk` directly and owns both the agent loop and Anthropic message conversion.
- `src/config.ts` currently resolves Anthropic-oriented auth/baseURL/model fields only.
- `src/cli.ts`, `src/repl.ts`, and `src/ui/App.tsx` pass only `model` into `runAgent`.
- Existing tests are under `tests/*.test.ts` and run with `npm test`.
- The project tracks `dist/`, so after implementation run `npm run build` and include matching `dist/` changes.

## Provider Types

Use Joy-owned types so `runAgent` is not coupled to Anthropic block names.

Create `src/providers/types.ts`:

```ts
import type { ToolDef } from "../tools.js";

export type ProviderName = "anthropic" | "mock" | "glm";

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type ProviderMessage = {
  role: "user" | "assistant";
  content: string | ProviderContentBlock[] | ProviderToolResultBlock[];
};

export type ProviderToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ProviderStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded"
  | string;

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ProviderRequest = {
  model: string;
  maxTokens: number;
  system: string;
  tools: ToolDef[];
  messages: ProviderMessage[];
  signal?: AbortSignal;
};

export type ProviderResponse = {
  content: ProviderContentBlock[];
  stopReason: ProviderStopReason;
  usage: ProviderUsage;
  raw?: unknown;
};

export interface ModelProvider {
  name: ProviderName;
  createMessage(request: ProviderRequest): Promise<ProviderResponse>;
}
```

Important constraints:

- Do not add streaming in this phase. Leave room for `streamMessage` later, but YAGNI for now.
- Do not model every Anthropic block type yet. Joy currently only uses text and tool_use.
- Preserve full assistant content in Joy history as provider blocks so future provider adapters can round-trip tool calls.

---

### Task 1: Extend Config With Provider Selection

**Files:**
- Modify: `src/config.ts:5-11`, `src/config.ts:29-132`, `src/config.ts:135-154`
- Test: `tests/config.test.ts`

**Step 1: Write failing tests**

Create `tests/config.test.ts` with tests for provider precedence. Use temporary config files only if you first add test seams; simplest initial tests can target exported picker helpers if you export them. Prefer exporting small pure helpers over filesystem-heavy tests.

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { pickProviderFromConfig } from "../src/config.ts";

test("provider defaults to anthropic when unspecified", () => {
  assert.equal(pickProviderFromConfig({}), "anthropic");
});

test("provider can be read from JOY_PROVIDER env-shaped config", () => {
  assert.equal(pickProviderFromConfig({ env: { JOY_PROVIDER: "mock" } }), "mock");
});

test("provider can be read from provider config key", () => {
  assert.equal(pickProviderFromConfig({ provider: "glm" }), "glm");
});

test("unknown provider falls back to anthropic", () => {
  assert.equal(pickProviderFromConfig({ provider: "bogus" }), "anthropic");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `pickProviderFromConfig` does not exist.

**Step 3: Implement minimal config changes**

Update `ResolvedConfig`:

```ts
export interface ResolvedConfig {
  provider: "anthropic" | "mock" | "glm";
  authToken?: string;
  baseURL?: string;
  model?: string;
  skillRoots: string[];
  source: string[];
}
```

Add pure helper:

```ts
export function pickProviderFromConfig(obj: any): "anthropic" | "mock" | "glm" {
  if (!obj || typeof obj !== "object") return "anthropic";
  const env = obj.env ?? obj.environment ?? {};
  const value = String(env.JOY_PROVIDER ?? obj.JOY_PROVIDER ?? obj.provider ?? "anthropic").toLowerCase();
  return value === "mock" || value === "glm" || value === "anthropic" ? value : "anthropic";
}
```

Update `resolveConfig()`:

- Initialize `let provider: "anthropic" | "mock" | "glm" = "anthropic";`
- Read `process.env.JOY_PROVIDER` before config files.
- For each config file, set provider only if env did not already set it.
- Return `{ provider, authToken, baseURL, model, skillRoots, source }`.

Update `writeUserConfig` input:

```ts
provider?: "anthropic" | "mock" | "glm";
```

Write `JOY_PROVIDER` when provided.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test
```

Expected: PASS for new config tests and existing tests.

**Step 5: Commit checkpoint**

Do not commit unless the user asks. If asked:

```bash
git add src/config.ts tests/config.test.ts package.json
npm test
git commit -m "refactor: add provider config selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add Provider Registry And Anthropic Adapter

**Files:**
- Create: `src/providers/types.ts`
- Create: `src/providers/anthropic.ts`
- Create: `src/providers/index.ts`
- Modify: `src/agent.ts:1-3`, `src/agent.ts:133-233`, `src/agent.ts:269-367`
- Test: `tests/providers.test.ts`

**Step 1: Write failing provider conversion tests**

Create `tests/providers.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAnthropicResponse } from "../src/providers/anthropic.ts";

test("normalizes Anthropic text and tool_use blocks", () => {
  const response = normalizeAnthropicResponse({
    content: [
      { type: "text", text: "hello" },
      { type: "tool_use", id: "toolu_1", name: "read", input: { path: "README.md" } },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  assert.deepEqual(response, {
    content: [
      { type: "text", text: "hello" },
      { type: "tool_use", id: "toolu_1", name: "read", input: { path: "README.md" } },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 5 },
    raw: undefined,
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because provider files do not exist.

**Step 3: Implement `src/providers/types.ts`**

Use the Provider Types section exactly, importing `ToolDef` from `../tools.js`.

**Step 4: Implement `src/providers/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderToolResultBlock,
} from "./types.js";

function toAnthropicContent(content: ProviderMessage["content"]): any {
  return content;
}

function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  })) as Anthropic.MessageParam[];
}

export function normalizeAnthropicResponse(resp: any): ProviderResponse {
  const content: ProviderContentBlock[] = (resp.content ?? [])
    .filter((block: any) => block.type === "text" || block.type === "tool_use")
    .map((block: any) => {
      if (block.type === "text") return { type: "text", text: String(block.text ?? "") };
      return {
        type: "tool_use",
        id: String(block.id),
        name: String(block.name),
        input: block.input ?? {},
      };
    });

  return {
    content,
    stopReason: resp.stop_reason ?? "end_turn",
    usage: {
      inputTokens: Number(resp.usage?.input_tokens ?? 0),
      outputTokens: Number(resp.usage?.output_tokens ?? 0),
    },
    raw: resp.raw,
  };
}

export class AnthropicProvider implements ModelProvider {
  name = "anthropic" as const;

  constructor(private readonly client: Anthropic) {}

  async createMessage(request: ProviderRequest): Promise<ProviderResponse> {
    const resp = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      tools: request.tools,
      messages: toAnthropicMessages(request.messages),
    });
    return normalizeAnthropicResponse(resp);
  }
}
```

Do not pass `signal` into Anthropic SDK yet unless the SDK supports it in this project’s installed version. Preserve current abort checks around calls in `runAgent`.

**Step 5: Implement `src/providers/index.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ResolvedConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import type { ModelProvider } from "./types.js";

export function createProvider(config: ResolvedConfig): ModelProvider {
  if (config.provider === "anthropic") {
    return new AnthropicProvider(new Anthropic({
      apiKey: config.authToken,
      baseURL: config.baseURL,
    }));
  }
  throw new Error(`Provider not implemented: ${config.provider}`);
}
```

Mock and GLM will be added in later tasks.

**Step 6: Refactor `src/agent.ts` to call provider**

Replace direct Anthropic client construction in `runAgent` with:

```ts
const provider = createProvider(config);
```

Change `messages` type from `Anthropic.MessageParam[]` to `ProviderMessage[]` in `runAgent` internal state. Keep `AgentOptions.initialMessages` backward-compatible for now by either:

- changing it to `ProviderMessage[]`, then updating callers/tests, or
- temporarily accepting `any[]` and normalizing.

Recommended minimal clean approach:

```ts
import type { ProviderMessage, ProviderToolResultBlock } from "./providers/types.js";
```

Update `AgentOptions`:

```ts
onCompact?: (summary: string, tokensSaved: number) => ProviderMessage[];
initialMessages?: ProviderMessage[];
```

Update compaction signature to use provider for the summary request instead of Anthropic client:

```ts
async function compressConversation(
  provider: ModelProvider,
  model: string,
  messages: ProviderMessage[],
  system: string,
): Promise<{ summary: string; tokensSaved: number }> {
  const resp = await provider.createMessage({
    model,
    maxTokens: 4096,
    system: `${system}\n\n${COMPACT_SUMMARY_PROMPT}`,
    tools: [],
    messages,
  });
  const summary = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  ...
}
```

Update the main model request:

```ts
const resp = await provider.createMessage({
  model: opts.model,
  maxTokens: opts.maxTokens ?? maxTokensDefault,
  system,
  tools,
  messages,
  signal,
});
```

Update all `resp.stop_reason` references to `resp.stopReason`.

Update usage reads to `resp.usage.inputTokens` and `resp.usage.outputTokens`.

Update assistant append:

```ts
messages.push({ role: "assistant", content: resp.content });
```

Update tool results type:

```ts
const results: ProviderToolResultBlock[] = [];
```

Push:

```ts
results.push({
  type: "tool_result",
  tool_use_id: tu.id,
  content,
  is_error,
});
```

**Step 7: Run tests**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and TypeScript compiles.

---

### Task 3: Add Mock Provider For Deterministic Agent Loop Testing

**Files:**
- Create: `src/providers/mock.ts`
- Modify: `src/providers/index.ts`
- Test: `tests/mockProvider.test.ts`
- Test: `tests/agentLoop.mock.test.ts`

**Step 1: Write failing mock provider unit tests**

Create `tests/mockProvider.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { MockProvider } from "../src/providers/mock.ts";

test("mock provider returns scripted responses in order", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "first" }], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
    { content: [{ type: "text", text: "second" }], stopReason: "end_turn", usage: { inputTokens: 2, outputTokens: 2 } },
  ]);

  const base = { model: "mock", maxTokens: 100, system: "", tools: [], messages: [] };
  assert.equal((await provider.createMessage(base)).content[0].type, "text");
  assert.equal((await provider.createMessage(base)).usage.inputTokens, 2);
});

test("mock provider fails clearly when script is exhausted", async () => {
  const provider = new MockProvider([]);
  await assert.rejects(
    () => provider.createMessage({ model: "mock", maxTokens: 100, system: "", tools: [], messages: [] }),
    /Mock provider has no scripted response/,
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/providers/mock.ts` does not exist.

**Step 3: Implement `src/providers/mock.ts`**

```ts
import type { ModelProvider, ProviderRequest, ProviderResponse } from "./types.js";

export class MockProvider implements ModelProvider {
  name = "mock" as const;
  private index = 0;

  constructor(private readonly script: ProviderResponse[]) {}

  async createMessage(_request: ProviderRequest): Promise<ProviderResponse> {
    const response = this.script[this.index++];
    if (!response) {
      throw new Error("Mock provider has no scripted response left");
    }
    return response;
  }
}

export function mockScriptFromEnv(): ProviderResponse[] {
  const raw = process.env.JOY_MOCK_RESPONSES;
  if (!raw) {
    return [{
      content: [{ type: "text", text: "mock response" }],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("JOY_MOCK_RESPONSES must be a JSON array");
  return parsed;
}
```

**Step 4: Register mock provider**

Modify `src/providers/index.ts`:

```ts
import { MockProvider, mockScriptFromEnv } from "./mock.js";

if (config.provider === "mock") {
  return new MockProvider(mockScriptFromEnv());
}
```

**Step 5: Add agent loop test using mock provider**

To avoid global env coupling, first consider changing `runAgent` to accept an internal testing override:

```ts
/** Internal: override provider for tests. */
provider?: ModelProvider;
```

Then create `tests/agentLoop.mock.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../src/agent.ts";
import { MockProvider } from "../src/providers/mock.ts";

test("runAgent executes a tool call and returns final mock text", async () => {
  const events: string[] = [];
  const provider = new MockProvider([
    {
      content: [{ type: "tool_use", id: "toolu_1", name: "read", input: { path: "package.json" } }],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "done" }],
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);

  const result = await runAgent("read package", {
    model: "mock",
    provider,
    maxIterations: 3,
    skills: [],
    onEvent: (e) => events.push(e.type),
  });

  assert.equal(result, "done");
  assert.deepEqual(events.filter((e) => e === "tool_call" || e === "tool_result"), ["tool_call", "tool_result"]);
});
```

If this test reads real `package.json`, it is acceptable because the existing `read` tool already supports it and the file exists. Avoid write/edit/bash in the first mock loop test.

**Step 6: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and build succeeds.

---

### Task 4: Add GLM Provider Skeleton

**Files:**
- Create: `src/providers/glm.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/config.ts`
- Test: `tests/glmProvider.test.ts`

**Step 1: Write failing GLM skeleton tests**

Create `tests/glmProvider.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { GlmProvider } from "../src/providers/glm.ts";

test("glm provider reports missing API implementation clearly", async () => {
  const provider = new GlmProvider({ apiKey: undefined, baseURL: undefined });

  await assert.rejects(
    () => provider.createMessage({ model: "glm", maxTokens: 100, system: "", tools: [], messages: [] }),
    /GLM provider is reserved but not implemented/,
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: FAIL because `src/providers/glm.ts` does not exist.

**Step 3: Implement `src/providers/glm.ts`**

```ts
import type { ModelProvider, ProviderRequest, ProviderResponse } from "./types.js";

export interface GlmProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

export class GlmProvider implements ModelProvider {
  name = "glm" as const;

  constructor(private readonly config: GlmProviderConfig) {}

  async createMessage(_request: ProviderRequest): Promise<ProviderResponse> {
    throw new Error(
      "GLM provider is reserved but not implemented because no GLM API access is available yet. " +
        "Set JOY_PROVIDER=anthropic for real calls or JOY_PROVIDER=mock for local agent-loop tests.",
    );
  }
}
```

**Step 4: Register GLM provider**

Modify `src/providers/index.ts`:

```ts
import { GlmProvider } from "./glm.js";

if (config.provider === "glm") {
  return new GlmProvider({ apiKey: config.authToken, baseURL: config.baseURL });
}
```

**Step 5: Add GLM config aliases without making real calls**

Modify `src/config.ts` token/baseURL pickers:

- `ZHIPUAI_API_KEY`
- `GLM_API_KEY`
- `ZHIPUAI_BASE_URL`
- `GLM_BASE_URL`

Do not let these override Anthropic values unless provider is `glm` or no Anthropic value exists. Recommended simple rule for this phase:

- `pickToken` returns Anthropic tokens first, then GLM tokens.
- `pickBaseURL` returns Anthropic base first, then GLM base.
- Later provider-specific credential precedence can be refined.

Add tests in `tests/config.test.ts`:

```ts
test("token picker accepts GLM env-shaped keys", () => {
  assert.equal(pickTokenFromConfig({ env: { ZHIPUAI_API_KEY: "zhipu-key" } }), "zhipu-key");
});
```

This requires exporting `pickTokenFromConfig` or renaming existing `pickToken` to an exported helper.

**Step 6: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and build succeeds. No real GLM network call is attempted.

---

### Task 5: Thread Provider Through CLI, REPL, TUI, Doctor

**Files:**
- Modify: `src/cli.ts:65-87`, `src/cli.ts:90-151`, `src/cli.ts:181-256`
- Modify: `src/repl.ts:77-176`
- Modify: `src/ui/App.tsx:17-45`, `src/ui/App.tsx:262-268`
- Modify: `src/commands.ts` only if `/model` help text should mention provider-specific examples
- Test: `tests/cliConfig.test.ts` if pure helpers are extracted; otherwise rely on `npm test` and manual smoke commands.

**Step 1: Add Provider to UI/Repl options**

Update types:

```ts
// AppProps
export interface AppProps {
  initialProvider: ProviderName;
  initialModel: string;
  skills: SkillMeta[];
}

// ReplOptions
export interface ReplOptions {
  provider: ProviderName;
  model: string;
  skills: SkillMeta[];
  skillsExtraRoots?: string[];
}
```

Update state display:

- TUI footer should show `${provider}:${model}` or `provider · model`.
- Plain banner should show provider and model.

**Step 2: Pass provider into `runAgent`**

Update `AgentOptions`:

```ts
providerName?: ProviderName;
```

But prefer using `ResolvedConfig.provider` inside `runAgent` as the source of truth only if `opts.providerName` is absent:

```ts
const providerName = opts.providerName ?? config.provider;
const provider = opts.provider ?? createProvider({ ...config, provider: providerName });
```

Then pass from CLI/Repl/TUI:

```ts
await runAgent(prompt, { providerName: provider, model, ... })
```

**Step 3: Update CLI setup wizard**

Change setup prompts:

```text
Provider [anthropic/mock/glm] [anthropic]:
API base URL [provider default]:
Auth token [blank allowed for mock]:
Model name [provider default]:
```

Defaults:

- Anthropic: `claude-sonnet-4-6` (or keep current default until model strategy changes)
- Mock: `mock`
- GLM: `glm` or `glm-4.5` placeholder; label as future placeholder, not verified

Validation:

- If provider is `mock`, token is not required.
- If provider is `glm`, token may be blank because skeleton does not call API yet; warn that real GLM support is reserved.
- If provider is `anthropic`, keep token required.

**Step 4: Update doctor**

`joy doctor` should print provider:

```text
provider : anthropic
base URL : ...
model    : ...
token    : set/MISSING/not required for mock
```

Behavior:

- `provider=mock`: run a mock one-turn provider check, no network.
- `provider=glm`: do not network; print a clear reserved message and exit 0 or non-zero? Choose exit 0 if config is syntactically valid, because GLM is intentionally skeleton.
- `provider=anthropic`: keep current API ping, but call through provider if practical.

**Step 5: Write pure tests if helpers are extracted**

If you extract helpers like `defaultModelForProvider(provider)` or `tokenRequiredForProvider(provider)`, test them:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { defaultModelForProvider, tokenRequiredForProvider } from "../src/providers/index.ts";

test("mock provider does not require token", () => {
  assert.equal(tokenRequiredForProvider("mock"), false);
});
```

**Step 6: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and build succeeds.

**Step 7: Manual smoke commands**

Run after build:

```bash
JOY_PROVIDER=mock node dist/cli.js "hello"
```

Expected: exits successfully and prints `mock response`.

Run:

```bash
JOY_PROVIDER=glm node dist/cli.js doctor
```

Expected: prints that GLM provider is reserved/not implemented, without attempting a GLM network call.

Run only if Anthropic credentials are available:

```bash
JOY_PROVIDER=anthropic node dist/cli.js doctor
```

Expected: same behavior as current doctor.

---

### Task 6: Preserve Conversation And Compaction Semantics Across Providers

**Files:**
- Modify: `src/agent.ts`
- Test: `tests/agentLoop.mock.test.ts`

**Step 1: Write failing multi-turn mock test**

Add to `tests/agentLoop.mock.test.ts`:

```ts
test("runAgent emits full provider messages for continuing a conversation", async () => {
  let fullMessages: unknown[] | undefined;
  const provider = new MockProvider([
    {
      content: [{ type: "text", text: "first" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  ]);

  await runAgent("hello", {
    model: "mock",
    provider,
    skills: [],
    onEvent: (e) => {
      if (e.type === "turnEnd") fullMessages = (e as any)._fullMessages;
    },
  });

  assert.deepEqual(fullMessages, [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "first" }] },
  ]);
});
```

**Step 2: Run test to verify it fails if conversation types are incomplete**

Run:

```bash
npm test
```

Expected: if previous tasks already preserve `_fullMessages`, this may pass immediately. If it passes, keep it as regression coverage and proceed.

**Step 3: Fix only if needed**

Ensure:

- User prompts are stored as `{ role: "user", content: string }`.
- Assistant responses are stored as provider content blocks.
- Tool results are stored as provider tool result blocks.
- `_fullMessages` contains provider messages, not Anthropic SDK instances.

**Step 4: Add compaction mock test only if implementation is easy**

YAGNI: do not overbuild compaction tests if the provider loop test already exercises core flow. Add one compaction test only if you can trigger compaction with a low threshold without brittle env mutation.

**Step 5: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and build succeeds.

---

### Task 7: Documentation Update

**Files:**
- Modify: `README.md`
- Optional Modify: `AGENTS.md` if it exists after `/init`; do not create it just for this task unless requested.

**Step 1: Write README provider section**

Add a concise provider section:

```md
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
```

**Step 2: Update setup/config docs**

Mention `~/.joy-agent/config.json` can include:

```json
{
  "JOY_PROVIDER": "mock",
  "JOY_MODEL": "mock"
}
```

and future GLM placeholders:

```json
{
  "JOY_PROVIDER": "glm",
  "ZHIPUAI_API_KEY": "...",
  "JOY_MODEL": "glm"
}
```

Clearly label GLM as not implemented until API access is available.

**Step 3: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: docs do not break tests/build.

---

### Task 8: Final Verification Checklist

**Files:**
- No new source files unless a verification issue is found.

**Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

**Step 2: Run build**

Run:

```bash
npm run build
```

Expected: `tsc` exits 0.

**Step 3: Run mock smoke test**

Run:

```bash
JOY_PROVIDER=mock node dist/cli.js "hello"
```

Expected: one successful mock response, no API token required.

**Step 4: Run GLM skeleton doctor**

Run:

```bash
JOY_PROVIDER=glm node dist/cli.js doctor
```

Expected: clear message that GLM provider is reserved/skeleton and no real GLM network call happens.

**Step 5: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected changed groups:

- `src/providers/*`
- `src/agent.ts`
- `src/config.ts`
- `src/cli.ts`
- `src/repl.ts`
- `src/ui/App.tsx`
- tests
- docs
- `dist/*` build outputs

Unexpected unrelated diffs should be investigated before reporting completion.

---

## Implementation Notes

### Do Not Do In This Phase

- Do not call real GLM API.
- Do not add OpenAI-compatible GLM shim yet.
- Do not implement streaming.
- Do not change tool schemas except where typing requires provider-owned types.
- Do not rewrite the TUI beyond provider display and passing provider to `runAgent`.

### Error Messages

Provider errors should be actionable:

- Mock exhausted: `Mock provider has no scripted response left`
- GLM skeleton: `GLM provider is reserved but not implemented because no GLM API access is available yet...`
- Missing Anthropic token: keep existing setup guidance.

### Backward Compatibility

- Default provider must remain `anthropic` so current users are not surprised.
- Existing `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `JOY_MODEL` behavior should keep working.
- `mock` must not require any token.
- `glm` must not make network requests.

### Suggested Commit Boundaries

Only commit if the user asks. If committing, use these boundaries:

1. `refactor: add provider config selection`
2. `refactor: route agent loop through providers`
3. `test: add mock provider loop coverage`
4. `chore: add glm provider skeleton`
5. `docs: document provider architecture`

Every commit message must end with:

```text
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
