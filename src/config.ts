import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ResolvedConfig {
  authToken?: string;
  baseURL?: string;
  model?: string;
  skillRoots: string[];
  source: string[];
}

const CANDIDATE_FILES = [
  "~/.joy-agent/config.json",
  "~/.claude/settings.json",
  "~/.claude/.credentials.json",
  "~/.config/claude/settings.json",
  "~/Library/Application Support/Claude/settings.json",
  "~/Library/Application Support/cici-switch/config.json",
  "~/Library/Application Support/CiciSwitch/config.json",
  "~/.cici-switch/config.json",
];

function expand(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function pickToken(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return;
  const env = obj.env ?? obj.environment ?? {};
  return (
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_API_KEY ||
    obj.ANTHROPIC_AUTH_TOKEN ||
    obj.ANTHROPIC_API_KEY ||
    obj.auth_token ||
    obj.authToken ||
    obj.api_key ||
    obj.apiKey ||
    obj.token ||
    undefined
  );
}

function pickBaseURL(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return;
  const env = obj.env ?? obj.environment ?? {};
  return (
    env.ANTHROPIC_BASE_URL ||
    obj.ANTHROPIC_BASE_URL ||
    obj.base_url ||
    obj.baseURL ||
    obj.baseUrl ||
    undefined
  );
}

function pickModel(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return;
  const env = obj.env ?? obj.environment ?? {};
  return (
    env.JOY_MODEL ||
    env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    obj.JOY_MODEL ||
    obj.model ||
    undefined
  );
}

function pickSkillRoots(obj: any): string[] {
  if (!obj || typeof obj !== "object") return [];
  const v =
    obj.skill_roots ??
    obj.skillRoots ??
    obj.skills_roots ??
    obj.skillsRoots ??
    obj.skills?.roots;
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    return v.split(/[:,\s]+/).filter(Boolean);
  }
  return [];
}

export async function resolveConfig(): Promise<ResolvedConfig> {
  const sources: string[] = [];
  let authToken: string | undefined;
  let baseURL: string | undefined;
  let model: string | undefined;
  const skillRoots: string[] = [];

  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) {
    authToken =
      process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
    sources.push("env");
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    baseURL = process.env.ANTHROPIC_BASE_URL;
    if (!sources.includes("env")) sources.push("env");
  }
  if (
    process.env.JOY_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  ) {
    model =
      process.env.JOY_MODEL ||
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    if (!sources.includes("env")) sources.push("env");
  }

  for (const raw of CANDIDATE_FILES) {
    const p = expand(raw);
    try {
      const text = await fs.readFile(p, "utf8");
      const json = JSON.parse(text);
      const t = pickToken(json);
      const b = pickBaseURL(json);
      const m = pickModel(json);
      const r = pickSkillRoots(json);
      if (t || b || m || r.length) sources.push(p);
      if (!authToken && t) authToken = t;
      if (!baseURL && b) baseURL = b;
      if (!model && m) model = m;
      for (const root of r) if (!skillRoots.includes(root)) skillRoots.push(root);
    } catch {
      // ignore missing / bad files
    }
  }

  return { authToken, baseURL, model, skillRoots, source: sources };
}

export async function writeUserConfig(cfg: {
  authToken?: string;
  baseURL?: string;
  model?: string;
  skillRoots?: string[];
}): Promise<string> {
  const dir = expand("~/.joy-agent");
  const file = path.join(dir, "config.json");
  await fs.mkdir(dir, { recursive: true });
  let existing: any = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}
  const merged = {
    ...existing,
    ...(cfg.authToken ? { ANTHROPIC_AUTH_TOKEN: cfg.authToken } : {}),
    ...(cfg.baseURL ? { ANTHROPIC_BASE_URL: cfg.baseURL } : {}),
    ...(cfg.model ? { JOY_MODEL: cfg.model } : {}),
    ...(cfg.skillRoots ? { skill_roots: cfg.skillRoots } : {}),
  };
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + "\n", {
    mode: 0o600,
  });
  return file;
}
