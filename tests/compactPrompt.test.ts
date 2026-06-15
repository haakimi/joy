import assert from "node:assert/strict";
import test from "node:test";

import { runAgent } from "../src/agent.ts";
import { findCommand } from "../src/commands.ts";
import { COMPACT_SUMMARY_PROMPT } from "../src/compact.ts";
import type { ModelProvider, ProviderRequest, ProviderResponse } from "../src/providers/types.ts";

class RecordingProvider implements ModelProvider {
  name = "mock" as const;
  requests: ProviderRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ProviderResponse[]) {}

  async createMessage(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(request);
    const response = this.responses[this.index++];
    if (!response) throw new Error("No scripted response left");
    return response;
  }
}

const REQUIRED_HEADINGS = [
  "## User Goal",
  "## User Preferences",
  "## Current Task",
  "## Completed Work",
  "## Modified Files",
  "## Decisions",
  "## Verification Status",
  "## Open TODOs",
  "## Important Context",
  "## Recent Evidence",
  "## Do Not Forget",
];

test("compact summary prompt is a structured task handoff", () => {
  for (const heading of REQUIRED_HEADINGS) {
    assert.match(COMPACT_SUMMARY_PROMPT, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(COMPACT_SUMMARY_PROMPT, /machine-generated summary/i);
  assert.match(COMPACT_SUMMARY_PROMPT, /verified|unverified/i);
  assert.match(COMPACT_SUMMARY_PROMPT, /commands/i);
});

test("slash compact command uses the shared structured compact prompt", async () => {
  const cmd = findCommand("compact");
  assert.ok(cmd);

  const result = await cmd.run({
    args: [],
    raw: "",
    cwd: process.cwd(),
    model: "mock",
    printLine: () => {},
  });

  assert.ok(result.prompt);
  assert.match(result.prompt, /\[COMPACT\]/);
  for (const heading of REQUIRED_HEADINGS) {
    assert.match(result.prompt, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(result.prompt, /Do NOT continue working/i);
});

test("automatic compact uses the shared structured compact prompt", async () => {
  const previousThreshold = process.env.JOY_COMPACT_THRESHOLD;
  process.env.JOY_COMPACT_THRESHOLD = "5";
  const provider = new RecordingProvider([
    {
      content: [{ type: "text", text: "final answer" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1000, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "summary" }],
      stopReason: "end_turn",
      usage: { inputTokens: 200, outputTokens: 5 },
    },
  ]);

  try {
    await runAgent("do something", {
      model: "mock",
      provider,
      skills: [],
      onCompact: (summary, _tokensSaved) => [{ role: "user", content: `[SUMMARY] ${summary}` }],
    });
  } finally {
    process.env.JOY_COMPACT_THRESHOLD = previousThreshold;
  }

  assert.equal(provider.requests.length, 2);
  assert.match(provider.requests[1].system, /## Verification Status/);
  assert.match(provider.requests[1].system, /## User Preferences/);
  assert.match(provider.requests[1].system, /machine-generated summary/i);
});
