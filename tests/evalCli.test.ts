import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runEvalCli, parseEvalArgs } from "../src/evalCli.ts";

async function createPassingCase(root: string) {
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
    verify: { command: "node add.js", expectExitCode: 0, expectStdoutIncludes: "5" }
  }), "utf8");
}

test("runEvalCli runs cases and prints a passing summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-eval-cli-"));
  await createPassingCase(root);
  let output = "";

  const exitCode = await runEvalCli({
    casesDir: path.join(root, "cases"),
    workRoot: path.join(root, "work"),
    write: (text) => { output += text; },
  });

  assert.equal(exitCode, 0);
  assert.match(output, /PASS single-file-bugfix/);
  assert.match(output, /1 passed, 0 failed/);
});

test("parseEvalArgs parses v2 flags", () => {
  const result = parseEvalArgs([
    "--list", "--json",
    "--provider", "mock",
    "--model", "mock-v2",
    "--keep-runs",
    "--case", "abc",
    "--cases-dir", "custom"
  ]);

  assert.equal(result.list, true);
  assert.equal(result.json, true);
  assert.equal(result.provider, "mock");
  assert.equal(result.model, "mock-v2");
  assert.equal(result.keepRuns, true);
  assert.equal(result.caseName, "abc");
  assert.equal(result.casesDir, "custom");
});

test("runEvalCli --list prints names and does not run cases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-eval-cli-"));
  await createPassingCase(root);
  let output = "";

  const exitCode = await runEvalCli({
    casesDir: path.join(root, "cases"),
    list: true,
    write: (text) => { output += text; },
  });

  assert.equal(exitCode, 0);
  assert.match(output, /single-file-bugfix/);
  // Should NOT have run output
  assert.doesNotMatch(output, /PASS/);
  assert.doesNotMatch(output, /FAIL/);
});

test("runEvalCli --list --json prints JSON metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-eval-cli-"));
  await createPassingCase(root);
  let output = "";

  const exitCode = await runEvalCli({
    casesDir: path.join(root, "cases"),
    list: true,
    json: true,
    write: (text) => { output += text; },
  });

  assert.equal(exitCode, 0);
  const parsed = JSON.parse(output);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].name, "single-file-bugfix");
  assert.equal(parsed[0].provider, "mock");
  assert.equal(parsed[0].model, "mock");
});

test("runEvalCli --json prints one JSON summary without human output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-eval-cli-"));
  await createPassingCase(root);
  let output = "";

  const exitCode = await runEvalCli({
    casesDir: path.join(root, "cases"),
    workRoot: path.join(root, "work"),
    json: true,
    write: (text) => { output += text; },
  });

  assert.equal(exitCode, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, "passed");
  assert.equal(parsed.passed, 1);
  assert.equal(parsed.failed, 0);
  assert.equal(parsed.results[0].caseName, "single-file-bugfix");
  assert.equal(parsed.results[0].status, "passed");
  assert.equal(parsed.results[0].provider, "mock");
  // Ensure no human PASS/FAIL text
  assert.doesNotMatch(output, /PASS/);
});

test("runEvalCli --keep-runs keeps passing run directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-eval-cli-"));
  await createPassingCase(root);
  let output = "";

  const exitCode = await runEvalCli({
    casesDir: path.join(root, "cases"),
    workRoot: path.join(root, "work"),
    keepRuns: true,
    write: (text) => { output += text; },
  });

  assert.equal(exitCode, 0);
  // At least one subdirectory should exist in workRoot
  const entries = await readdir(path.join(root, "work"));
  assert.ok(entries.length > 0);
});
