import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

test("tools array exposes list_files, glob, grep, and apply_patch", () => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.ok(byName.has("list_files"));
  assert.ok(byName.has("glob"));
  assert.ok(byName.has("grep"));
  assert.ok(byName.has("apply_patch"));
  assert.deepEqual((byName.get("list_files")?.input_schema as any).required ?? [], []);
  assert.deepEqual((byName.get("glob")?.input_schema as any).required, ["pattern"]);
  assert.deepEqual((byName.get("grep")?.input_schema as any).required, ["pattern"]);
  assert.deepEqual((byName.get("apply_patch")?.input_schema as any).required, ["patch"]);
});

test("apply_patch applies a simple single-file hunk", async () => {
  await withTempCwd(async (root) => {
    const filePath = path.join(root, "add.js");
    await writeFixture(filePath, "function add(a, b) { return a - b; }\nconsole.log(add(2, 3));\n");

    const result = await runTool("apply_patch", {
      patch: `--- a/add.js
+++ b/add.js
@@ -1,2 +1,2 @@
-function add(a, b) { return a - b; }
+function add(a, b) { return a + b; }
 console.log(add(2, 3));
`,
    });

    assert.equal(result.is_error, false);
    assert.match(result.content, /Applied patch to 1 file/);
    assert.match(result.content, /1 hunk/);
    assert.equal(await readFile(filePath, "utf8"), "function add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n");
  });
});

test("apply_patch applies multiple hunks in one file", async () => {
  await withTempCwd(async (root) => {
    const filePath = path.join(root, "math.js");
    await writeFixture(filePath, "function add(a, b) {\n  return a - b;\n}\n\nfunction label() {\n  return 'bad';\n}\n");

    const result = await runTool("apply_patch", {
      patch: `--- a/math.js
+++ b/math.js
@@ -1,3 +1,3 @@
 function add(a, b) {
-  return a - b;
+  return a + b;
 }
@@ -5,3 +5,3 @@
 function label() {
-  return 'bad';
+  return 'good';
 }
`,
    });

    assert.equal(result.is_error, false);
    assert.match(result.content, /2 hunks/);
    assert.equal(await readFile(filePath, "utf8"), "function add(a, b) {\n  return a + b;\n}\n\nfunction label() {\n  return 'good';\n}\n");
  });
});

test("apply_patch applies multiple files atomically on success", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "a.txt"), "alpha old\n");
    await writeFixture(path.join(root, "b.txt"), "beta old\n");

    const result = await runTool("apply_patch", {
      patch: `--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-alpha old
+alpha new
--- a/b.txt
+++ b/b.txt
@@ -1,1 +1,1 @@
-beta old
+beta new
`,
    });

    assert.equal(result.is_error, false);
    assert.match(result.content, /2 files/);
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "alpha new\n");
    assert.equal(await readFile(path.join(root, "b.txt"), "utf8"), "beta new\n");
  });
});

test("apply_patch does not partially write when a later file fails", async () => {
  await withTempCwd(async (root) => {
    const aPath = path.join(root, "a.txt");
    const bPath = path.join(root, "b.txt");
    await writeFixture(aPath, "alpha old\n");
    await writeFixture(bPath, "beta old\n");

    const result = await runTool("apply_patch", {
      patch: `--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-alpha old
+alpha new
--- a/b.txt
+++ b/b.txt
@@ -1,1 +1,1 @@
-missing old
+beta new
`,
    });

    assert.equal(result.is_error, true);
    assert.match(result.content, /does not match|not found/i);
    assert.equal(await readFile(aPath, "utf8"), "alpha old\n");
    assert.equal(await readFile(bPath, "utf8"), "beta old\n");
  });
});

test("apply_patch reports missing context and leaves file unchanged", async () => {
  await withTempCwd(async (root) => {
    const filePath = path.join(root, "app.js");
    await writeFixture(filePath, "const value = 1;\n");

    const result = await runTool("apply_patch", {
      patch: `--- a/app.js
+++ b/app.js
@@ -1,1 +1,1 @@
-const value = 2;
+const value = 3;
`,
    });

    assert.equal(result.is_error, true);
    assert.match(result.content, /does not match|not found/i);
    assert.equal(await readFile(filePath, "utf8"), "const value = 1;\n");
  });
});

test("apply_patch reports ambiguous fallback matches", async () => {
  await withTempCwd(async (root) => {
    const filePath = path.join(root, "dup.txt");
    await writeFixture(filePath, "same\nsame\n");

    const result = await runTool("apply_patch", {
      patch: `--- a/dup.txt
+++ b/dup.txt
@@ -10,1 +10,1 @@
-same
+changed
`,
    });

    assert.equal(result.is_error, true);
    assert.match(result.content, /ambiguous|more context/i);
    assert.equal(await readFile(filePath, "utf8"), "same\nsame\n");
  });
});

test("apply_patch creates a new file from a /dev/null oldPath", async () => {
  await withTempCwd(async (root) => {
    const result = await runTool("apply_patch", {
      patch: `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+line one
+line two
`,
    });

    assert.equal(result.is_error, false);
    assert.match(result.content, /created 1/);
    assert.equal(
      await readFile(path.join(root, "new.txt"), "utf8"),
      "line one\nline two\n",
    );
  });
});

test("apply_patch create rejects when target file already exists", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "exists.txt"), "original\n");

    const result = await runTool("apply_patch", {
      patch: `--- /dev/null
+++ b/exists.txt
@@ -0,0 +1,1 @@
+overwritten
`,
    });

    assert.equal(result.is_error, true);
    assert.match(result.content, /already exists/i);
    assert.equal(await readFile(path.join(root, "exists.txt"), "utf8"), "original\n");
  });
});

test("apply_patch create rejects hunks with context or removal lines", async () => {
  await withTempCwd(async (root) => {
    const result = await runTool("apply_patch", {
      patch: `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
-context
+new
`,
    });

    assert.equal(result.is_error, true);
    assert.match(result.content, /only additions|normal hunk/i);
  });
});

test("apply_patch rejects file deletion", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, "old.txt"), "old\n");

    const deleteResult = await runTool("apply_patch", {
      patch: `--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-old
`,
    });

    assert.equal(deleteResult.is_error, true);
    assert.match(deleteResult.content, /deletion is not supported/i);
    assert.equal(await readFile(path.join(root, "old.txt"), "utf8"), "old\n");
  });
});

test("apply_patch reports malformed patches", async () => {
  const result = await runTool("apply_patch", { patch: "not a patch" });

  assert.equal(result.is_error, true);
  assert.match(result.content, /Invalid patch|hunk|file/i);
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

test("glob respects .gitignore entries (directories and suffixes)", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, ".gitignore"), "build/\n*.log\n");
    await writeFixture(path.join(root, "src/index.ts"), "export {};\n");
    await writeFixture(path.join(root, "build/out.js"), "module.exports = {};\n");
    await writeFixture(path.join(root, "debug.log"), "log line\n");
    await writeFixture(path.join(root, "notes.txt"), "keep me\n");

    const result = await runTool("glob", { pattern: "**/*" });

    assert.equal(result.is_error, false);
    assert.match(result.content, /src\/index\.ts/);
    assert.match(result.content, /notes\.txt/);
    // build/ and *.log are gitignored, must not appear
    assert.doesNotMatch(result.content, /build\/out\.js/);
    assert.doesNotMatch(result.content, /debug\.log/);
  });
});

test("grep respects .gitignore and skips ignored files", async () => {
  await withTempCwd(async (root) => {
    await writeFixture(path.join(root, ".gitignore"), "vendor/\n");
    await writeFixture(path.join(root, "src/app.ts"), "const needle = 1;\n");
    await writeFixture(path.join(root, "vendor/lib.ts"), "const needle = 2;\n");

    const result = await runTool("grep", { pattern: "needle" });

    assert.equal(result.is_error, false);
    assert.match(result.content, /src\/app\.ts/);
    assert.doesNotMatch(result.content, /vendor\/lib\.ts/);
  });
});
