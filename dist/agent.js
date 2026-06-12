import { tools, runTool, setSubagentRunner, setToolEventEmitter } from "./tools.js";
import { discoverSkills, buildSkillsPrompt } from "./skills.js";
import { createProvider } from "./providers/index.js";
import { normalizeProviderResponse } from "./providers/normalize.js";
const BASE_SYSTEM_PROMPT = `You are Joy, a terminal coding agent.
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
writing/editing files, applying unified diff patches, running bash commands, and
planning. Use list_files, glob, and grep for code discovery. Focus ONLY on the task you were given. Do not spawn
additional sub-agents.

When you finish, provide a clear summary of what you did: files changed, key
decisions, and any issues encountered. Be concise.`;
const COMPACT_SUMMARY_PROMPT = `Provide a detailed summary of the conversation so far. Include:
1. The user's original request and goal
2. Key decisions made and why
3. Files examined, modified, or created (with paths)
4. Current progress and what remains to be done
5. Any errors encountered and how they were resolved
6. Important technical context (versions, configurations, etc.)

Be thorough but concise. This summary will replace the full conversation history
to save context space. The agent will continue working from this summary.`;
export function collectSubagentText(events) {
    const parts = events
        .filter((e) => e.type === "assistant_text" && !e.isThinking && e.text.trim().length > 0)
        .map((e) => e.text);
    return parts.length > 0 ? parts.join("\n\n") : "(sub-agent completed with no output)";
}
// Wire up the sub-agent runner (called once at startup)
setSubagentRunner(async (prompt, opts) => {
    // Sub-agents don't emit events to the main UI; we capture the result
    const events = [];
    await runAgent(prompt, {
        ...opts,
        onEvent: (e) => {
            events.push(e);
        },
    });
    return collectSubagentText(events);
});
async function compressConversation(provider, model, messages, system) {
    // Estimate tokens before compression (rough: ~4 chars per token)
    const totalChars = messages.reduce((sum, m) => sum + JSON.stringify(m.content).length, 0);
    const estimatedTokens = Math.round(totalChars / 4);
    const resp = await provider.createMessage({
        model,
        maxTokens: 4096,
        system: `${system}\n\n${COMPACT_SUMMARY_PROMPT}`,
        tools: [],
        messages,
    });
    const summary = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    const tokensSaved = estimatedTokens - Math.round(summary.length / 4);
    return { summary, tokensSaved: Math.max(0, tokensSaved) };
}
export async function runAgent(userPrompt, opts) {
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
    setToolEventEmitter(emit);
    const skills = opts.skills ?? (await discoverSkills(opts.skillsExtraRoots ?? []));
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
    let messages = opts.initialMessages ? [...opts.initialMessages] : [];
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
        cumulativeInput += inT;
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
            const { summary, tokensSaved } = await compressConversation(provider, opts.model, messages, system);
            emit({ type: "compact", summary, savedTokens: tokensSaved });
            messages = opts.onCompact(summary, tokensSaved);
            cumulativeInput = Math.round(summary.length / 4);
            cumulativeOutput = 0;
        }
        messages.push({ role: "assistant", content: resp.content });
        const reason = resp.stopReason;
        const returnedToolIds = new Set();
        for (const block of resp.content) {
            if (block.type === "text" && block.text.trim()) {
                lastAssistantText = block.text;
                emit({
                    type: "assistant_text",
                    text: block.text,
                    isThinking: reason === "tool_use",
                });
            }
            else if (block.type === "tool_use") {
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
                        text: "The previous response was truncated because it hit the max_tokens limit. " +
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
                ...{ _fullMessages: messages },
                tools: toolsThisTurn,
                durationMs: Date.now() - turnStart,
                tokIn: cumulativeInput,
                tokOut: cumulativeOutput,
            });
            return lastAssistantText;
        }
        const toolUses = resp.content.filter((b) => b.type === "tool_use");
        const results = [];
        for (const tu of toolUses) {
            // Check abort before running each tool
            if (signal?.aborted) {
                throw new Error("Aborted");
            }
            const toolInput = tu.input && typeof tu.input === "object" && !Array.isArray(tu.input)
                ? tu.input
                : {};
            const { content, is_error } = await runTool(tu.name, toolInput);
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
            ...{ _fullMessages: messages },
            tools: toolsThisTurn,
            durationMs: Date.now() - turnStart,
            tokIn: cumulativeInput,
            tokOut: cumulativeOutput,
        });
    }
    emit({ type: "stop", reason: "max_iterations" });
    return lastAssistantText;
}
