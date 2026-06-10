import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { getTheme } from "./theme/theme.js";
function shrink(p) {
    const home = process.env.HOME || "";
    if (home && p.startsWith(home))
        return "~" + p.slice(home.length);
    if (p.length > 36)
        return "..." + p.slice(-33);
    return p;
}
function fmtTokens(n) {
    if (n >= 1000)
        return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
}
export default function Footer({ cwd, branch, model, skillsCount, thinking, tokensIn, tokensOut, contextMax = 200_000, }) {
    const theme = getTheme();
    const total = tokensIn + tokensOut;
    const pct = contextMax > 0 ? Math.min(100, (total / contextMax) * 100) : 0;
    const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    return (_jsxs(Box, { marginTop: 1, children: [_jsx(Box, { marginRight: 1, children: thinking ? (_jsx(_Fragment, { children: _jsx(Text, { color: theme.fgMuted, bold: true, children: "thinking " }) })) : (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.fgMuted, children: "o" }), _jsx(Text, { color: theme.fgMuted, bold: true, children: " ready " })] })) }), _jsx(Segment, { color: theme.fgMuted, children: shrink(cwd) }), branch && _jsx(Segment, { color: theme.fgMuted, children: `⎇ ${branch}` }), _jsx(Segment, { color: theme.fgMuted, children: model }), _jsx(Segment, { color: theme.fgMuted, children: `skills ${skillsCount}` }), _jsx(Segment, { color: theme.fgMuted, children: `↑${fmtTokens(tokensIn)} ↓${fmtTokens(tokensOut)} (${pctStr}%)` })] }));
}
function Segment({ children, color }) {
    return (_jsxs(Box, { marginRight: 1, children: [_jsx(Text, { color: "gray", children: "\u2502 " }), _jsx(Text, { color: color, children: children })] }));
}
