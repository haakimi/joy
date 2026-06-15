import assert from "node:assert/strict";
import test from "node:test";

import { collectSubagentText, runAgent } from "../src/agent.ts";
import { MockProvider } from "../src/providers/mock.ts";
import type { ProviderResponse } from "../src/providers/types.ts";

test("subagent result includes every non-thinking assistant text block", () => {
  const result = collectSubagentText([
    { type: "assistant_text", text: "first", isThinking: false },
    { type: "assistant_text", text: "thinking", isThinking: true },
    { type: "assistant_text", text: "second", isThinking: false },
  ]);

  assert.equal(result, "first\n\nsecond");
});

test("subagent result falls back when no final text was emitted", () => {
  const result = collectSubagentText([
    { type: "assistant_text", text: "thinking", isThinking: true },
  ]);

  assert.equal(result, "(sub-agent completed with no output)");
});

test("compact reports saved tokens from real provider usage, not a chars/4 estimate", async () => {
  // Use a tiny threshold so the first response immediately triggers compact.
  const previousThreshold = process.env.JOY_COMPACT_THRESHOLD;
  process.env.JOY_COMPACT_THRESHOLD = "5";

  // Script:
  //  1. main turn: inputTokens=1000 (> threshold), end_turn -> triggers compact
  //  2. compact call: returns summary text with inputTokens=200
  const script: ProviderResponse[] = [
    {
      content: [{ type: "text", text: "final answer" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1000, outputTokens: 50 },
    },
    {
      content: [{ type: "text", text: "compressed summary" }],
      stopReason: "end_turn",
      usage: { inputTokens: 200, outputTokens: 30 },
    },
  ];
  const provider = new MockProvider(script);

  let capturedSavedTokens: number | undefined;
  let capturedSummary: string | undefined;
  await runAgent("do something", {
    model: "mock",
    provider,
    skills: [],
    onCompact: (summary, tokensSaved) => {
      capturedSummary = summary;
      capturedSavedTokens = tokensSaved;
      return [{ role: "user", content: `[SUMMARY] ${summary}` }];
    },
  });

  process.env.JOY_COMPACT_THRESHOLD = previousThreshold;

  assert.equal(capturedSummary, "compressed summary");
  // tokensSaved must be 1000 - 200 = 800, derived from real usage, not chars.
  assert.equal(capturedSavedTokens, 800);
});
