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
