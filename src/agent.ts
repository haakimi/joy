import { tools, runTool, setSubagentRunner, setToolEventEmitter } from "./tools.js";
import { discoverSkills, buildSkillsPrompt, type SkillMeta } from "./skills.js";
import { createProvider } from "./providers/index.js";
import { normalizeProviderResponse } from "./providers/normalize.js";
import { COMPACT_SUMMARY_PROMPT } from "./compact.js";
import type { ModelProvider, ProviderMessage, ProviderName, ProviderToolResultBlock, ToolRepairDiagnostic } from "./providers/types.js";

const BASE_SYSTEM_PROMPT = `You are Joy, a terminal coding agent.

Intent Router + Grounded ReAct policy:
Before answering, internally classify the user's request. Keep internal reasoning private; do not print Thought, Action, or Observation labels unless the user explicitly asks for a ReAct trace.

1. Project-grounded questions: if the user asks about the current project, current repo, current Joy, implemented features, available tools, eval cases, provider support, CLI behavior, file contents, or what Joy currently does, inspect the local repository before answering. Use list_files, glob, grep, and read to gather evidence. Do not answer from memory when the answer depends on current repo state. In the final answer, mention the files or commands used as evidence.

2. General concept questions: if the user asks a general concept question, answer directly in beginner-friendly language without unnecessary tool use. Match the user's language; answer in Chinese when the user asks in Chinese. Start with a one-sentence plain-language definition, then give a simple analogy or example. Only inspect local files if the user asks how the concept is implemented in Joy or this repo.

3. Joy-specific concept questions: if the user asks about a concept as implemented in Joy, first explain the concept briefly, then inspect relevant local files, then answer grounded in the current implementation.

You have local tools for reading files, listing files, globbing paths, grepping text,
writing/editing files, applying unified diff patches, running bash commands,
planning, and spawning/waiting for sub-agents. Use list_files to inspect directories, glob to find files by path
pattern, and grep to search file contents. Prefer these search tools over bash
for basic code discovery because their output is capped and easier to read.
Prefer 'edit' for tiny exact replacements, 'apply_patch' for multi-line, multi-hunk, or multi-file changes, and 'write' only when creating or fully replacing files. Read a file before editing it.
When using 'bash', keep commands short and non-interactive.

Before starting any non-trivial task, use the update_plan tool to create a todo
list of steps. This helps you stay organized and lets the user see your plan.
Mark each step as pending, then update the first step to in_progress. As you
complete steps, call update_plan again to mark them completed and advance the
next step to in_progress. Keep plans concise — 3-7 steps is usually enough.

For complex tasks with independent subtasks, use spawn_agent to delegate work
to sub-agents that run in parallel. Each sub-agent gets its own context and
tools. Use wait_agent to collect their results. Sub-agents are best for tasks
like: exploring a codebase while you work on something else, running independent
file modifications, or researching solutions in parallel.

Work in small steps. After you finish the user's request, send a final assistant
message (without any tool calls) summarizing what you did.`;

const SUBAGENT_SYSTEM_PROMPT = `You are a Joy sub-agent working on a specific subtask.
You have local tools for reading files, listing files, globbing paths, grepping text,
writing/editing files with edit and apply_patch, running bash commands, and
planning. Use list_files, glob, and grep for code discovery. Focus ONLY on the task you were given. Do not spawn additional sub-agents.

Grounding policy: inspect files before making repo-state claims. If the subtask is a concept explanation, answer simply in the user's language, including Chinese when appropriate. Keep internal reasoning private.

When you finish, provide a clear summary of what you did: files changed, key
decisions, and any issues encountered. Be concise.`;

export interface AgentOptions {
  model: string;
  maxIterations?: number;
  maxTokens?: number;
  onEvent?: (e: AgentEvent) => void;
  skills?: SkillMeta[];
  skillsExtraRoots?: string[];
  /** Called when the agent compresses context. Return new messages to continue. */
  onCompact?: (summary: string, tokensSaved: number) => ProviderMessage[];
  /** Internal: true when this agent is a sub-agent. */
  isSubagent?: boolean;
  /** Internal: sub-agent ID for event routing. */
  subagentId?: string;
  /** Initial conversation messages to continue from. */
  initialMessages?: ProviderMessage[];
  /** Provider to use when creating the model backend. */
  providerName?: ProviderName;
  /** Internal: override provider for tests. */
  provider?: ModelProvider;
  /** Signal to abort the agent. */
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: "assistant_text"; text: string; isThinking?: boolean }
  | { type: "tool_call"; name: string; input: unknown; id: string }
  | { type: "tool_result"; id: string; output: string; is_error: boolean }
  | { type: "iteration"; n: number }
  | { type: "skills_loaded"; count: number; names: string[] }
  | { type: "stop"; reason: string }
  | {
      type: "turnEnd";
      n: number;
      tools: number;
      durationMs: number;
      tokIn: number;
      tokOut: number;
    }
  | {
      type: "tool_call_pending_dropped";
      id: string;
      name: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cumulativeInput: number;
      cumulativeOutput: number;
    }
  | {
      type: "plan_update";
      plan: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
      explanation?: string;
      id: string;
    }
  | {
      type: "compact";
      summary: string;
      savedTokens: number;
    }
  | {
      type: "subagent_spawned";
      agentId: string;
      task: string;
    }
  | {
      type: "subagent_result";
      agentId: string;
      result: string;
    }
  | {
      type: "provider_response_repaired";
      diagnostics: ToolRepairDiagnostic[];
    };

export function collectSubagentText(events: AgentEvent[]): string {
  const parts = events
    .filter((e): e is Extract<AgentEvent, { type: "assistant_text" }> =>
      e.type === "assistant_text" && !e.isThinking && e.text.trim().length > 0,
    )
    .map((e) => e.text);
  return parts.length > 0 ? parts.join("\n\n") : "(sub-agent completed with no output)";
}

// Wire up the sub-agent runner (called once at startup)
setSubagentRunner(async (prompt: string, opts: any) => {
  // Sub-agents don't emit events to the main UI; we capture the result
  const events: AgentEvent[] = [];
  await runAgent(prompt, {
    ...opts,
    onEvent: (e: AgentEvent) => {
      events.push(e);
    },
  });
  return collectSubagentText(events);
});

async function compressConversation(
  provider: ModelProvider,
  model: string,
  messages: ProviderMessage[],
  system: string,
  cumulativeInputBefore: number,
): Promise<{ summary: string; recent: ProviderMessage[]; tokensSaved: number; summaryInputTokens: number } | null> {
  // Keep the most recent messages verbatim so the agent does not lose
  // immediate context (a file it just read, a tool result it is acting on).
  // Only the earlier history is summarized.
  const recentKeep = Number(process.env.JOY_COMPACT_KEEP_RECENT) || 6;
  // A tool_use must stay paired with its tool_result, or the provider will
  // reject the messages. Walk backwards from the split point and extend the
  // "recent" window until tool_use/tool_result pairs are balanced.
  let splitIdx = Math.max(0, messages.length - recentKeep);
  splitIdx = balanceToolPairs(messages, splitIdx);
  let toCompress = messages.slice(0, splitIdx);
  let recent = messages.slice(splitIdx);

  // If the conversation is shorter than the recent-keep window but still over
  // the token threshold (for example, one very large user prompt), summarize the
  // whole history. Skipping here would leave Joy unable to compact the exact
  // cases where compaction is most needed.
  if (toCompress.length === 0 && messages.length > 0) {
    toCompress = messages;
    recent = [];
  }

  // Nothing to summarize.
  if (toCompress.length === 0) return null;

  // Build a compact, tool-free system prompt for the summary call: the full
  // tool catalog and skills block are irrelevant to summarization and would
  // just waste tokens. Inject the live working state (current plan, last
  // error, recently edited files) so the model cannot drop it.
  const workingState = extractWorkingState(messages, recent);
  const summarySystem = `${COMPACT_SUMMARY_PROMPT}${workingState ? `\n\n## Current Working State (must be preserved)\n${workingState}` : ""}`;

  try {
    const resp = await provider.createMessage({
      model,
      maxTokens: 4096,
      system: summarySystem,
      tools: [],
      messages: toCompress,
    });
    // A truncated summary is worse than no summary: it would silently replace
    // complete history with a half-finished handoff. If the model hit the
    // output limit, skip compaction and keep the original history.
    if (resp.stopReason === "max_tokens") {
      return null;
    }
    const summary = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!summary.trim()) {
      // Empty summary is useless — skip compaction rather than wiping real
      // history with nothing.
      return null;
    }
    const summaryInputTokens = resp.usage.inputTokens;
    const tokensSaved = Math.max(0, cumulativeInputBefore - summaryInputTokens);
    return { summary, recent, tokensSaved, summaryInputTokens };
  } catch (err) {
    // Compaction is an optimization, not a requirement: a failed summary
    // request (network, rate limit, etc.) must NOT abort the whole task.
    // Skip compaction this turn and keep working with the original history.
    return null;
  }
}

// Move the split index forward (toward 0) until the "to compress" prefix ends
// on a balanced tool boundary: every tool_use in the kept tail must have its
// matching tool_result, and we never split inside a tool_use/tool_result pair.
function balanceToolPairs(messages: ProviderMessage[], splitIdx: number): number {
  let idx = splitIdx;
  // If the message just BEFORE the split is a tool_use (assistant) without its
  // result in the prefix, the result must be in the tail — extend tail back.
  // Simpler robust rule: never start the "recent" window with a tool_result
  // whose tool_use landed in the compressed part. Walk back while the first
  // recent message is a tool_result.
  while (idx > 0 && isToolResultMessage(messages[idx])) {
    idx--;
  }
  // Also ensure we don't end the compressed prefix on a dangling tool_use
  // (assistant message containing tool_use blocks) whose results are in recent.
  while (idx > 0 && messages[idx - 1] && hasToolUse(messages[idx - 1]) && !hasMatchingResultInPrefix(messages, idx - 1)) {
    idx--;
  }
  return idx;
}

function isToolResultMessage(m: ProviderMessage): boolean {
  return Array.isArray(m.content) && m.content.some((b) => typeof b === "object" && b !== null && (b as any).type === "tool_result");
}

function hasToolUse(m: ProviderMessage): boolean {
  return Array.isArray(m.content) && m.content.some((b) => typeof b === "object" && b !== null && (b as any).type === "tool_use");
}

function hasMatchingResultInPrefix(messages: ProviderMessage[], useIdx: number): boolean {
  const useMsg = messages[useIdx];
  if (!useMsg || !Array.isArray(useMsg.content)) return true;
  const ids = new Set<string>();
  for (const b of useMsg.content) {
    if (typeof b === "object" && b !== null && (b as any).type === "tool_use") {
      ids.add((b as any).id);
    }
  }
  if (ids.size === 0) return true;
  // Look for matching tool_result anywhere after useIdx (in the prefix slice).
  for (let j = useIdx + 1; j < messages.length; j++) {
    const c = messages[j].content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (typeof b === "object" && b !== null && (b as any).type === "tool_result" && ids.has((b as any).tool_use_id)) {
        ids.delete((b as any).tool_use_id);
      }
    }
  }
  return ids.size === 0;
}

// Extract a compact snapshot of what the agent is actively working on, so the
// summarizer is forced to preserve it instead of possibly glossing over it.
function extractWorkingState(messages: ProviderMessage[], recent: ProviderMessage[]): string {
  const lines: string[] = [];

  // Current plan (most recent update_plan tool call).
  const plan = findLastToolInput(messages, "update_plan");
  if (plan && Array.isArray((plan as any).plan) && (plan as any).plan.length > 0) {
    lines.push("Current plan:");
    for (const step of (plan as any).plan) {
      lines.push(`  - [${(step as any).status ?? "pending"}] ${(step as any).step ?? ""}`);
    }
  }

  // Last error from a tool result.
  const lastErr = findLastToolError(recent.concat(messages));
  if (lastErr) {
    lines.push(`Last error observed:\n  ${lastErr.slice(0, 500)}`);
  }

  // Recently touched file paths (deduped, last 10).
  const files = findRecentFilePaths(recent.concat(messages), 10);
  if (files.length > 0) {
    lines.push(`Recently touched files: ${files.join(", ")}`);
  }

  return lines.join("\n");
}

function findLastToolInput(messages: ProviderMessage[], toolName: string): Record<string, unknown> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (typeof b === "object" && b !== null && (b as any).type === "tool_use" && (b as any).name === toolName) {
        return (b as any).input as Record<string, unknown>;
      }
    }
  }
  return undefined;
}

function findLastToolError(messages: ProviderMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (typeof b === "object" && b !== null && (b as any).type === "tool_result" && (b as any).is_error) {
        return String((b as any).content ?? "");
      }
    }
  }
  return undefined;
}

function findRecentFilePaths(messages: ProviderMessage[], limit: number): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const fileTools = new Set(["read", "write", "edit", "apply_patch"]);
  for (let i = messages.length - 1; i >= 0 && paths.length < limit; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (typeof b === "object" && b !== null && (b as any).type === "tool_use" && fileTools.has((b as any).name)) {
        const p = (b as any).input?.path ?? (b as any).input?.file_path;
        if (typeof p === "string" && !seen.has(p)) {
          seen.add(p);
          paths.push(p);
        }
      }
    }
  }
  return paths;
}

export async function runAgent(
  userPrompt: string,
  opts: AgentOptions,
): Promise<string> {
  const cfg = await import("./config.js");
  const config = await cfg.resolveConfig();
  const emit = opts.onEvent ?? (() => { });
  const signal = opts.signal;

  const providerName = opts.providerName ?? config.provider;
  const provider = opts.provider ?? createProvider({ ...config, provider: providerName });

  // Check if already aborted
  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  setToolEventEmitter(emit as any);
  const skills =
    opts.skills ?? (await discoverSkills(opts.skillsExtraRoots ?? []));
  if (skills.length > 0) {
    emit({
      type: "skills_loaded",
      count: skills.length,
      names: skills.map((s) => s.name),
    });
  }

  const skillsBlock = buildSkillsPrompt(skills);
  const basePrompt = opts.isSubagent ? SUBAGENT_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
  const system = skillsBlock
    ? `${basePrompt}\n\n${skillsBlock}`
    : basePrompt;

  const maxTokensDefault = Number(process.env.JOY_MAX_TOKENS) || 16_384;

  let messages: ProviderMessage[] = opts.initialMessages ? [...opts.initialMessages] : [];

  // Add the new user prompt if it's not empty
  if (userPrompt.trim()) {
    messages.push({ role: "user", content: userPrompt });
  }

  // If no messages at all (edge case), add a placeholder
  if (messages.length === 0) {
    messages.push({ role: "user", content: "Hello" });
  }

  let lastAssistantText = "";
  const maxIters = opts.maxIterations ?? 25;
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  // Set right after a compaction so that, on the next turn, cumulativeInput is
  // re-baselined from that turn's REAL reported input tokens (which already
  // include the compacted summary + current messages) instead of carrying over
  // the stale pre-compaction count.
  let justCompacted = false;

  for (let i = 1; i <= maxIters; i++) {
    const turnStart = Date.now();
    let toolsThisTurn = 0;

    emit({ type: "iteration", n: i });

    // Check for abort before each API call
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    const rawResp = await provider.createMessage({
      model: opts.model,
      maxTokens: opts.maxTokens ?? maxTokensDefault,
      system,
      tools,
      messages,
      signal,
    });
    const { response: resp, diagnostics } = normalizeProviderResponse(rawResp);
    if (diagnostics.length > 0) {
      emit({ type: "provider_response_repaired", diagnostics });
    }

    // Check abort after API call returns
    if (signal?.aborted) {
      throw new Error("Aborted");
    }


    const inT = resp.usage.inputTokens;
    const outT = resp.usage.outputTokens;
    if (justCompacted) {
      // The previous turn compacted history. This turn's reported input tokens
      // already reflect the FULL post-compaction context (summary + system +
      // tools + current messages), so it is the accurate size — use it directly
      // as the new cumulative baseline instead of carrying over the stale
      // pre-compaction count, which was far too high and would re-trigger
      // compaction at once.
      cumulativeInput = inT;
      justCompacted = false;
    } else {
      cumulativeInput += inT;
    }
    cumulativeOutput += outT;
    emit({
      type: "usage",
      inputTokens: inT,
      outputTokens: outT,
      cumulativeInput,
      cumulativeOutput,
    });

    // Auto-compress when approaching context limit (default: 180K tokens)
    const compactThreshold = Number(process.env.JOY_COMPACT_THRESHOLD) || 180_000;
    if (cumulativeInput > compactThreshold && opts.onCompact) {
      const compressed = await compressConversation(
        provider,
        opts.model,
        messages,
        system,
        cumulativeInput,
      );
      if (compressed) {
        const { summary, recent, tokensSaved } = compressed;
        emit({ type: "compact", summary, savedTokens: tokensSaved });
        // Wrap the summary as a single user message (UI layer controls format),
        // then append the verbatim recent window so the agent keeps its
        // immediate working context (file just read, tool result in progress).
        const summaryMessages = opts.onCompact(summary, tokensSaved);
        messages = [...summaryMessages, ...recent];
        cumulativeInput = 0;
        cumulativeOutput = 0;
        justCompacted = true;
      }
      // If compressed === null, compaction failed (or produced an empty
      // summary): skip it and keep working with the original history. The
      // cumulative counters stay as-is so we may retry compaction later, once
      // budget allows.
    }

    messages.push({ role: "assistant", content: resp.content });

    const reason = resp.stopReason;
    const returnedToolIds = new Set<string>();

    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) {
        lastAssistantText = block.text;
        emit({
          type: "assistant_text",
          text: block.text,
          isThinking: reason === "tool_use",
        });
      } else if (block.type === "tool_use") {
        toolsThisTurn++;
        returnedToolIds.add(block.id);
        emit({
          type: "tool_call",
          name: block.name,
          input: block.input,
          id: block.id,
        });
      }
    }

    emit({ type: "stop", reason });

    if (reason === "max_tokens") {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text:
              "The previous response was truncated because it hit the max_tokens limit. " +
              "Some tool calls may have been cut off. Do NOT retry the exact same tool call — " +
              "instead, complete your thought more concisely or break the work into smaller steps. " +
              "If you were writing a large file, use 'write' with only the meaningful content needed.",
          },
        ],
      });
      continue;
    }

    if (reason !== "tool_use") {
      emit({
        type: "turnEnd",
        n: i,
        // Also return the full messages array so the caller can continue the conversation
        // We add this as an extra field to the event for the TUI to pick up
        // (Note: we can't modify the AgentEvent type for backward compatibility, but we can
        // include it as an extra property for the TUI)
        ...({ _fullMessages: messages } as any),
        tools: toolsThisTurn,
        durationMs: Date.now() - turnStart,
        tokIn: cumulativeInput,
        tokOut: cumulativeOutput,
      });
      return lastAssistantText;
    }

    const toolUses = resp.content.filter(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );

    const results: ProviderToolResultBlock[] = [];
    for (const tu of toolUses) {
      // Check abort before running each tool
      if (signal?.aborted) {
        throw new Error("Aborted");
      }


      const toolInput =
        tu.input && typeof tu.input === "object" && !Array.isArray(tu.input)
          ? (tu.input as Record<string, unknown>)
          : {};
      const { content, is_error } = await runTool(
        tu.name,
        toolInput,
      );
      emit({ type: "tool_result", id: tu.id, output: content, is_error });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content,
        is_error,
      });
      if (tu.name === "update_plan") {
        emit({
          type: "plan_update",
          plan: Array.isArray(toolInput.plan) ? toolInput.plan : [],
          explanation: typeof toolInput.explanation === "string" ? toolInput.explanation : undefined,
          id: tu.id,
        });
      }
    }

    messages.push({ role: "user", content: results });

    emit({
      type: "turnEnd",
      n: i,
      // Also return the full messages array
      ...({ _fullMessages: messages } as any),
      tools: toolsThisTurn,
      durationMs: Date.now() - turnStart,
      tokIn: cumulativeInput,
      tokOut: cumulativeOutput,
    });
  }

  emit({ type: "stop", reason: "max_iterations" });
  return lastAssistantText;
}
