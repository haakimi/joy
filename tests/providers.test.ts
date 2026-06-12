import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAnthropicResponse } from "../src/providers/anthropic.ts";
import { defaultModelForProvider, tokenRequiredForProvider } from "../src/providers/index.ts";

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

test("mock provider does not require token", () => {
  assert.equal(tokenRequiredForProvider("mock"), false);
});

test("provider default models are provider-specific", () => {
  assert.equal(defaultModelForProvider("mock"), "mock");
  assert.equal(defaultModelForProvider("glm"), "glm");
});
