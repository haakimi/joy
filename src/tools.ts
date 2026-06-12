import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type Anthropic from "@anthropic-ai/sdk";

export type ToolDef = Anthropic.Tool;

export const tools: ToolDef[] = [
  {
    name: "read",
    description:
      "Read the contents of a file from the local filesystem. Returns the file text. " +
      "Use this before editing a file you have not yet seen. Paths may be absolute or relative to the current working directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read." },
        max_bytes: {
          type: "integer",
          description: "Optional cap on bytes returned (default 200000).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description:
      "List files and directories under a directory. Paths may be absolute or relative to the current working directory. " +
      "Use this to inspect project structure before reading or editing files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory or file path to list. Defaults to current working directory." },
        recursive: { type: "boolean", description: "Whether to list recursively. Defaults to false." },
        max_entries: { type: "integer", description: "Maximum entries to return (default 200, hard cap 1000)." },
      },
      required: [],
    },
  },
  {
    name: "glob",
    description:
      "Find files and directories matching a glob pattern. Supports *, ?, and **. " +
      "Paths may be absolute or relative to the current working directory.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match, for example src/**/*.ts." },
        path: { type: "string", description: "Directory to search from. Defaults to current working directory." },
        max_matches: { type: "integer", description: "Maximum matches to return (default 200, hard cap 1000)." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description:
      "Search file contents for a JavaScript regular expression. Returns matching file paths and line numbers. " +
      "Use this for code/content search before falling back to bash grep.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression pattern to search for." },
        path: { type: "string", description: "File or directory to search. Defaults to current working directory." },
        include: { type: "string", description: "Optional glob pattern for files to include, for example **/*.ts." },
        case_sensitive: { type: "boolean", description: "Whether matching is case-sensitive. Defaults to true." },
        max_matches: { type: "integer", description: "Maximum matching lines to return (default 100, hard cap 1000)." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "update_plan",
    description:
      "Update or create a task plan. Provide an optional explanation and a list of plan items, each with a step and status. " +
      "At most one step can be in_progress at a time. Use this tool to organize work before starting complex tasks.",
    input_schema: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Optional explanation for this plan update.",
        },
        plan: {
          type: "array",
          description: "The list of steps",
          items: {
            type: "object",
            properties: {
              status: {
                type: "string",
                description: "Step status.",
                enum: ["pending", "in_progress", "completed"],
              },
              step: {
                type: "string",
                description: "Task step text.",
              },
            },
            required: ["step", "status"],
          },
        },
      },
      required: ["plan"],
    },
  },
  {
    name: "write",
    description:
      "Create a new file or fully overwrite an existing one with the provided content. " +
      "Parent directories are created automatically. Prefer `edit` for small in-place changes.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Destination file path." },
        content: { type: "string", description: "Full file content to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit",
    description:
      "Replace an exact substring in a file with new text. `old_string` must occur exactly once " +
      "(unless `replace_all` is true). This is the preferred tool for small, targeted changes.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to edit." },
        old_string: {
          type: "string",
          description: "Exact existing text to replace. Include enough context to be unique.",
        },
        new_string: { type: "string", description: "Replacement text." },
        replace_all: {
          type: "boolean",
          description: "If true, replace every occurrence. Defaults to false.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a unified diff patch to existing UTF-8 text files. " +
      "Use this for multi-line, multi-hunk, or multi-file edits. " +
      "All hunks are validated before any file is written; file creation/deletion is not supported in v1.",
    input_schema: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Unified diff patch text." },
      },
      required: ["patch"],
    },
  },
  {
    name: "bash",
    description:
      "Run a shell command via `bash -lc` in the current working directory. " +
      "Returns combined stdout/stderr and the exit code. Avoid long-running interactive commands.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        timeout_ms: {
          type: "integer",
          description: "Optional timeout in milliseconds (default 120000).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "spawn_agent",
    description:
      "Spawn a sub-agent to work on a specific subtask in parallel. " +
      "The sub-agent runs independently with its own tools (read, list_files, glob, grep, write, edit, apply_patch, bash) " +
      "and returns a summary when done. Use this to delegate well-scoped, independent " +
      "work that can run concurrently with other tasks. Returns a subagent ID.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task for the sub-agent to complete. Be specific about what to do and what files to touch.",
        },
        model: {
          type: "string",
          description: "Optional model override for the sub-agent. Defaults to the main agent's model.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "wait_agent",
    description:
      "Wait for a previously spawned sub-agent to finish and get its result. " +
      "Returns the sub-agent's final summary. Use this when you need the sub-agent's " +
      "output before proceeding.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "The ID of the sub-agent to wait for (returned by spawn_agent).",
        },
      },
      required: ["agent_id"],
    },
  },
];

function resolvePath(p: string): string {
  if (p.startsWith("~")) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(process.cwd(), p);
}

const MAX_TOOL_OUTPUT_BYTES = 100_000;
const MAX_WALK_ENTRIES = 20_000;
const DEFAULT_LIST_MAX = 200;
const HARD_LIST_MAX = 1_000;
const DEFAULT_GLOB_MAX = 200;
const HARD_GLOB_MAX = 1_000;
const DEFAULT_GREP_MAX = 100;
const HARD_GREP_MAX = 1_000;
const MAX_GREP_FILE_BYTES = 1_000_000;
const MAX_GREP_LINE_CHARS = 300;
const MAX_PATCH_BYTES = 200_000;
const MAX_PATCH_FILES = 50;
const MAX_PATCH_HUNKS = 500;
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".next", ".cache"]);

type WalkEntry = {
  abs: string;
  rel: string;
  isDir: boolean;
};

function clampLimit(value: unknown, defaultValue: number, hardMax: number): number {
  const n = Number(value ?? defaultValue);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), hardMax);
}

function limitOutput(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_TOOL_OUTPUT_BYTES) return text;
  return text.slice(0, MAX_TOOL_OUTPUT_BYTES) + `\n... [truncated output to ${MAX_TOOL_OUTPUT_BYTES} bytes]`;
}

function normalizeSlash(value: string): string {
  return value.split(path.sep).join("/");
}

function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}

function formatRelative(root: string, absolutePath: string): string {
  const rel = normalizeSlash(path.relative(root, absolutePath));
  return rel || path.basename(absolutePath);
}

async function walkEntries(root: string, opts: { recursive: boolean; includeDirs?: boolean }): Promise<{ entries: WalkEntry[]; truncated: boolean }> {
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) {
    return { entries: [{ abs: root, rel: path.basename(root), isDir: false }], truncated: false };
  }

  const out: WalkEntry[] = [];
  let truncated = false;

  async function visit(dir: string): Promise<void> {
    if (out.length >= MAX_WALK_ENTRIES) {
      truncated = true;
      return;
    }
    const children = await fs.readdir(dir, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (out.length >= MAX_WALK_ENTRIES) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, child.name);
      const rel = formatRelative(root, abs);
      if (child.isDirectory()) {
        if (opts.includeDirs !== false) out.push({ abs, rel, isDir: true });
        if (opts.recursive && !isIgnoredDir(child.name)) {
          await visit(abs);
        }
      } else if (child.isFile()) {
        out.push({ abs, rel, isDir: false });
      }
    }
  }

  await visit(root);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return { entries: out, truncated };
}

function formatEntry(entry: WalkEntry): string {
  return entry.isDir ? `dir  ${entry.rel}/` : `file ${entry.rel}`;
}

async function listFilesTool(input: Record<string, unknown>): Promise<{ content: string; is_error: boolean }> {
  const p = resolvePath(String(input.path ?? "."));
  const recursive = Boolean(input.recursive);
  const max = clampLimit(input.max_entries, DEFAULT_LIST_MAX, HARD_LIST_MAX);
  const stat = await fs.stat(p);
  const root = stat.isDirectory() ? p : path.dirname(p);
  const walked = stat.isDirectory()
    ? await walkEntries(p, { recursive, includeDirs: true })
    : { entries: [{ abs: p, rel: path.basename(p), isDir: false }], truncated: false };
  const shown = walked.entries.slice(0, max);
  const truncated = walked.truncated || walked.entries.length > max;
  const lines = [
    `${stat.isDirectory() ? "Directory" : "File"}: ${p}`,
    `Showing ${shown.length}${truncated ? ` of ${walked.entries.length}` : ""} entries`,
    ...shown.map((entry) => stat.isDirectory() ? formatEntry(entry) : `file ${formatRelative(root, entry.abs)}`),
  ];
  if (truncated) lines.push(`... [truncated after ${shown.length} entries; narrow path or increase max_entries]`);
  if (shown.length === 0) lines.push("No files found.");
  return { content: limitOutput(lines.join("\n")), is_error: false };
}

function escapeRegExp(ch: string): string {
  return /[\\^$+?.()|{}\[\]]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeSlash(pattern).replace(/^\.\//, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  let source = "^";
  segments.forEach((segment, idx) => {
    if (segment === "**") {
      source += idx === 0 ? "(?:[^/]+/)*" : "/(?:[^/]+/)*";
      return;
    }
    if (idx > 0 && segments[idx - 1] !== "**") source += "/";
    for (const ch of segment) {
      if (ch === "*") source += "[^/]*";
      else if (ch === "?") source += "[^/]";
      else source += escapeRegExp(ch);
    }
  });
  source += "$";
  return new RegExp(source);
}

function hasGlobMagic(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

function matchesGlob(rel: string, pattern: string): boolean {
  const normalizedRel = normalizeSlash(rel);
  if (!hasGlobMagic(pattern)) return normalizedRel === normalizeSlash(pattern).replace(/^\.\//, "");
  return globToRegExp(pattern).test(normalizedRel);
}

async function globTool(input: Record<string, unknown>): Promise<{ content: string; is_error: boolean }> {
  const pattern = String(input.pattern ?? "");
  if (!pattern) return { content: "pattern is required for glob", is_error: true };
  const root = resolvePath(String(input.path ?? "."));
  const max = clampLimit(input.max_matches, DEFAULT_GLOB_MAX, HARD_GLOB_MAX);
  const stat = await fs.stat(root);
  const walked = stat.isDirectory()
    ? await walkEntries(root, { recursive: true, includeDirs: true })
    : { entries: [{ abs: root, rel: path.basename(root), isDir: false }], truncated: false };
  const matches = walked.entries
    .filter((entry) => matchesGlob(entry.rel + (entry.isDir ? "/" : ""), pattern) || matchesGlob(entry.rel, pattern))
    .map((entry) => entry.isDir ? `${entry.rel}/` : entry.rel)
    .sort((a, b) => a.localeCompare(b));
  const shown = matches.slice(0, max);
  const truncated = walked.truncated || matches.length > max;
  const lines = [`Glob: ${pattern}`, `Root: ${root}`];
  if (shown.length === 0) lines.push("No matches found.");
  else lines.push(...shown);
  if (truncated) lines.push(`... [truncated after ${shown.length} matches; narrow path or increase max_matches]`);
  return { content: limitOutput(lines.join("\n")), is_error: false };
}

async function grepTool(input: Record<string, unknown>): Promise<{ content: string; is_error: boolean }> {
  const pattern = String(input.pattern ?? "");
  if (!pattern) return { content: "pattern is required for grep", is_error: true };
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, input.case_sensitive === false ? "i" : "");
  } catch (err: any) {
    return { content: `Invalid pattern: ${err?.message ?? String(err)}`, is_error: true };
  }

  const target = resolvePath(String(input.path ?? "."));
  const include = String(input.include ?? "**/*");
  const max = clampLimit(input.max_matches, DEFAULT_GREP_MAX, HARD_GREP_MAX);
  const stat = await fs.stat(target);
  const outputRoot = process.cwd();
  const walked = stat.isDirectory()
    ? await walkEntries(target, { recursive: true, includeDirs: false })
    : { entries: [{ abs: target, rel: formatRelative(outputRoot, target), isDir: false }], truncated: false };
  const files = walked.entries
    .map((entry) => ({ ...entry, rel: formatRelative(outputRoot, entry.abs) }))
    .filter((entry) => !entry.isDir && matchesGlob(entry.rel, include));
  const matches: string[] = [];
  let skipped = 0;
  let truncated = walked.truncated;

  for (const file of files) {
    if (matches.length >= max) {
      truncated = true;
      break;
    }
    const fileStat = await fs.stat(file.abs);
    if (fileStat.size > MAX_GREP_FILE_BYTES) {
      skipped++;
      continue;
    }
    const buf = await fs.readFile(file.abs);
    if (buf.includes(0)) {
      skipped++;
      continue;
    }
    const lines = buf.toString("utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue;
      const text = lines[i].length > MAX_GREP_LINE_CHARS
        ? lines[i].slice(0, MAX_GREP_LINE_CHARS) + "…"
        : lines[i];
      matches.push(`${file.rel}:${i + 1}:${text}`);
      if (matches.length >= max) {
        truncated = true;
        break;
      }
    }
  }

  const lines = matches.length === 0
    ? [`No matches for /${pattern}/ under ${target}`]
    : [`Found ${matches.length} match${matches.length === 1 ? "" : "es"}`, ...matches];
  if (skipped > 0) lines.push(`Skipped ${skipped} large or binary file${skipped === 1 ? "" : "s"}.`);
  if (truncated) lines.push(`... [truncated after ${matches.length} matches; narrow path/include or increase max_matches]`);
  return { content: limitOutput(lines.join("\n")), is_error: false };
}

type PatchLine = {
  kind: "context" | "remove" | "add";
  text: string;
};

type PatchHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchLine[];
};

type PatchFile = {
  oldPath: string;
  newPath: string;
  path: string;
  hunks: PatchHunk[];
};

function stripDiffPrefix(filePath: string): string {
  const withoutMeta = filePath.trim().split(/\s+/)[0];
  if (withoutMeta === "/dev/null") return withoutMeta;
  return withoutMeta.replace(/^[ab]\//, "");
}

function parseHunkHeader(line: string): Pick<PatchHunk, "oldStart" | "oldCount" | "newStart" | "newCount"> | undefined {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return undefined;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? "1"),
  };
}

function parseUnifiedPatch(patch: string): PatchFile[] {
  if (!patch.trim()) throw new Error("Invalid patch: patch must be non-empty");
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    throw new Error(`Invalid patch: patch exceeds ${MAX_PATCH_BYTES} bytes`);
  }

  const lines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: PatchFile[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith("--- ")) {
      i++;
      continue;
    }

    const oldPath = stripDiffPrefix(lines[i].slice(4));
    i++;
    if (i >= lines.length || !lines[i].startsWith("+++ ")) {
      throw new Error("Invalid patch: file header must include +++ line");
    }
    const newPath = stripDiffPrefix(lines[i].slice(4));
    i++;

    if (oldPath === "/dev/null" || newPath === "/dev/null") {
      throw new Error("Invalid patch: file creation and deletion are not supported in apply_patch v1; patch existing files only");
    }
    if (oldPath !== newPath) {
      throw new Error("Invalid patch: renames are not supported in apply_patch v1");
    }

    const patchFile: PatchFile = { oldPath, newPath, path: newPath, hunks: [] };

    while (i < lines.length) {
      if (lines[i].startsWith("--- ")) break;
      if (lines[i].startsWith("diff --git ") && patchFile.hunks.length > 0) break;
      if (!lines[i].startsWith("@@ ")) {
        i++;
        continue;
      }

      const header = parseHunkHeader(lines[i]);
      if (!header) throw new Error(`Invalid patch: malformed hunk header "${lines[i]}"`);
      i++;
      const hunk: PatchHunk = { ...header, lines: [] };

      while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("--- ")) {
        const line = lines[i];
        if (line === "\\ No newline at end of file") {
          i++;
          continue;
        }
        const marker = line[0];
        if (marker === " ") hunk.lines.push({ kind: "context", text: line.slice(1) });
        else if (marker === "-") hunk.lines.push({ kind: "remove", text: line.slice(1) });
        else if (marker === "+") hunk.lines.push({ kind: "add", text: line.slice(1) });
        else throw new Error(`Invalid patch: hunk line must start with space, -, or +: "${line}"`);
        i++;
      }

      if (hunk.lines.length === 0) throw new Error("Invalid patch: hunk must contain at least one line");
      patchFile.hunks.push(hunk);
    }

    if (patchFile.hunks.length === 0) throw new Error(`Invalid patch: file ${patchFile.path} has no hunks`);
    files.push(patchFile);
  }

  if (files.length === 0) throw new Error("Invalid patch: no file sections found");
  if (files.length > MAX_PATCH_FILES) throw new Error(`Invalid patch: more than ${MAX_PATCH_FILES} files`);
  const hunkCount = files.reduce((sum, file) => sum + file.hunks.length, 0);
  if (hunkCount > MAX_PATCH_HUNKS) throw new Error(`Invalid patch: more than ${MAX_PATCH_HUNKS} hunks`);
  return files;
}

function splitTextLines(text: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function joinTextLines(lines: string[], trailingNewline: boolean): string {
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

function lineBlockMatches(lines: string[], start: number, block: string[]): boolean {
  if (start < 0 || start + block.length > lines.length) return false;
  for (let i = 0; i < block.length; i++) {
    if (lines[start + i] !== block[i]) return false;
  }
  return true;
}

function findUniqueLineBlock(lines: string[], block: string[], hintedIndex: number, filePath: string): number {
  if (lineBlockMatches(lines, hintedIndex, block)) return hintedIndex;
  const matches: number[] = [];
  for (let i = 0; i <= lines.length - block.length; i++) {
    if (lineBlockMatches(lines, i, block)) matches.push(i);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Patch hunk for ${filePath} is ambiguous; include more context`);
  }
  throw new Error(`Patch hunk for ${filePath} does not match existing content`);
}

function applyFileHunks(original: string, patchFile: PatchFile): { text: string; added: number; removed: number } {
  const split = splitTextLines(original);
  let lines = split.lines;
  let added = 0;
  let removed = 0;

  for (const hunk of patchFile.hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.kind === "context" || line.kind === "remove")
      .map((line) => line.text);
    const newLines = hunk.lines
      .filter((line) => line.kind === "context" || line.kind === "add")
      .map((line) => line.text);
    const hintedIndex = Math.max(0, hunk.oldStart - 1);
    const index = findUniqueLineBlock(lines, oldLines, hintedIndex, patchFile.path);
    lines = [...lines.slice(0, index), ...newLines, ...lines.slice(index + oldLines.length)];
    added += hunk.lines.filter((line) => line.kind === "add").length;
    removed += hunk.lines.filter((line) => line.kind === "remove").length;
  }

  return { text: joinTextLines(lines, split.trailingNewline), added, removed };
}

function assertPathInsideCwd(absPath: string): void {
  const cwd = process.cwd();
  const rel = path.relative(cwd, absPath);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error(`Patch path escapes current working directory: ${absPath}`);
}

async function applyPatchTool(input: Record<string, unknown>): Promise<{ content: string; is_error: boolean }> {
  const patch = String(input.patch ?? "");
  const files = parseUnifiedPatch(patch);
  const updates: Array<{ abs: string; text: string }> = [];
  let added = 0;
  let removed = 0;
  let hunkCount = 0;

  for (const file of files) {
    const abs = resolvePath(file.path);
    assertPathInsideCwd(abs);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error(`Patch target is not a file: ${file.path}`);
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) throw new Error(`Patch target appears to be binary: ${file.path}`);
    const applied = applyFileHunks(buf.toString("utf8"), file);
    updates.push({ abs, text: applied.text });
    added += applied.added;
    removed += applied.removed;
    hunkCount += file.hunks.length;
  }

  for (const update of updates) {
    await fs.writeFile(update.abs, update.text, "utf8");
  }

  return {
    content: `Applied patch to ${files.length} file${files.length === 1 ? "" : "s"} (${hunkCount} hunk${hunkCount === 1 ? "" : "s"}, +${added} -${removed})`,
    is_error: false,
  };
}

export type ToolEventEmitter = (e: { type: string; [key: string]: unknown }) => void;

let _toolEventEmitter: ToolEventEmitter | null = null;

export function setToolEventEmitter(emitter: ToolEventEmitter): void {
  _toolEventEmitter = emitter;
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; is_error: boolean }> {
  try {
    switch (name) {
      case "read": {
        const p = resolvePath(String(input.path));
        const max = Number(input.max_bytes ?? 200_000);
        const buf = await fs.readFile(p);
        const text =
          buf.length > max
            ? buf.subarray(0, max).toString("utf8") +
              `\n... [truncated ${buf.length - max} bytes]`
            : buf.toString("utf8");
        return { content: text, is_error: false };
      }
      case "list_files": {
        return await listFilesTool(input);
      }
      case "glob": {
        return await globTool(input);
      }
      case "grep": {
        return await grepTool(input);
      }
      case "write": {
        const p = resolvePath(String(input.path));
        const content = String(input.content ?? "");
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, content, "utf8");
        return {
          content: `Wrote ${content.length} chars to ${p}`,
          is_error: false,
        };
      }
      case "edit": {
        const p = resolvePath(String(input.path));
        const oldStr = String(input.old_string ?? "");
        const newStr = String(input.new_string ?? "");
        const all = Boolean(input.replace_all);
        if (!oldStr) {
          return { content: "old_string must be non-empty", is_error: true };
        }
        const original = await fs.readFile(p, "utf8");
        const count = original.split(oldStr).length - 1;
        if (count === 0) {
          return {
            content: `old_string not found in ${p}`,
            is_error: true,
          };
        }
        if (count > 1 && !all) {
          return {
            content: `old_string found ${count} times in ${p}. Provide more context or set replace_all=true.`,
            is_error: true,
          };
        }
        const updated = all
          ? original.split(oldStr).join(newStr)
          : original.replace(oldStr, newStr);
        await fs.writeFile(p, updated, "utf8");
        return {
          content: `Edited ${p} (${count} replacement${count > 1 ? "s" : ""})`,
          is_error: false,
        };
      }
      case "apply_patch": {
        return await applyPatchTool(input);
      }
      case "bash": {
        const cmd = String(input.command ?? "");
        const timeout = Number(input.timeout_ms ?? 120_000);
        return await runBash(cmd, timeout);
      }
      case "spawn_agent": {
        const task = String(input.task ?? "");
        const model = String(input.model ?? process.env.JOY_MODEL ?? "claude-sonnet-4-6");
        if (!task) {
          return { content: "task is required for spawn_agent", is_error: true };
        }
        const agentId = await runSubagent(task, model);
        if (_toolEventEmitter) {
          _toolEventEmitter({ type: "subagent_spawned", agentId, task });
        }
        return {
          content: `Sub-agent spawned with ID: ${agentId}\nTask: ${task}`,
          is_error: false,
        };
      }
      case "wait_agent": {
        const agentId = String(input.agent_id ?? "");
        if (!agentId) {
          return { content: "agent_id is required for wait_agent", is_error: true };
        }
        const result = await waitForSubagent(agentId);
        if (_toolEventEmitter) {
          _toolEventEmitter({ type: "subagent_result", agentId, result });
        }
        return { content: result, is_error: false };
      }
      default:
        return { content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (err: any) {
    return {
      content: `Error: ${err?.message ?? String(err)}`,
      is_error: true,
    };
  }
}

// --- Sub-agent management ---

interface SubAgent {
  id: string;
  task: string;
  model: string;
  promise: Promise<string>;
}

const subagents = new Map<string, SubAgent>();
let subagentCounter = 0;

/**
 * Set the runAgent function from agent.ts to avoid circular imports.
 * Called by agent.ts during initialization.
 */
let _runAgent: ((prompt: string, opts: any) => Promise<string>) | null = null;

export function setSubagentRunner(
  runner: (prompt: string, opts: any) => Promise<string>,
): void {
  _runAgent = runner;
}

async function runSubagent(
  task: string,
  model: string,
): Promise<string> {
  if (!_runAgent) {
    return "Error: sub-agent runner not initialized";
  }

  const id = `sub-${++subagentCounter}`;

  const promise = (async () => {
    try {
      const result = await _runAgent(task, {
        model,
        maxIterations: 15,
        isSubagent: true,
        subagentId: id,
      });
      return result;
    } catch (err: any) {
      return `Sub-agent error: ${err?.message ?? String(err)}`;
    }
  })();

  subagents.set(id, { id, task, model, promise });
  return id;
}

async function waitForSubagent(agentId: string): Promise<string> {
  const agent = subagents.get(agentId);
  if (!agent) {
    return `Error: no sub-agent found with ID "${agentId}"`;
  }
  try {
    const result = await agent.promise;
    subagents.delete(agentId);
    return result;
  } catch (err: any) {
    subagents.delete(agentId);
    return `Sub-agent error: ${err?.message ?? String(err)}`;
  }
}

function runBash(
  command: string,
  timeoutMs: number,
): Promise<{ content: string; is_error: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: process.cwd(),
      env: process.env,
    });
    const chunks: Buffer[] = [];
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString("utf8");
      const trimmed =
        out.length > 100_000
          ? out.slice(0, 100_000) + `\n... [truncated ${out.length - 100_000} bytes]`
          : out;
      const header = killed
        ? `[killed after ${timeoutMs}ms]\n`
        : `[exit ${code}]\n`;
      resolve({
        content: header + trimmed,
        is_error: killed || (code ?? 0) !== 0,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ content: `spawn error: ${err.message}`, is_error: true });
    });
  });
}
