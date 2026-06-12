import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SlashPicker from "./SlashPicker.js";
import { LogView } from "./LogView.js";
import { getTheme } from "./theme/theme.js";
import { useGitBranch } from "./hooks/useGitBranch.js";
import { getTabAction, finishPendingTool, nextCwdAfterCommand, } from "./appState.js";
import { runAgent } from "../agent.js";
import { SLASH_COMMANDS, findCommand, matchCommands, } from "../commands.js";
let nextId = 0;
const mkId = () => `i${++nextId}`;
const makeBanner = (provider, model, skillCount, cwd) => ({
    kind: "banner",
    provider,
    model,
    skillCount,
    cwd,
    id: mkId(),
});
export default function App({ initialProvider, initialModel, skills }) {
    const { exit } = useApp();
    const [provider] = useState(initialProvider);
    const [model, setModel] = useState(initialModel);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [items, setItems] = useState(() => [
        makeBanner(initialProvider, initialModel, skills.length, process.cwd()),
    ]);
    const [pickerIdx, setPickerIdx] = useState(0);
    const [cwd, setCwd] = useState(process.cwd());
    const [tokIn, setTokIn] = useState(0);
    const [tokOut, setTokOut] = useState(0);
    const branch = useGitBranch(cwd);
    const theme = getTheme();
    // State to keep the conversation history
    const [messages, setMessages] = useState([]);
    // State to handle aborting the current agent run
    const abortControllerRef = useRef(null);
    // NEW: State to keep track of expanded items
    const [expandedItems, setExpandedItems] = useState(new Set());
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const compactRef = useRef(false);
    const append = (it) => {
        const item = "id" in it ? it : { ...it, id: mkId() };
        itemsRef.current = [...itemsRef.current, item];
        setItems(itemsRef.current);
    };
    const updateTool = (pendingId, patch) => {
        itemsRef.current = itemsRef.current.map((it) => it.id === pendingId && it.kind === "tool" ? { ...it, ...patch } : it);
        setItems(itemsRef.current);
    };
    const completeLatestPlan = () => {
        let changed = false;
        const next = [...itemsRef.current];
        for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i];
            if (item.kind !== "plan")
                continue;
            if (!item.plan.some((step) => step.status === "in_progress"))
                return;
            next[i] = {
                ...item,
                plan: item.plan.map((step) => step.status === "in_progress"
                    ? { ...step, status: "completed" }
                    : step),
            };
            changed = true;
            break;
        }
        if (changed) {
            itemsRef.current = next;
            setItems(next);
        }
    };
    const slashMode = input.startsWith("/") && !input.includes(" ") && !input.includes("\n");
    const slashPrefix = slashMode ? input.slice(1) : "";
    const matches = useMemo(() => (slashMode ? matchCommands(slashPrefix) : []), [slashMode, slashPrefix]);
    useEffect(() => {
        setPickerIdx(0);
    }, [matches.length, slashMode]);
    // NEW: Toggle expand/collapse for items
    const toggleExpand = (id) => {
        setExpandedItems((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            }
            else {
                next.add(id);
            }
            return next;
        });
    };
    useInput((char, key) => {
        if (handleKey(char, key))
            return;
        if (key.return) {
            handleSubmit(input);
        }
        else if (key.backspace) {
            if (input.length > 0) {
                setInput(input.slice(0, -1));
            }
        }
        else if (char) {
            setInput(input + char);
        }
    });
    // NEW: Add keyboard shortcuts for expand/collapse
    const handleKey = (_input, key) => {
        if (key.tab) {
            const lastTool = [...itemsRef.current].reverse().find((it) => it.kind === "tool");
            const action = getTabAction({
                slashMode,
                matches,
                pickerIdx,
                input,
                hasExpandableTool: Boolean(lastTool),
            });
            if (!action.handled)
                return false;
            if ("input" in action)
                setInput(action.input);
            else if (lastTool)
                toggleExpand(lastTool.id);
            return true;
        }
        if (!slashMode || matches.length === 0)
            return false;
        if (key.upArrow) {
            setPickerIdx((i) => (i - 1 + matches.length) % matches.length);
            return true;
        }
        if (key.downArrow) {
            setPickerIdx((i) => (i + 1) % matches.length);
            return true;
        }
        if (key.escape) {
            setInput("");
            return true;
        }
        return false;
    };
    const handleSubmit = async (raw) => {
        const line = raw.trim();
        setInput("");
        if (!line)
            return;
        if (line.startsWith("/")) {
            await handleSlash(line);
            return;
        }
        if (line.toLowerCase() === "exit" || line.toLowerCase() === "quit") {
            exit();
            return;
        }
        // If busy, abort the current run first
        if (busy && abortControllerRef.current) {
            append({ kind: "info", text: "⏹️ Interrupting current task..." });
            abortControllerRef.current.abort();
            // We'll continue with the new user input after the abort completes
            // We need to wait a bit for the current run to clean up
            setTimeout(() => {
                runTurn(line);
            }, 100);
        }
        else {
            await runTurn(line);
        }
    };
    async function handleSlash(line) {
        const body = line.slice(1).trim();
        if (!body) {
            showMenu(append);
            return;
        }
        const parts = body.split(/\s+/);
        const head = parts[0];
        const args = parts.slice(1);
        let cmd = findCommand(head);
        if (!cmd) {
            const ms = matchCommands(head);
            if (ms.length === 1)
                cmd = ms[0];
            else if (ms.length > 1)
                cmd = ms[pickerIdx] ?? ms[0];
        }
        if (!cmd) {
            append({ kind: "error", text: `unknown command: /${head}` });
            return;
        }
        if (cmd.name === "clear") {
            const banner = makeBanner(provider, model, skills.length, process.cwd());
            itemsRef.current = [banner];
            setItems(itemsRef.current);
            setTokIn(0);
            setTokOut(0);
            // Clear conversation history and expanded items
            setMessages([]);
            setExpandedItems(new Set());
            return;
        }
        if (cmd.name === "exit" || cmd.name === "quit") {
            exit();
            return;
        }
        if (cmd.name === "model") {
            if (args[0]) {
                setModel(args[0]);
                append({ kind: "info", text: `model set to ${args[0]}` });
            }
            else {
                append({ kind: "info", text: `current model: ${model}` });
            }
            return;
        }
        const printLine = (msg) => append({ kind: "info", text: stripAnsi(msg) });
        const beforeCwd = process.cwd();
        const result = await cmd.run({ args, raw: body, cwd, model, printLine });
        const afterCwd = process.cwd();
        if (afterCwd !== beforeCwd) {
            setCwd(nextCwdAfterCommand(cwd, afterCwd));
        }
        if (result.clear) {
            const banner = makeBanner(provider, model, skills.length, process.cwd());
            itemsRef.current = [banner];
            setItems(itemsRef.current);
        }
        if (result.exit) {
            exit();
        }
        if (result.prompt) {
            await runTurn(result.prompt);
        }
    }
    async function runTurn(userText) {
        append({ kind: "user", text: userText, id: mkId() });
        const pendingToolIds = new Map();
        setBusy(true);
        // Create a new abort controller for this run
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        try {
            await runAgent(userText, {
                providerName: provider,
                model,
                skills,
                signal: abortController.signal,
                // Pass the saved messages to continue the conversation
                initialMessages: messages,
                onEvent: (e) => {
                    switch (e.type) {
                        case "assistant_text":
                            append({
                                kind: "assistant",
                                text: e.text,
                                isThinking: e.isThinking ?? false,
                            });
                            break;
                        case "tool_call": {
                            const id = mkId();
                            pendingToolIds.set(e.id, id);
                            append({
                                kind: "tool",
                                id,
                                name: e.name,
                                input: e.input ?? {},
                                pending: true,
                                startedAt: Date.now(),
                            });
                            break;
                        }
                        case "tool_result": {
                            const id = finishPendingTool(pendingToolIds, e.id);
                            if (id) {
                                updateTool(id, {
                                    pending: false,
                                    output: e.output,
                                    isError: e.is_error,
                                    finishedAt: Date.now(),
                                });
                            }
                            break;
                        }
                        case "usage":
                            setTokIn(e.cumulativeInput);
                            setTokOut(e.cumulativeOutput);
                            break;
                        case "turnEnd":
                            append({
                                kind: "turnEnd",
                                n: e.n,
                                tools: e.tools,
                                durationMs: e.durationMs,
                                tokIn: e.tokIn,
                                tokOut: e.tokOut,
                            });
                            // Save the conversation history for next time
                            if (e._fullMessages) {
                                setMessages(e._fullMessages);
                            }
                            break;
                        case "stop":
                            if (e.reason === "max_tokens") {
                                for (const itemId of pendingToolIds.values()) {
                                    updateTool(itemId, {
                                        pending: false,
                                        isError: true,
                                        output: "tool call was truncated by max_tokens before it could be sent.",
                                    });
                                }
                                pendingToolIds.clear();
                            }
                            break;
                        case "plan_update":
                            append({
                                kind: "plan",
                                plan: e.plan,
                                explanation: e.explanation,
                                id: mkId(),
                            });
                            break;
                        case "compact":
                            append({
                                kind: "compact",
                                summary: e.summary,
                                savedTokens: e.savedTokens,
                                id: mkId(),
                            });
                            break;
                        case "subagent_spawned":
                            append({
                                kind: "subagent",
                                agentId: e.agentId,
                                task: e.task,
                                status: "running",
                                id: mkId(),
                            });
                            break;
                        case "subagent_result":
                            append({
                                kind: "subagent",
                                agentId: e.agentId,
                                task: "",
                                status: "done",
                                result: e.result,
                                id: mkId(),
                            });
                            break;
                    }
                },
                onCompact: (summary, _tokensSaved) => {
                    // Replace conversation history with the compressed summary
                    const newMessages = [
                        {
                            role: "user",
                            content: `[CONVERSATION HISTORY SUMMARY]\n\n${summary}\n\n---\nThe conversation above has been compressed. Continue working based on this summary.`,
                        },
                    ];
                    setMessages(newMessages);
                    return newMessages;
                },
            });
        }
        catch (err) {
            // If it's an abort, show a nicer message
            if (err?.message === "Aborted") {
                append({ kind: "info", text: "Task interrupted." });
            }
            else {
                append({ kind: "error", text: err?.message ?? String(err) });
            }
        }
        finally {
            setBusy(false);
            abortControllerRef.current = null;
        }
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(LogView, { items: items, expandedItems: expandedItems, onToggleExpand: toggleExpand }), slashMode && matches.length > 0 && (_jsx(Box, { children: _jsx(SlashPicker, { matches: matches, selected: pickerIdx }) })), _jsxs(Box, { flexDirection: "row", marginTop: 1, children: [_jsx(Box, { marginRight: 1, children: _jsx(Text, { color: busy ? theme.fg : theme.fg, bold: true, children: "|" }) }), _jsx(Box, { flexGrow: 1, children: _jsxs(Text, { color: busy ? theme.fg : theme.fg, children: [input, !busy && _jsx(Text, { color: theme.fgMuted, children: "|" })] }) })] }), _jsx(Box, { children: _jsxs(Text, { color: theme.fgFaint, children: [shrinkPath(cwd), branch ? ` ⎇ ${branch}` : "", " · ", provider, ":", model, busy ? " · [Press Enter to interrupt]" : " · [Tab to toggle expand]", tokIn > 0 ? ` · ↑${fmtTok(tokIn)} ↓${fmtTok(tokOut)}` : ""] }) })] }));
}
function showMenu(append) {
    append({ kind: "info", text: "Slash commands" });
    const w = Math.max(...SLASH_COMMANDS.map((c) => c.name.length));
    for (const c of SLASH_COMMANDS) {
        append({
            kind: "info",
            text: `  /${c.name.padEnd(w)}  ${c.description}`,
        });
    }
}
function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
function shrinkPath(p) {
    const home = process.env.HOME || "";
    if (home && p.startsWith(home))
        return "~" + p.slice(home.length);
    if (p.length > 40)
        return "…" + p.slice(-39);
    return p;
}
function fmtTok(n) {
    if (n >= 1000)
        return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
}
