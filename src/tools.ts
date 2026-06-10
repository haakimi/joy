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
      "The sub-agent runs independently with its own tools (read, write, edit, bash) " +
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
