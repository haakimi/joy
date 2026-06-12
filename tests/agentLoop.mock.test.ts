import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

test("runAgent executes grep tool calls through the mock provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-agent-grep-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/app.ts"), "const marker = 'needle';\n", "utf8");
  const previous = process.cwd();
  const toolResults: string[] = [];
  const provider = new MockProvider([
    {
      content: [{ type: "tool_use", id: "toolu_grep", name: "grep", input: { pattern: "needle", path: "src" } }],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "found it" }],
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);

  try {
    process.chdir(root);
    const result = await runAgent("find needle", {
      model: "mock",
      provider,
      maxIterations: 3,
      skills: [],
      onEvent: (e) => {
        if (e.type === "tool_result") toolResults.push(e.output);
      },
    });

    assert.equal(result, "found it");
    assert.match(toolResults.join("\n"), /src\/app\.ts:1:/);
  } finally {
    process.chdir(previous);
  }
});

test("runAgent executes apply_patch tool calls through the mock provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-agent-patch-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  const filePath = path.join(root, "src/calc.js");
  await writeFile(filePath, "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n", "utf8");
  const previous = process.cwd();
  const toolResults: string[] = [];
  const provider = new MockProvider([
    {
      content: [{
        type: "tool_use",
        id: "toolu_patch",
        name: "apply_patch",
        input: {
          patch: `--- a/src/calc.js
+++ b/src/calc.js
@@ -1,2 +1,2 @@
-function add(a, b) { return a - b; }
+function add(a, b) { return a + b; }
 console.log(add(2, 3));
`,
        },
      }],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "patched" }],
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);

  try {
    process.chdir(root);
    const result = await runAgent("fix add", {
      model: "mock",
      provider,
      maxIterations: 3,
      skills: [],
      onEvent: (e) => {
        if (e.type === "tool_result") toolResults.push(e.output);
      },
    });

    assert.equal(result, "patched");
    assert.match(toolResults.join("\n"), /Applied patch to 1 file/);
    assert.equal(await readFile(filePath, "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
  } finally {
    process.chdir(previous);
  }
});

test("runAgent repairs aliased read tool calls with wrong stop reason", async () => {
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const toolResults: string[] = [];
  const provider = new MockProvider([
    {
      content: [{ type: "tool_use", name: "read_file", input: { filename: "package.json" } } as any],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "read repaired" }],
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);

  const result = await runAgent("read package", {
    model: "mock",
    provider,
    maxIterations: 3,
    skills: [],
    onEvent: (e) => {
      if (e.type === "tool_call") toolCalls.push({ id: e.id, name: e.name, input: e.input });
      if (e.type === "tool_result") toolResults.push(e.output);
    },
  });

  assert.equal(result, "read repaired");
  assert.equal(toolCalls[0].name, "read");
  assert.deepEqual(toolCalls[0].input, { path: "package.json" });
  assert.match(toolCalls[0].id, /^toolu_repaired_0_/);
  assert.match(toolResults.join("\n"), /joy-agent/);
});

test("runAgent repairs bash alias with stringified JSON input", async () => {
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  const toolResults: string[] = [];
  const provider = new MockProvider([
    {
      content: [{
        type: "tool_use",
        id: "toolu_bash_alias",
        name: "run_command",
        input: "{\"cmd\":\"node -e \\\"console.log(123)\\\"\"}",
      }],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "bash repaired" }],
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);

  const result = await runAgent("run command", {
    model: "mock",
    provider,
    maxIterations: 3,
    skills: [],
    onEvent: (e) => {
      if (e.type === "tool_call") toolCalls.push({ name: e.name, input: e.input });
      if (e.type === "tool_result") toolResults.push(e.output);
    },
  });

  assert.equal(result, "bash repaired");
  assert.equal(toolCalls[0].name, "bash");
  assert.deepEqual(toolCalls[0].input, { command: "node -e \"console.log(123)\"" });
  assert.match(toolResults.join("\n"), /123/);
});

test("runAgent repairs apply_patch alias with raw_arguments input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-agent-repair-patch-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  const filePath = path.join(root, "src/calc.js");
  await writeFile(filePath, "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n", "utf8");
  const previous = process.cwd();
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const toolResultIds: string[] = [];
  const patch = `--- a/src/calc.js
+++ b/src/calc.js
@@ -1,2 +1,2 @@
-function add(a, b) { return a - b; }
+function add(a, b) { return a + b; }
 console.log(add(2, 3));
`;
  const provider = new MockProvider([
    {
      content: [{
        type: "tool_use",
        name: "apply_diff",
        input: { raw_arguments: JSON.stringify({ diff: patch }) },
      } as any],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      content: [{ type: "text", text: "patch repaired" }],
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3 },
    },
  ]);

  try {
    process.chdir(root);
    const result = await runAgent("fix add", {
      model: "mock",
      provider,
      maxIterations: 3,
      skills: [],
      onEvent: (e) => {
        if (e.type === "tool_call") toolCalls.push({ id: e.id, name: e.name, input: e.input });
        if (e.type === "tool_result") toolResultIds.push(e.id);
      },
    });

    assert.equal(result, "patch repaired");
    assert.equal(toolCalls[0].name, "apply_patch");
    assert.deepEqual(toolCalls[0].input, { patch });
    assert.match(toolCalls[0].id, /^toolu_repaired_0_/);
    assert.equal(toolResultIds[0], toolCalls[0].id);
    assert.equal(await readFile(filePath, "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
  } finally {
    process.chdir(previous);
  }
});
