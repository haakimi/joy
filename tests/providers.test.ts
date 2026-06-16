import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAnthropicResponse } from "../src/providers/anthropic.ts";
import { defaultModelForProvider, tokenRequiredForProvider } from "../src/providers/index.ts";
import { normalizeProviderResponse } from "../src/providers/normalize.ts";

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

test("repairs common tool names and input aliases", () => {
  const { response, diagnostics } = normalizeProviderResponse({
    content: [
      { type: "tool_use", id: "toolu_read", name: "read_file", input: { filename: "README.md" } },
      { type: "tool_use", id: "toolu_bash", name: "run_command", input: { cmd: "pwd" } },
      { type: "tool_use", id: "toolu_patch", name: "apply_diff", input: { diff: "--- a/a.txt\n+++ b/a.txt\n" } },
      { type: "tool_use", id: "toolu_grep", name: "grep", input: { regex: "needle" } },
    ],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  assert.equal(response.stopReason, "tool_use");
  assert.deepEqual(response.content, [
    { type: "tool_use", id: "toolu_read", name: "read", input: { path: "README.md" } },
    { type: "tool_use", id: "toolu_bash", name: "bash", input: { command: "pwd" } },
    { type: "tool_use", id: "toolu_patch", name: "apply_patch", input: { patch: "--- a/a.txt\n+++ b/a.txt\n" } },
    { type: "tool_use", id: "toolu_grep", name: "grep", input: { pattern: "needle" } },
  ]);
  assert.ok(diagnostics.some((d) => d.kind === "tool_name_alias" && d.from === "read_file" && d.to === "read"));
  assert.ok(diagnostics.some((d) => d.kind === "input_key_alias" && d.from === "filename" && d.to === "path"));
  assert.ok(diagnostics.some((d) => d.kind === "stop_reason_reconciled"));
});

test("parses stringified JSON and raw_arguments tool inputs", () => {
  const { response, diagnostics } = normalizeProviderResponse({
    content: [
      { type: "tool_use", id: "toolu_json", name: "read_file", input: "{\"file\":\"package.json\"}" },
      { type: "tool_use", id: "toolu_raw", name: "shell", input: { raw_arguments: "{\"cmd\":\"node -v\"}" } },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  assert.deepEqual(response.content, [
    { type: "tool_use", id: "toolu_json", name: "read", input: { path: "package.json" } },
    { type: "tool_use", id: "toolu_raw", name: "bash", input: { command: "node -v" } },
  ]);
  assert.ok(diagnostics.some((d) => d.kind === "input_json_parsed"));
  assert.ok(diagnostics.some((d) => d.kind === "raw_arguments_parsed"));
});

test("parses GLM-style arguments tool input", () => {
  const { response, diagnostics } = normalizeProviderResponse({
    content: [{
      type: "tool_use",
      name: "run_command",
      input: {
        arguments: "{\"cmd\":\"node -e \\\"console.log(456)\\\"\"}",
      },
    } as any],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  const tool = response.content[0] as any;
  assert.equal(response.stopReason, "tool_use");
  assert.match(tool.id, /^toolu_repaired_0_/);
  assert.equal(tool.name, "bash");
  assert.deepEqual(tool.input, { command: "node -e \"console.log(456)\"" });
  assert.ok(diagnostics.some((d) => d.kind === "arguments_parsed"));
});

test("generates stable tool ids and leaves unknown tools unguessed", () => {
  const raw = {
    content: [
      { type: "tool_use", name: "mystery_tool", input: { value: 1 } },
      { type: "tool_use", id: "", name: "read_file", input: { filename: "README.md" } },
    ],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1 },
  } as any;

  const first = normalizeProviderResponse(raw);
  const second = normalizeProviderResponse(raw);
  const firstTool = first.response.content[0] as any;
  const secondTool = first.response.content[1] as any;

  assert.equal(firstTool.name, "mystery_tool");
  assert.match(firstTool.id, /^toolu_repaired_0_/);
  assert.match(secondTool.id, /^toolu_repaired_1_/);
  assert.equal(firstTool.id, (second.response.content[0] as any).id);
  assert.equal(secondTool.id, (second.response.content[1] as any).id);
  assert.ok(first.diagnostics.some((d) => d.kind === "tool_id_generated"));
});

test("invalid JSON tool input is repaired conservatively", () => {
  const { response, diagnostics } = normalizeProviderResponse({
    content: [{ type: "tool_use", id: "toolu_bad", name: "read_file", input: "{" }],
    stopReason: "tool_use",
    usage: { inputTokens: 1, outputTokens: 1 },
  });

  assert.deepEqual(response.content, [{ type: "tool_use", id: "toolu_bad", name: "read", input: {} }]);
  assert.ok(diagnostics.some((d) => d.kind === "tool_input_unparseable"));
});

test("Anthropic normalization repairs missing ids instead of stringifying undefined", () => {
  const response = normalizeAnthropicResponse({
    content: [{ type: "tool_use", name: "read_file", input: { filename: "README.md" } }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  const tool = response.content[0] as any;
  assert.equal(response.stopReason, "tool_use");
  assert.notEqual(tool.id, "undefined");
  assert.match(tool.id, /^toolu_repaired_0_/);
  assert.equal(tool.name, "read");
  assert.deepEqual(tool.input, { path: "README.md" });
});
test("mock provider does not require token", () => {
  assert.equal(tokenRequiredForProvider("mock"), false);
});

test("provider default models are provider-specific", () => {
  assert.equal(defaultModelForProvider("mock"), "mock");
  assert.equal(defaultModelForProvider("glm"), "glm");
});
