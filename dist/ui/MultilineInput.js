import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
export default function MultilineInput({ value, onChange, onSubmit, disabled, placeholder, onKey, }) {
    const [cursor, setCursor] = useState(value.length);
    useInput((input, key) => {
        if (disabled)
            return;
        if (onKey?.(input, key))
            return;
        if (key.return) {
            if (value.endsWith("\\")) {
                // Trailing backslash: new line
                const next = value.slice(0, -1) + "\n";
                onChange(next);
                setCursor(next.length);
            }
            else {
                // No backslash: submit
                onSubmit(value);
            }
            return;
        }
        if (key.leftArrow) {
            if (cursor > 0)
                setCursor(cursor - 1);
            return;
        }
        if (key.rightArrow) {
            if (cursor < value.length)
                setCursor(cursor + 1);
            return;
        }
        if (key.backspace || key.delete) {
            if (cursor === 0)
                return;
            const next = value.slice(0, cursor - 1) + value.slice(cursor);
            onChange(next);
            setCursor(cursor - 1);
            return;
        }
        if (input && !key.ctrl && !key.meta) {
            const next = value.slice(0, cursor) + input + value.slice(cursor);
            onChange(next);
            setCursor(cursor + input.length);
        }
    }, { isActive: !disabled });
    const showPlaceholder = value.length === 0;
    const display = showPlaceholder ? placeholder ?? "" : value;
    return (_jsx(Box, { flexDirection: "column", children: _jsx(Box, { children: _jsxs(Text, { color: showPlaceholder ? "gray" : "white", children: [display.slice(0, cursor), _jsx(Text, { inverse: true, children: cursor < display.length ? display[cursor] : " " }), display.slice(cursor + 1)] }) }) }));
}
