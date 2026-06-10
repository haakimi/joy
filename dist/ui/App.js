import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SlashPicker from "./SlashPicker.js";
import { LogView } from "./LogView.js";
import { getTheme } from "./theme/theme.js";
import { useGitBranch } from "./hooks/useGitBranch.js";
import { runAgent } from "../agent.js";
import { SLASH_COMMANDS, findCommand, matchCommands, } from "../commands.js";
let nextId = 0;
const mkId = () => `i${++nextId}`;
const makeBanner = (model, skillCount, cwd) => ({
    kind: "banner",
    model,
    skillCount,
    cwd,
    id: mkId(),
});
export default function App({ initialModel, skills }) {
    const { exit } = useApp();
    const [model, setModel] = useState(initialModel);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [items, setItems] = useState(() => [
        makeBanner(initialModel, skills.length, process.cwd()),
    ]);
    const [pickerIdx, setPickerIdx] = useState(0);
    const [cwd, setCwd] = useState(process.cwd());
    const [tokIn, setTokIn] = useState(0);
    const [tokOut, setTokOut] = useState(0);
    const branch = useGitBranch(cwd);
    const theme = getTheme();
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
    const handleKey = (_input, key) => {
        if (busy)
            return false;
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
        if (key.tab) {
            const pick = matches[pickerIdx] ?? matches[0];
            if (pick)
                setInput("/" + pick.name + " ");
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
        await runTurn(line);
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
            const banner = makeBanner(model, skills.length, process.cwd());
            itemsRef.current = [banner];
            setItems(itemsRef.current);
            setTokIn(0);
            setTokOut(0);
            return;
        }
        if (cmd.name === "exit" || cmd.name === "quit") {
            exit();
            return;
        }
        const beforeCwd = process.cwd();
        const ctx = {
            args,
            raw: args.join(" "),
            cwd: beforeCwd,
            model,
            printLine: (msg) => append({ kind: "info", text: stripAnsi(msg) }),
        };
        let result;
        try {
            result = await cmd.run(ctx);
        }
        catch (err) {
            append({ kind: "error", text: err?.message ?? String(err) });
            return;
        }
        if (process.env.JOY_MODEL && process.env.JOY_MODEL !== model) {
            setModel(process.env.JOY_MODEL);
        }
        if (process.cwd() !== beforeCwd)
            setCwd(process.cwd());
        if (result?.prompt)
            await runTurn(result.prompt);
    }
    async function runTurn(prompt) {
        // Handle compact requests: the agent's response will be the summary
        const isCompactRequest = prompt.startsWith("[COMPACT]");
        if (isCompactRequest) {
            compactRef.current = true;
        }
        append({ kind: "user", text: prompt, ts: Date.now() });
        setBusy(true);
        const pendingToolIds = new Map();
        try {
            await runAgent(prompt, {
                model,
                skills,
                onEvent: (e) => {
                    switch (e.type) {
                        case "iteration":
                            append({ kind: "turn", n: e.n, model, ts: Date.now() });
                            break;
                        case "skills_loaded":
                            break;
                        case "assistant_text":
                            if (!e.isThinking)
                                completeLatestPlan();
                            if (compactRef.current) {
                                // The agent's response to [COMPACT] is the summary
                                compactRef.current = false;
                                append({
                                    kind: "compact",
                                    summary: e.text,
                                    savedTokens: 0, // Will be estimated
                                    id: mkId(),
                                });
                            }
                            else {
                                append({
                                    kind: "assistant",
                                    text: e.text,
                                    isThinking: e.isThinking ?? false,
                                });
                            }
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
                            const id = pendingToolIds.get(e.id);
                            if (id) {
                                updateTool(id, {
                                    pending: false,
                                    output: e.output,
                                    isError: e.is_error,
                                    finishedAt: Date.now(),
                                });
                                pendingToolIds.delete(e.id);
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
                    return [
                        {
                            role: "user",
                            content: `[CONVERSATION HISTORY SUMMARY]\n\n${summary}\n\n---\nThe conversation above has been compressed. Continue working based on this summary.`,
                        },
                    ];
                },
            });
        }
        catch (err) {
            append({ kind: "error", text: err?.message ?? String(err) });
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(LogView, { items: items }), slashMode && matches.length > 0 && (_jsx(Box, { children: _jsx(SlashPicker, { matches: matches, selected: pickerIdx }) })), _jsxs(Box, { flexDirection: "row", marginTop: 1, children: [_jsx(Box, { marginRight: 1, children: _jsx(Text, { color: busy ? theme.fgMuted : theme.fg, bold: true, children: "|" }) }), _jsx(Box, { flexGrow: 1, children: _jsxs(Text, { color: busy ? theme.fgMuted : theme.fg, children: [input, !busy && _jsx(Text, { color: theme.fgMuted, children: "|" })] }) })] }), _jsx(Box, { children: _jsxs(Text, { color: theme.fgFaint, children: [shrinkPath(cwd), branch ? ` ⎇ ${branch}` : "", " · ", model, busy ? " · thinking" : "", tokIn > 0 ? ` · ↑${fmtTok(tokIn)} ↓${fmtTok(tokOut)}` : ""] }) })] }));
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
