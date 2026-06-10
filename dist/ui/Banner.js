import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
export default function Banner({ model, skillCount, cwd }) {
    return (_jsx(Box, { flexDirection: "column", children: _jsxs(Box, { children: [_jsx(Text, { bold: true, children: "joy" }), _jsxs(Text, { color: "gray", children: [" \u2014 ", model] }), _jsxs(Text, { color: "gray", children: [" \u00B7 ", skillCount, " skills"] }), _jsxs(Text, { color: "gray", children: [" \u00B7 ", shrinkPath(cwd)] })] }) }));
}
function shrinkPath(p) {
    const home = process.env.HOME || "";
    if (home && p.startsWith(home))
        return "~" + p.slice(home.length);
    return p;
}
