import assert from "node:assert/strict";
import test from "node:test";

import { collectSubagentText } from "../src/agent.ts";

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
