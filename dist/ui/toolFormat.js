export function describeToolCall(name, input) {
    const obj = coerce(input);
    switch (name) {
        case "bash": {
            const cmd = String(obj?.command ?? "");
            const timeout = obj?.timeout_ms;
            const detail = timeout && timeout !== 120_000 ? `timeout ${timeout}ms` : undefined;
            if (cmd)
                return { headline: `$ ${cmd}`, detail, outputPanel: "stdout" };
            break;
        }
        case "read": {
            const path = String(obj?.path ?? "");
            const max = obj?.max_bytes;
            const detail = max ? `max ${max}b` : undefined;
            if (path)
                return { headline: `📖 ${path}`, detail, outputPanel: "content" };
            break;
        }
        case "write": {
            const path = String(obj?.path ?? "");
            const content = String(obj?.content ?? "");
            const detail = content ? `${content.length} chars` : undefined;
            if (path)
                return { headline: `📝 ${path}`, detail };
            break;
        }
        case "edit": {
            const path = String(obj?.path ?? "");
            const replaceAll = obj?.replace_all ? " (all)" : "";
            if (path)
                return { headline: `✏️  ${path}${replaceAll}`, outputPanel: "content" };
            break;
        }
    }
    // Fallback: pretty-print the JSON compactly
    return {
        headline: name,
        rawJson: safeJson(obj ?? input),
    };
}
function coerce(input) {
    if (!input)
        return undefined;
    if (typeof input === "string") {
        try {
            return JSON.parse(input);
        }
        catch {
            return undefined;
        }
    }
    if (typeof input === "object") {
        // Anthropic SDK may give us { raw_arguments: "<json string>" } if it couldn't parse
        const raw = input.raw_arguments;
        if (typeof raw === "string") {
            try {
                return JSON.parse(raw);
            }
            catch { /* leave as-is */ }
        }
        return input;
    }
    return undefined;
}
function safeJson(v) {
    try {
        const s = JSON.stringify(v);
        return s.length > 200 ? s.slice(0, 200) + "…" : s;
    }
    catch {
        return String(v);
    }
}
export function parseBashOutput(out) {
    const m = out.match(/^\[(?:exit (\d+)|killed after (\d+)ms)\]\n?/);
    if (!m)
        return { body: out };
    const exit = m[1] !== undefined ? Number(m[1]) : undefined;
    const killed = m[2] !== undefined;
    return { exit, killed, body: out.slice(m[0].length) };
}
export function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const s = ms / 1000;
    if (s < 10)
        return `${s.toFixed(1)}s`;
    if (s < 60)
        return `${Math.round(s)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s - m * 60);
    return `${m}m${rem}s`;
}
