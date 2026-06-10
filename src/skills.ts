import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";

export interface SkillMeta {
  name: string;
  description: string;
  path: string;          // absolute path to SKILL.md
  dir: string;           // skill root directory
  source: string;        // top-level skills dir this came from
  allowedTools?: string[];
  extra?: Record<string, unknown>;
}

export const DEFAULT_SKILL_ROOTS = [
  "~/.agents/skills",
  "~/.codex/skills",
  "~/.claude/skills",
  "~/.config/agents/skills",
];

function expand(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function parseFrontmatter(text: string): {
  data: Record<string, any>;
  body: string;
} {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const fmRaw = text.slice(3, end).replace(/^\r?\n/, "");
  let body = text.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  if (body.startsWith("\r\n")) body = body.slice(2);
  try {
    const data = (yaml.load(fmRaw) as Record<string, any>) || {};
    return { data, body };
  } catch {
    return { data: {}, body: text };
  }
}

async function* walkSkills(
  root: string,
  depth = 0,
): AsyncGenerator<string> {
  if (depth > 4) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && depth === 0) {
      // allow `.system` etc by descending one level
      if (ent.isDirectory()) {
        yield* walkSkills(path.join(root, ent.name), depth + 1);
      }
      continue;
    }
    const full = path.join(root, ent.name);
    if (ent.isFile() && ent.name === "SKILL.md") {
      yield full;
    } else if (ent.isDirectory()) {
      yield* walkSkills(full, depth + 1);
    }
  }
}

export async function discoverSkills(
  extraRoots: string[] = [],
): Promise<SkillMeta[]> {
  const roots = [...DEFAULT_SKILL_ROOTS, ...extraRoots].map(expand);
  const seen = new Set<string>();
  const out: SkillMeta[] = [];
  for (const root of roots) {
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    for await (const file of walkSkills(root)) {
      if (seen.has(file)) continue;
      seen.add(file);
      try {
        const text = await fs.readFile(file, "utf8");
        const { data } = parseFrontmatter(text);
        const dir = path.dirname(file);
        const name = String(
          data.name || path.basename(dir) || "skill",
        ).trim();
        const description = String(data.description || "").trim();
        if (!description) continue; // require description to be useful
        let allowed: string[] | undefined;
        if (Array.isArray(data["allowed-tools"])) {
          allowed = data["allowed-tools"].map(String);
        } else if (typeof data["allowed-tools"] === "string") {
          allowed = data["allowed-tools"]
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
        out.push({
          name,
          description,
          path: file,
          dir,
          source: root,
          allowedTools: allowed,
          extra: data,
        });
      } catch {
        // skip unreadable
      }
    }
  }
  // dedupe by name, prefer the first occurrence (root order matters)
  const byName = new Map<string, SkillMeta>();
  for (const s of out) if (!byName.has(s.name)) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSkillsPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) return "";
  const lines: string[] = [];
  lines.push("## Skills");
  lines.push(
    "A skill is a packaged set of local instructions stored in a SKILL.md file. " +
      "Below is the list of skills available in this session.",
  );
  lines.push("");
  lines.push("### Available skills");
  for (const s of skills) {
    const desc = s.description.replace(/\s+/g, " ").trim();
    lines.push(`- ${s.name}: ${desc} (file: ${s.path})`);
  }
  lines.push("");
  lines.push("### How to use skills");
  lines.push(
    "- Trigger: If the user names a skill (e.g. `$SkillName` or by plain text) " +
      "OR the task clearly matches a skill's description, you should use that skill for the turn.",
  );
  lines.push(
    "- Loading: Use the `read` tool to open the skill's SKILL.md file shown above before following its instructions.",
  );
  lines.push(
    "- Progressive disclosure: SKILL.md may reference relative paths like `scripts/`, `references/`, or `assets/`. " +
      "Resolve them relative to the skill directory, and load only the files you need.",
  );
  lines.push(
    "- If a skill defines `allowed-tools`, treat that as the preferred toolset for that skill.",
  );
  lines.push(
    "- If multiple skills apply, briefly state which ones you'll use and in what order.",
  );
  lines.push(
    "- If a named skill is missing or unreadable, say so briefly and continue with the best fallback.",
  );
  return lines.join("\n");
}
