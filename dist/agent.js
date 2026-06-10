import Anthropic from "@anthropic-ai/sdk";
import { tools, runTool, setSubagentRunner, setToolEventEmitter } from "./tools.js";
import { discoverSkills, buildSkillsPrompt } from "./skills.js";
const BASE_SYSTEM_PROMPT = `You are Joy, a terminal coding agent.
You have seven tools: read, write, edit, bash, update_plan, spawn_agent, wait_agent.
Use them to inspect and modify the user's project. Prefer 'edit' over 'write'
for small changes. Read a file before editing it. When using 'bash', keep
commands short and non-interactive.

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
You have the same tools as the main agent: read, write, edit, bash, update_plan.
Focus ONLY on the task you were given. Do not spawn additional sub-agents.

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
// Wire up the sub-agent runner (called once at startup)
setSubagentRunner(async (prompt, opts) => {
    // Sub-agents don't emit events to the main UI; we capture the result
    let result = "";
    await runAgent(prompt, {
        ...opts,
        onEvent: (e) => {
            if (e.type === "assistant_text" && !e.isThinking) {
                result = e.text;
            }
        },
    });
    return result || "(sub-agent completed with no output)";
});
async function compressConversation(client, model, messages, system) {
    // Estimate tokens before compression (rough: ~4 chars per token)
    const totalChars = messages.reduce((sum, m) => sum + JSON.stringify(m.content).length, 0);
    const estimatedTokens = Math.round(totalChars / 4);
    const resp = await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages: [
            ...messages,
            { role: "user", content: COMPACT_SUMMARY_PROMPT },
        ],
    });
    const summary = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    // Estimate tokens saved (original minus summary)
    const summaryChars = summary.length;
    const summaryTokens = Math.round(summaryChars / 4);
    const tokensSaved = Math.max(0, estimatedTokens - summaryTokens);
    return { summary, tokensSaved };
}
export async function runAgent(userPrompt, opts) {
    const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
        baseURL: process.env.ANTHROPIC_BASE_URL,
    });
    const emit = opts.onEvent ?? (() => { });
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
    let messages = [
        { role: "user", content: userPrompt },
    ];
    let lastAssistantText = "";
    const maxIters = opts.maxIterations ?? 25;
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    for (let i = 1; i <= maxIters; i++) {
        const turnStart = Date.now();
        let toolsThisTurn = 0;
        emit({ type: "iteration", n: i });
        const resp = await client.messages.create({
            model: opts.model,
            max_tokens: opts.maxTokens ?? maxTokensDefault,
            system,
            tools,
            messages,
        });
        const usage = resp.usage ?? {};
        const inT = Number(usage.input_tokens ?? 0);
        const outT = Number(usage.output_tokens ?? 0);
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
            const { summary, tokensSaved } = await compressConversation(client, opts.model, messages, system);
            emit({ type: "compact", summary, savedTokens: tokensSaved });
            messages = opts.onCompact(summary, tokensSaved);
            cumulativeInput = Math.round(summary.length / 4);
            cumulativeOutput = 0;
        }
        messages.push({ role: "assistant", content: resp.content });
        const reason = resp.stop_reason ?? "end_turn";
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
            tools: toolsThisTurn,
            durationMs: Date.now() - turnStart,
            tokIn: cumulativeInput,
            tokOut: cumulativeOutput,
        });
    }
    emit({ type: "stop", reason: "max_iterations" });
    return lastAssistantText;
}
