import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../src/agent.ts";
import type { ModelProvider, ProviderRequest, ProviderResponse } from "../src/providers/types.ts";

class RecordingProvider implements ModelProvider {
  name = "mock" as const;
  requests: ProviderRequest[] = [];

  async createMessage(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(request);
    return {
      content: [{ type: "text", text: "ok" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

async function captureSystem(prompt: string, opts: { isSubagent?: boolean } = {}): Promise<string> {
  const provider = new RecordingProvider();
  await runAgent(prompt, {
    model: "mock",
    provider,
    skills: [],
    maxIterations: 1,
    isSubagent: opts.isSubagent,
  });
  assert.equal(provider.requests.length, 1);
  return provider.requests[0].system;
}

test("base system prompt includes Intent Router and Grounded ReAct policies", async () => {
  const system = await captureSystem("Joy 现在是什么状态？");

  assert.match(system, /Intent Router/i);
  assert.match(system, /Grounded ReAct/i);
  assert.match(system, /classify/i);
  assert.match(system, /Keep internal reasoning private/i);
  assert.match(system, /Thought.*Action.*Observation/s);
});

test("base system prompt requires local inspection for current Joy and repo-state questions", async () => {
  const system = await captureSystem("当前 Joy 有哪些能力？");

  assert.match(system, /current project|current repo|current Joy/i);
  assert.match(system, /inspect.*local/i);
  assert.match(system, /Do not answer from memory/i);
  assert.match(system, /list_files/);
  assert.match(system, /glob/);
  assert.match(system, /grep/);
  assert.match(system, /read/);
  assert.match(system, /files.*commands.*evidence|evidence.*files.*commands/i);
});

test("base system prompt includes beginner concept routing", async () => {
  const system = await captureSystem("harness 是什么？");

  assert.match(system, /beginner/i);
  assert.match(system, /general concept/i);
  assert.match(system, /one-sentence|plain-language/i);
  assert.match(system, /analogy|example/i);
  assert.match(system, /user's language|Chinese/i);
  assert.match(system, /Do not use tools.*concept|without unnecessary tool use/i);
});

test("base system prompt preserves existing tooling, planning, editing, and subagent guidance", async () => {
  const system = await captureSystem("请修改代码");

  assert.match(system, /Prefer these search tools over bash/i);
  assert.match(system, /Prefer 'edit'/);
  assert.match(system, /'apply_patch'/);
  assert.match(system, /'write'/);
  assert.match(system, /Read a file before editing/i);
  assert.match(system, /update_plan/);
  assert.match(system, /spawn_agent/);
  assert.match(system, /wait_agent/);
});

test("subagent prompt includes grounding guidance without encouraging subagent spawning", async () => {
  const system = await captureSystem("inspect assigned task", { isSubagent: true });

  assert.match(system, /Joy sub-agent/i);
  assert.match(system, /specific subtask/i);
  assert.match(system, /Do not spawn additional sub-agents/i);
  assert.match(system, /inspect.*files.*repo-state|repo-state.*inspect.*files/i);
  assert.match(system, /beginner|user's language|Chinese/i);
  assert.match(system, /list_files/);
  assert.match(system, /glob/);
  assert.match(system, /grep/);
  assert.match(system, /apply_patch/);
  assert.doesNotMatch(system, /Use spawn_agent to delegate/i);
});
