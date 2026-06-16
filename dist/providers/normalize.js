const TOOL_NAME_ALIASES = {
    read_file: "read",
    shell: "bash",
    run_command: "bash",
    patch: "apply_patch",
    apply_diff: "apply_patch",
};
const INPUT_KEY_ALIASES = {
    filename: "path",
    file: "path",
    cmd: "command",
    patch_text: "patch",
    diff: "patch",
    regex: "pattern",
};
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function stableHash(value) {
    const input = stableStringify(value);
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
function normalizeToolName(name, diagnostics, toolId) {
    const raw = typeof name === "string" ? name.trim() : "";
    const normalized = TOOL_NAME_ALIASES[raw] ?? raw;
    if (raw && normalized !== raw) {
        diagnostics.push({ kind: "tool_name_alias", toolId, toolName: normalized, from: raw, to: normalized });
    }
    return normalized;
}
function parseToolInput(input, diagnostics, toolId, toolName) {
    if (typeof input === "string") {
        try {
            const parsed = JSON.parse(input);
            if (isPlainObject(parsed)) {
                diagnostics.push({ kind: "input_json_parsed", toolId, toolName });
                return parsed;
            }
        }
        catch (err) {
            diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: err?.message ?? String(err) });
            return {};
        }
        diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: "parsed JSON input was not an object" });
        return {};
    }
    if (isPlainObject(input)) {
        const raw = input.raw_arguments;
        if (typeof raw === "string") {
            try {
                const parsed = JSON.parse(raw);
                if (isPlainObject(parsed)) {
                    diagnostics.push({ kind: "raw_arguments_parsed", toolId, toolName });
                    return parsed;
                }
            }
            catch (err) {
                diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: err?.message ?? String(err) });
                return {};
            }
            diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: "parsed raw_arguments was not an object" });
            return {};
        }
        const args = input.arguments;
        if (typeof args === "string") {
            try {
                const parsed = JSON.parse(args);
                if (isPlainObject(parsed)) {
                    diagnostics.push({ kind: "arguments_parsed", toolId, toolName });
                    return parsed;
                }
            }
            catch (err) {
                diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: err?.message ?? String(err) });
                return {};
            }
            diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: "parsed arguments was not an object" });
            return {};
        }
        return { ...input };
    }
    if (input === undefined || input === null)
        return {};
    diagnostics.push({ kind: "tool_input_unparseable", toolId, toolName, message: "tool input was not an object" });
    return {};
}
function applyInputAliases(input, diagnostics, toolId, toolName) {
    const out = { ...input };
    for (const [from, to] of Object.entries(INPUT_KEY_ALIASES)) {
        if (from in out && !(to in out)) {
            out[to] = out[from];
            delete out[from];
            diagnostics.push({ kind: "input_key_alias", toolId, toolName, from, to });
        }
    }
    return out;
}
function generateToolUseId(index, name, input) {
    return `toolu_repaired_${index}_${stableHash({ name, input })}`;
}
export function normalizeProviderResponse(response) {
    const diagnostics = [...(response.diagnostics ?? [])];
    const content = [];
    response.content.forEach((block, index) => {
        if (block?.type === "text") {
            content.push({ type: "text", text: String(block.text ?? "") });
            return;
        }
        if (block?.type !== "tool_use")
            return;
        const initialId = typeof block.id === "string" && block.id.trim() ? block.id : undefined;
        const name = normalizeToolName(block.name, diagnostics, initialId);
        const input = applyInputAliases(parseToolInput(block.input, diagnostics, initialId, name), diagnostics, initialId, name);
        const id = initialId ?? generateToolUseId(index, name, input);
        if (!initialId) {
            diagnostics.push({ kind: "tool_id_generated", toolId: id, toolName: name });
        }
        content.push({ type: "tool_use", id, name, input });
    });
    let stopReason = response.stopReason;
    if (content.some((block) => block.type === "tool_use") && stopReason !== "tool_use") {
        diagnostics.push({ kind: "stop_reason_reconciled", from: String(stopReason), to: "tool_use" });
        stopReason = "tool_use";
    }
    const repaired = {
        ...response,
        content,
        stopReason,
    };
    if (diagnostics.length > 0)
        repaired.diagnostics = diagnostics;
    return {
        response: repaired,
        diagnostics,
    };
}
