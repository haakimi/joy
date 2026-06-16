import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadEvalCases, runEvalCase } from "../src/eval.ts";

async function makeCaseRoot() {
  return mkdtemp(path.join(os.tmpdir(), "joy-evals-"));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createBugfixCase(root: string, verify = { command: "node add.js", expectExitCode: 0, expectStdoutIncludes: "5" }) {
  const caseDir = path.join(root, "cases", "single-file-bugfix");
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), JSON.stringify({
    name: "single-file-bugfix",
    prompt: "Fix add.js so add(2, 3) prints 5.",
    provider: "mock",
    model: "mock",
    files: {
      "add.js": "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n"
    },
    mockResponses: [
      {
        content: [{
          type: "tool_use",
          id: "toolu_edit",
          name: "edit",
          input: {
            path: "add.js",
            old_string: "return a - b;",
            new_string: "return a + b;"
          }
        }],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 }
      },
      {
        content: [{ type: "text", text: "Fixed add.js." }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    ],
    verify
  }), "utf8");
  const [loaded] = await loadEvalCases(path.join(root, "cases"));
  return loaded;
}

async function createApplyPatchCase(root: string) {
  const caseDir = path.join(root, "cases", "apply-patch-bugfix");
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), JSON.stringify({
    name: "apply-patch-bugfix",
    prompt: "Fix add.js so add(2, 3) prints 5 using a patch.",
    provider: "mock",
    model: "mock",
    files: {
      "add.js": "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n"
    },
    mockResponses: [
      {
        content: [{
          type: "tool_use",
          id: "toolu_patch",
          name: "apply_patch",
          input: {
            patch: "--- a/add.js\n+++ b/add.js\n@@ -1,2 +1,2 @@\n-function add(a, b) { return a - b; }\n+function add(a, b) { return a + b; }\n console.log(add(2, 3));\n"
          }
        }],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 }
      },
      {
        content: [{ type: "text", text: "Patched add.js." }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    ],
    verify: { command: "node add.js", expectExitCode: 0, expectStdoutIncludes: "5" }
  }), "utf8");
  const [loaded] = await loadEvalCases(path.join(root, "cases"));
  return loaded;
}


test("loadEvalCases reads case manifests from evals/cases/*", async () => {
  const root = await makeCaseRoot();
  const caseDir = path.join(root, "cases", "sample");
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), JSON.stringify({
    name: "sample",
    prompt: "Fix the bug",
    provider: "mock",
    model: "mock",
    files: { "src/app.js": "console.log('bug')\n" },
    mockResponses: [
      { content: [{ type: "text", text: "done" }], stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } }
    ],
    verify: { command: "node src/app.js", expectExitCode: 0, expectStdoutIncludes: "bug" }
  }), "utf8");

  const cases = await loadEvalCases(path.join(root, "cases"));

  assert.equal(cases.length, 1);
  assert.equal(cases[0].name, "sample");
  assert.equal(cases[0].dir, caseDir);
  assert.deepEqual(cases[0].files, { "src/app.js": "console.log('bug')\n" });
});

test("loadEvalCases preserves tool call expectations", async () => {
  const root = await makeCaseRoot();
  const caseDir = path.join(root, "cases", "tool-expectations");
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), JSON.stringify({
    name: "tool-expectations",
    prompt: "Fix add.js.",
    provider: "mock",
    model: "mock",
    files: {},
    mockResponses: [
      { content: [{ type: "text", text: "done" }], stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } }
    ],
    verify: {
      command: "true",
      expectExitCode: 0,
      expectToolCalls: [
        { name: "read", inputIncludes: { path: "add.js" } },
        { name: "edit", inputIncludes: { path: "add.js" } }
      ]
    }
  }), "utf8");

  const cases = await loadEvalCases(path.join(root, "cases"));

  assert.deepEqual(cases[0].verify.expectToolCalls, [
    { name: "read", inputIncludes: { path: "add.js" } },
    { name: "edit", inputIncludes: { path: "add.js" } }
  ]);
});

test("runEvalCase prepares files, runs mock agent, and verifies expected output", async () => {
  const root = await makeCaseRoot();
  const loaded = await createBugfixCase(root);

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work"), keepRuns: true });

  assert.equal(result.status, "passed");
  assert.equal(result.verify.exitCode, 0);
  assert.match(result.verify.stdout, /5/);
  assert.equal(result.kept, true);
  assert.deepEqual(result.toolCalls, [
    {
      id: "toolu_edit",
      name: "edit",
      input: {
        path: "add.js",
        old_string: "return a - b;",
        new_string: "return a + b;"
      }
    }
  ]);
  assert.equal(await readFile(path.join(result.workDir, "add.js"), "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
});

test("runEvalCase supports apply_patch mock tool calls", async () => {
  const root = await makeCaseRoot();
  const loaded = await createApplyPatchCase(root);

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work"), keepRuns: true });

  assert.equal(result.status, "passed");
  assert.equal(result.verify.exitCode, 0);
  assert.match(result.verify.stdout, /5/);
  assert.equal(await readFile(path.join(result.workDir, "add.js"), "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
});
test("runEvalCase supports repaired tool-call aliases", async () => {
  const root = await makeCaseRoot();
  const caseDir = path.join(root, "cases", "tool-call-repair-apply-diff");
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), JSON.stringify({
    name: "tool-call-repair-apply-diff",
    prompt: "Fix add.js using a non-standard tool call.",
    provider: "mock",
    model: "mock",
    files: {
      "add.js": "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n"
    },
    mockResponses: [
      {
        content: [{
          type: "tool_use",
          name: "apply_diff",
          input: {
            diff: "--- a/add.js\n+++ b/add.js\n@@ -1,2 +1,2 @@\n-function add(a, b) { return a - b; }\n+function add(a, b) { return a + b; }\n console.log(add(2, 3));\n"
          }
        }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 }
      },
      {
        content: [{ type: "text", text: "Repaired and patched." }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    ],
    verify: {
      command: "node add.js",
      expectExitCode: 0,
      expectStdoutIncludes: "5",
      expectToolCalls: [{ name: "apply_patch" }]
    }
  }), "utf8");
  const [loaded] = await loadEvalCases(path.join(root, "cases"));

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work"), keepRuns: true });

  assert.equal(result.status, "passed");
  assert.equal(result.toolCalls[0].name, "apply_patch");
  assert.equal(await readFile(path.join(result.workDir, "add.js"), "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
});

test("runEvalCase supports GLM-style arguments tool input", async () => {
  const root = await makeCaseRoot();
  const caseDir = path.join(root, "cases", "glm-compat-edit-json-arguments");
  await mkdir(caseDir, { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), JSON.stringify({
    name: "glm-compat-edit-json-arguments",
    prompt: "Fix add.js using GLM-style arguments.",
    provider: "mock",
    model: "mock",
    files: {
      "add.js": "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n"
    },
    mockResponses: [
      {
        content: [{
          type: "tool_use",
          name: "edit",
          input: {
            arguments: JSON.stringify({
              path: "add.js",
              old_string: "return a - b;",
              new_string: "return a + b;"
            })
          }
        }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 }
      },
      {
        content: [{ type: "text", text: "Repaired arguments and edited." }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    ],
    verify: { command: "node add.js", expectExitCode: 0, expectStdoutIncludes: "5" }
  }), "utf8");
  const [loaded] = await loadEvalCases(path.join(root, "cases"));

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work"), keepRuns: true });

  assert.equal(result.status, "passed");
  assert.equal(await readFile(path.join(result.workDir, "add.js"), "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
});

test("runEvalCase fails when expected tool calls are missing", async () => {
  const root = await makeCaseRoot();
  const loaded = await createBugfixCase(root, {
    command: "node add.js",
    expectExitCode: 0,
    expectStdoutIncludes: "5",
    expectToolCalls: [
      { name: "read", inputIncludes: { path: "add.js" } }
    ]
  });

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work") });

  assert.equal(result.status, "failed");
  assert.equal(result.kept, true);
  assert.match(result.failures.join("\n"), /expected tool call #1 read/);
  assert.match(result.failures.join("\n"), /actual calls: edit/);
});

test("checked-in GLM compatibility eval cases are discoverable", async () => {
  const cases = await loadEvalCases(path.resolve("evals/cases"));
  const names = cases.map((c) => c.name);

  assert.ok(names.includes("glm-compat-edit-json-arguments"));
  assert.ok(names.includes("glm-compat-bash-alias-raw-arguments"));
  assert.ok(names.includes("glm-compat-apply-diff-arguments"));
});

test("runEvalCase deletes passing run directories by default", async () => {
  const root = await makeCaseRoot();
  const loaded = await createBugfixCase(root);

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work") });

  assert.equal(result.status, "passed");
  assert.equal(result.kept, false);
  assert.equal(await pathExists(result.workDir), false);
});

test("runEvalCase keeps failing run directories by default", async () => {
  const root = await makeCaseRoot();
  const loaded = await createBugfixCase(root, {
    command: "node add.js",
    expectExitCode: 0,
    expectStdoutIncludes: "999"
  });

  const result = await runEvalCase(loaded, { workRoot: path.join(root, "work") });

  assert.equal(result.status, "failed");
  assert.equal(result.kept, true);
  assert.equal(await pathExists(result.workDir), true);
});

test("runEvalCase reports provider and model overrides", async () => {
  const root = await makeCaseRoot();
  const loaded = await createBugfixCase(root);

  const result = await runEvalCase(loaded, {
    workRoot: path.join(root, "work"),
    keepRuns: true,
    provider: "mock",
    model: "mock-v2"
  });

  assert.equal(result.status, "passed");
  assert.equal(result.provider, "mock");
  assert.equal(result.model, "mock-v2");
});
