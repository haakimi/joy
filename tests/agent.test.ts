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

test("compact failure degrades gracefully instead of aborting the task", async () => {
  const previousThreshold = process.env.JOY_COMPACT_THRESHOLD;
  process.env.JOY_COMPACT_THRESHOLD = "5";

  // Script:
  //  1. main turn: inputTokens=1000 (> threshold) -> triggers compact
  //  2. compact call: THROWS a 429 -> compaction must be skipped
  //  3. main turn continues: normal end_turn with final answer
  const script: any[] = [
    {
      content: [{ type: "text", text: "answering" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1000, outputTokens: 10 },
    },
    { throw: "rate limited", status: 429 },
    {
      content: [{ type: "text", text: "done" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1000, outputTokens: 10 },
    },
  ];
  const provider = new MockProvider(script);

  let compactCalled = false;
  const result = await runAgent("do something", {
    model: "mock",
    provider,
    skills: [],
    onCompact: () => {
      compactCalled = true;
      return [{ role: "user", content: "summary" }];
    },
  });

  process.env.JOY_COMPACT_THRESHOLD = previousThreshold;

  // Compaction failed, so onCompact must NOT have replaced history.
  assert.equal(compactCalled, false);
  // The task must still have completed normally.
  assert.equal(result, "answering");
});

test("compaction does not re-trigger immediately on the next turn", async () => {
  const previousThreshold = process.env.JOY_COMPACT_THRESHOLD;
  process.env.JOY_COMPACT_THRESHOLD = "500";

  // Script for a tool-using agent that keeps going after compaction:
  //  1. tool_use turn, inputTokens=1000 (> threshold 500) -> triggers compact
  //  2. compact summary: returns "summary", inputTokens=200 (pre-compaction size)
  //  3. next turn: inputTokens=50 (post-compaction size) -> re-baselined to 50,
  //     which is under 500, so compaction must NOT re-trigger.
  const script: ProviderResponse[] = [
    {
      content: [{ type: "tool_use", id: "t1", name: "list_files", input: {} }],
      stopReason: "tool_use",
      usage: { inputTokens: 1000, outputTokens: 10 },
    },
    {
      content: [{ type: "text", text: "summary" }],
      stopReason: "end_turn",
      usage: { inputTokens: 200, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "working after compact" }],
      stopReason: "end_turn",
      usage: { inputTokens: 50, outputTokens: 10 },
    },
  ];
  const provider = new MockProvider(script);

  let compactCount = 0;
  await runAgent("do something", {
    model: "mock",
    provider,
    skills: [],
    onCompact: (summary) => {
      compactCount++;
      return [{ role: "user", content: `[SUMMARY] ${summary}` }];
    },
  });

  process.env.JOY_COMPACT_THRESHOLD = previousThreshold;

  // Compaction must have happened exactly once. After it, cumulativeInput was
  // re-baselined to the real post-compaction size (50), not the stale 1000+,
  // so the next turn stays under threshold and does not re-trigger.
  assert.equal(compactCount, 1);
});
