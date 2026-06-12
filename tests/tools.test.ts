import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runTool, tools } from "../src/tools.ts";

async function withTempCwd(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "joy-tools-"));
  const previous = process.cwd();
  try {
    process.chdir(root);
    await fn(root);
  } finally {
    process.chdir(previous);
  }
}

async function writeFixture(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

test("tools array exposes list_files, glob, and grep", () => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.ok(byName.has("list_files"));
  assert.ok(byName.has("glob"));
  assert.ok(byName.has("grep"));
  assert.deepEqual((byName.get("list_files")?.input_schema as any).required ?? [], []);
  assert.deepEqual((byName.get("glob")?.input_schema as any).required, ["pattern"]);
  assert.deepEqual((byName.get("grep")?.input_schema as any).required, ["pattern"]);
});

test("list_files lists direct children without recursing by default", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "src/index.ts"), "export const x = 1;\n");
    await writeFixture(path.join(root, "README.md"), "hello\n");

    const result = await runTool("list_files", { path: "." });

    assert.equal(result.is_error, false);
    assert.match(result.content, /src\//);
    assert.match(result.content, /README\.md/);
    assert.doesNotMatch(result.content, /src\/index\.ts/);
  });
});

test("list_files supports recursive output and max_entries cap", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "a.txt"), "a\n");
    await writeFixture(path.join(root, "b.txt"), "b\n");
    await writeFixture(path.join(root, "src/c.txt"), "c\n");

    const result = await runTool("list_files", { path: ".", recursive: true, max_entries: 2 });

    assert.equal(result.is_error, false);
    assert.match(result.content, /truncated/i);
  });
});

test("glob supports star and globstar", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "src/index.ts"), "export {};\n");
    await writeFixture(path.join(root, "src/util/helpers.ts"), "export {};\n");
    await writeFixture(path.join(root, "src/style.css"), "body {}\n");

    const result = await runTool("glob", { pattern: "**/*.ts" });

    assert.equal(result.is_error, false);
    assert.match(result.content, /src\/index\.ts/);
    assert.match(result.content, /src\/util\/helpers\.ts/);
    assert.doesNotMatch(result.content, /style\.css/);
  });
});

test("glob caps matches", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "a.txt"), "a\n");
    await writeFixture(path.join(root, "b.txt"), "b\n");
    await writeFixture(path.join(root, "c.txt"), "c\n");

    const result = await runTool("glob", { pattern: "*.txt", max_matches: 2 });

    assert.equal(result.is_error, false);
    assert.match(result.content, /truncated/i);
  });
});

test("grep finds regex matches with line numbers", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "src/a.ts"), "export function alpha() { return 1; }\n");
    await writeFixture(path.join(root, "src/b.ts"), "export const beta = 2;\n");

    const result = await runTool("grep", { pattern: "function\\s+alpha", path: "src" });

    assert.equal(result.is_error, false);
    assert.match(result.content, /src\/a\.ts:1:/);
    assert.doesNotMatch(result.content, /src\/b\.ts/);
  });
});

test("grep supports include glob", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "src/a.ts"), "const value = 'needle';\n");
    await writeFixture(path.join(root, "docs/a.md"), "needle\n");

    const result = await runTool("grep", { pattern: "needle", include: "src/**/*.ts" });

    assert.equal(result.is_error, false);
    assert.match(result.content, /src\/a\.ts/);
    assert.doesNotMatch(result.content, /docs\/a\.md/);
  });
});

test("grep returns is_error for invalid regex", async () => {
  const result = await runTool("grep", { pattern: "[" });

  assert.equal(result.is_error, true);
  assert.match(result.content, /Invalid pattern/);
});

test("grep caps matches", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "many.txt"), "needle 1\nneedle 2\nneedle 3\nneedle 4\n");

    const result = await runTool("grep", { pattern: "needle", path: "many.txt", max_matches: 3 });

    assert.equal(result.is_error, false);
    assert.match(result.content, /truncated/i);
  });
});
