import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
import { getTheme } from "./theme/theme.js";
import { describeToolCall, parseBashOutput, formatDuration, } from "./toolFormat.js";
const MAX_OUTPUT_LINES = 10;
const JOY_BANNER = [
    "      ██  ██████  ██    ██",
    "      ██ ██    ██  ██  ██ ",
    "      ██ ██    ██   ████  ",
    "██    ██ ██    ██    ██   ",
    " ██████   ██████     ██   ",
];
function clampLines(s, maxLines) {
    const lines = s.split("\n");
    if (lines.length <= maxLines) {
        return { body: s, hidden: 0, total: lines.length };
    }
    return {
        body: lines.slice(0, maxLines).join("\n"),
        hidden: lines.length - maxLines,
        total: lines.length,
    };
}
export const LogView = React.memo(function LogView({ items }) {
    const theme = getTheme();
    return (_jsx(Box, { flexDirection: "column", children: items.map((it) => (_jsx(LogRow, { item: it, theme: theme }, it.id))) }));
});
export function LogRow({ item, theme }) {
    switch (item.kind) {
        case "turn":
            return _jsx(TurnHeader, { n: item.n, model: item.model, ts: item.ts, theme: theme });
        case "turnEnd":
            return _jsx(TurnFooter, { item: item, theme: theme });
        case "skills":
            return null;
        case "user":
            return _jsx(Card, { label: "you", icon: "|", labelColor: theme.user, theme: theme, ts: item.ts, children: _jsx(MessageBody, { text: item.text, theme: theme }) });
        case "assistant":
            return (_jsx(Card, { label: item.isThinking ? "joy · thinking" : "joy", icon: item.isThinking ? "*" : ">", labelColor: theme.assistant, theme: theme, children: _jsx(MessageBody, { text: item.text, theme: theme, muted: item.isThinking }) }));
        case "tool":
            return _jsx(ToolRow, { item: item, theme: theme });
        case "info":
            return (_jsx(Box, { children: _jsxs(Text, { color: theme.fgMuted, children: ["  ", item.text] }) }));
        case "error":
            return (_jsx(Card, { label: "error", icon: "x", labelColor: theme.failure, theme: theme, children: _jsx(Text, { color: theme.fg, children: item.text }) }));
        case "stop":
            return null;
        case "plan":
            return _jsx(PlanRow, { item: item, theme: theme });
        case "compact":
            return _jsx(CompactRow, { item: item, theme: theme });
        case "subagent":
            return _jsx(SubagentRow, { item: item, theme: theme });
        case "banner":
            return _jsx(BannerRow, { item: item, theme: theme });
    }
}
function BannerRow({ item, theme }) {
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsx(Box, { flexDirection: "column", children: JOY_BANNER.map((line, index) => (_jsx(Text, { color: theme.accent, bold: true, children: line }, index))) }), _jsxs(Box, { children: [_jsx(Text, { color: theme.fgMuted, children: "joy" }), _jsxs(Text, { color: theme.fgMuted, children: [" \u00B7 ", item.model] }), _jsxs(Text, { color: theme.fgMuted, children: [" \u00B7 ", item.skillCount, " skills"] }), _jsxs(Text, { color: theme.fgMuted, children: [" \u00B7 ", shrinkCwd(item.cwd)] })] }), _jsx(Box, { children: _jsx(Text, { color: theme.fgFaint, children: "type / for commands \u00B7 enter to chat" }) })] }));
}
function MessageBody({ text, theme, muted = false, }) {
    if (muted) {
        return _jsx(Text, { color: theme.fgMuted, children: text });
    }
    return (_jsx(Box, { flexDirection: "column", children: text.split("\n").map((line, index) => (_jsx(Text, { color: theme.messageFg, backgroundColor: theme.messageBg, children: ` ${line || " "} ` }, index))) }));
}
function shrinkCwd(p) {
    const home = process.env.HOME || "";
    if (home && p.startsWith(home))
        return "~" + p.slice(home.length);
    return p;
}
function SubagentRow({ item, theme }) {
    const isRunning = item.status === "running";
    return (_jsx(Box, { flexDirection: "column", children: _jsx(Card, { label: isRunning ? "subagent" : "subagent done", icon: isRunning ? ">" : "v", labelColor: isRunning ? theme.accent : theme.success, theme: theme, children: _jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { marginBottom: 1, children: isRunning ? (_jsx(Box, { flexDirection: "row", children: _jsxs(Text, { color: theme.warn, children: ["running ", item.agentId] }) })) : (_jsxs(Text, { color: theme.success, children: ["done ", item.agentId] })) }), item.task && (_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: theme.fgMuted, children: ["Task: ", item.task] }) })), item.result && (_jsx(Box, { flexDirection: "column", paddingX: 1, children: item.result.split("\n").map((line, i) => (_jsx(Text, { color: theme.fgMuted, children: line || " " }, i))) }))] }) }) }));
}
function CompactRow({ item, theme }) {
    return (_jsx(Box, { flexDirection: "column", children: _jsx(Card, { label: "compact", icon: "-", labelColor: theme.warn, theme: theme, children: _jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { color: theme.success, children: ["Compressed context \u00B7 saved ~", Math.round(item.savedTokens / 1000), "K tokens"] }) }), _jsx(Box, { flexDirection: "column", paddingX: 1, children: item.summary.split("\n").map((line, i) => (_jsx(Text, { color: theme.fgMuted, children: line || " " }, i))) })] }) }) }));
}
function PlanRow({ item, theme }) {
    return (_jsx(Box, { flexDirection: "column", children: _jsxs(Card, { label: "plan", icon: "-", labelColor: theme.accent, theme: theme, children: [item.explanation && (_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: theme.fgMuted, children: item.explanation }) })), _jsx(Box, { flexDirection: "column", children: item.plan.map((step, index) => (_jsxs(Box, { marginTop: 1, flexDirection: "row", alignItems: "center", children: [_jsxs(Box, { width: 3, marginRight: 1, children: [step.status === "pending" && _jsx(Text, { color: theme.fgMuted, children: "o" }), step.status === "in_progress" && _jsx(Text, { color: theme.warn, children: ">" }), step.status === "completed" && _jsx(Text, { color: theme.success, children: "v" })] }), _jsx(Text, { color: step.status === "completed" ? theme.fgMuted : theme.fg, children: step.step }), step.status === "in_progress" && (_jsx(Box, { marginLeft: 1, children: _jsx(Text, { color: theme.warn, children: "(in progress)" }) }))] }, index))) })] }) }));
}
function TurnHeader({ n, model, ts, theme, }) {
    const time = ts ? new Date(ts) : new Date();
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    return (_jsxs(Box, { children: [_jsx(Text, { color: theme.fgMuted, children: "-- " }), _jsxs(Text, { color: theme.fgMuted, bold: true, children: ["turn ", n] }), model && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), _jsx(Text, { color: theme.fgMuted, children: model })] })), _jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), _jsxs(Text, { color: theme.fgFaint, children: [hh, ":", mm] }), _jsx(Text, { color: theme.fgMuted, children: " ---------" })] }));
}
function TurnFooter({ item, theme, }) {
    const dur = item.durationMs ? formatDuration(item.durationMs) : undefined;
    return (_jsxs(Box, { children: [_jsx(Text, { color: theme.fgMuted, children: "-- " }), _jsxs(Text, { color: theme.fgMuted, children: ["turn ", item.n, " done"] }), item.tools > 0 && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), _jsxs(Text, { color: theme.fgMuted, children: [item.tools, " tool", item.tools === 1 ? "" : "s"] })] })), dur && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), _jsx(Text, { color: theme.fgMuted, children: dur })] })), (item.tokIn || item.tokOut) && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), _jsxs(Text, { color: theme.fgMuted, children: ["\u2191", item.tokIn ?? 0, " \u2193", item.tokOut ?? 0] })] }))] }));
}
function Card({ label, icon, labelColor, theme, ts, children, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsxs(Text, { color: labelColor, bold: true, children: [icon, " ", label] }), ts && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgFaint, children: "  " }), _jsx(Text, { color: theme.fgFaint, children: tsLabel(ts) })] }))] }), _jsx(Box, { paddingLeft: 2, children: children })] }));
}
function tsLabel(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}
function ToolRow({ item, theme, }) {
    const display = describeToolCall(item.name, item.input);
    const isBash = item.name === "bash";
    const dur = !item.pending && item.finishedAt && item.startedAt
        ? formatDuration(item.finishedAt - item.startedAt)
        : undefined;
    let exitInfo;
    let bodyForRender = item.output ?? "";
    if (item.output !== undefined && isBash) {
        exitInfo = parseBashOutput(item.output);
        bodyForRender = exitInfo.body;
    }
    let badge;
    if (item.pending) {
        badge = (_jsx(Text, { color: theme.warn, bold: true, children: "running" }));
    }
    else if (item.isError) {
        const code = exitInfo?.exit !== undefined
            ? ` exit ${exitInfo.exit}`
            : exitInfo?.killed
                ? ` killed`
                : "";
        badge = (_jsxs(Text, { color: theme.failure, bold: true, children: ["failed", code] }));
    }
    else {
        const code = exitInfo?.exit === 0 ? "" : exitInfo?.exit !== undefined ? ` exit ${exitInfo.exit}` : "";
        badge = (_jsxs(Text, { color: theme.success, bold: true, children: ["done", code] }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsxs(Text, { color: theme.tool, bold: true, children: ["> ", item.name] }), dur && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), _jsx(Text, { color: theme.fgMuted, children: dur })] })), _jsx(Text, { color: theme.fgMuted, children: "  \u00B7  " }), badge] }), _jsxs(Box, { paddingLeft: 2, children: [display.headline ? (_jsx(Text, { color: theme.fg, children: display.headline })) : null, display.detail && (_jsxs(Text, { color: theme.fgFaint, children: ["  (", display.detail, ")"] })), display.rawJson && !display.headline && (_jsx(Text, { color: theme.fgMuted, children: display.rawJson }))] }), !item.pending && bodyForRender && bodyForRender.trim() && (_jsx(OutputPanel, { body: bodyForRender, isError: !!item.isError, theme: theme }))] }));
}
function OutputPanel({ body, isError, theme, }) {
    const { body: shown, hidden, total } = clampLines(body, MAX_OUTPUT_LINES);
    return (_jsxs(Box, { paddingLeft: 2, flexDirection: "column", children: [shown.split("\n").map((line, i) => (_jsx(Text, { color: isError ? theme.failure : theme.fgMuted, children: line || " " }, i))), hidden > 0 && (_jsxs(Text, { color: theme.fgFaint, children: ["- ", hidden, " more lines -"] }))] }));
}
