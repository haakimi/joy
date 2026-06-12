/**
 * Convert a raw tool_use input (parsed JSON or raw_arguments string) into
 * a human-friendly summary line. The goal is to surface the *meaningful*
 * argument (command, path) as a first-class string, not a JSON dump.
 */
export interface ToolDisplay {
  headline: string;          // short one-liner: "$ ls -la"  or  "📄 src/foo.ts"
  detail?: string;           // optional extra info shown subtly
  rawJson?: string;          // fallback dump if we can't make sense of it
  outputPanel?: "stdout" | "stderr" | "content";
}

export function describeToolCall(
  name: string,
  input: unknown,
): ToolDisplay {
  const obj = coerce(input);

  switch (name) {
    case "bash": {
      const cmd = String(obj?.command ?? "");
      const timeout = obj?.timeout_ms;
      const detail = timeout && timeout !== 120_000 ? `timeout ${timeout}ms` : undefined;
      if (cmd) return { headline: `$ ${cmd}`, detail, outputPanel: "stdout" };
      break;
    }
    case "read": {
      const path = String(obj?.path ?? "");
      const max = obj?.max_bytes;
      const detail = max ? `max ${max}b` : undefined;
      if (path) return { headline: `📖 ${path}`, detail, outputPanel: "content" };
      break;
    }
    case "list_files": {
      const target = String(obj?.path ?? ".");
      const detail = [obj?.recursive ? "recursive" : undefined, obj?.max_entries ? `max ${obj.max_entries}` : undefined]
        .filter(Boolean)
        .join(" · ") || undefined;
      return { headline: `📁 ${target}`, detail, outputPanel: "content" };
    }
    case "glob": {
      const pattern = String(obj?.pattern ?? "");
      const detail = [obj?.path ? `in ${obj.path}` : undefined, obj?.max_matches ? `max ${obj.max_matches}` : undefined]
        .filter(Boolean)
        .join(" · ") || undefined;
      if (pattern) return { headline: `🔎 ${pattern}`, detail, outputPanel: "content" };
      break;
    }
    case "grep": {
      const pattern = String(obj?.pattern ?? "");
      const detail = [obj?.path ? `in ${obj.path}` : undefined, obj?.include ? `include ${obj.include}` : undefined]
        .filter(Boolean)
        .join(" · ") || undefined;
      if (pattern) return { headline: `grep /${pattern}/`, detail, outputPanel: "content" };
      break;
    }
    case "write": {
      const path = String(obj?.path ?? "");
      const content = String(obj?.content ?? "");
      const detail = content ? `${content.length} chars` : undefined;
      if (path) return { headline: `📝 ${path}`, detail };
      break;
    }
    case "edit": {
      const path = String(obj?.path ?? "");
      const replaceAll = obj?.replace_all ? " (all)" : "";
      if (path) return { headline: `✏️  ${path}${replaceAll}`, outputPanel: "content" };
      break;
    }
  }

  // Fallback: pretty-print the JSON compactly
  return {
    headline: name,
    rawJson: safeJson(obj ?? input),
  };
}

function coerce(input: unknown): any {
  if (!input) return undefined;
  if (typeof input === "string") {
    try { return JSON.parse(input); } catch { return undefined; }
  }
  if (typeof input === "object") {
    // Anthropic SDK may give us { raw_arguments: "<json string>" } if it couldn't parse
    const raw = (input as any).raw_arguments;
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { /* leave as-is */ }
    }
    return input;
  }
  return undefined;
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return String(v);
  }
}

/**
 * Split a tool output (combined stdout+stderr) for nicer rendering.
 * Our bash runner prefixes with "[exit N]\n" — we extract that for the badge.
 */
export interface ParsedOutput {
  exit?: number;
  killed?: boolean;
  body: string;
}

export function parseBashOutput(out: string): ParsedOutput {
  const m = out.match(/^\[(?:exit (\d+)|killed after (\d+)ms)\]\n?/);
  if (!m) return { body: out };
  const exit = m[1] !== undefined ? Number(m[1]) : undefined;
  const killed = m[2] !== undefined;
  return { exit, killed, body: out.slice(m[0].length) };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem}s`;
}
