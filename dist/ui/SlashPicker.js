import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { getTheme } from "./theme/theme.js";
export default function SlashPicker({ matches, selected }) {
    if (matches.length === 0)
        return null;
    const theme = getTheme();
    const w = Math.max(...matches.map((c) => c.name.length));
    const visible = matches.slice(0, 6);
    const overflow = matches.length - visible.length;
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: theme.borderIdle, paddingX: 1, children: [_jsxs(Box, { marginBottom: 0, children: [_jsx(Text, { color: theme.fg, bold: true, children: "  slash commands" }), _jsxs(Text, { color: theme.fgMuted, children: ["  (", matches.length, " match", matches.length === 1 ? "" : "es", ")"] })] }), visible.map((c, i) => {
                const active = i === selected;
                return (_jsxs(Box, { children: [_jsxs(Text, { color: active ? (theme.name === "dark" ? "black" : "white") : theme.fg, backgroundColor: active ? theme.fg : undefined, bold: active, children: [active ? " > " : "   ", "/", c.name.padEnd(w), " "] }), _jsxs(Text, { color: theme.fgMuted, children: [" ", c.description] })] }, c.name));
            }), overflow > 0 && (_jsxs(Text, { color: theme.fgMuted, children: ["   ", "... +", overflow, " more"] })), _jsxs(Box, { marginTop: 0, children: [_jsx(Text, { color: theme.fgMuted, children: "   ↑↓" }), _jsx(Text, { color: theme.fgMuted, children: " select " }), _jsx(Text, { color: theme.fgMuted, children: "\u00B7" }), _jsx(Text, { color: theme.fgMuted, children: " Tab" }), _jsx(Text, { color: theme.fgMuted, children: " complete " }), _jsx(Text, { color: theme.fgMuted, children: "\u00B7" }), _jsx(Text, { color: theme.fgMuted, children: " Enter" }), _jsx(Text, { color: theme.fgMuted, children: " run " }), _jsx(Text, { color: theme.fgMuted, children: "\u00B7" }), _jsx(Text, { color: theme.fgMuted, children: " Esc" }), _jsx(Text, { color: theme.fgMuted, children: " cancel" })] })] }));
}
