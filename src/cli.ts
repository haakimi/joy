#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import React from "react";
import { runAgent, type AgentEvent } from "./agent.js";
import { resolveConfig, writeUserConfig } from "./config.js";
import { discoverSkills, DEFAULT_SKILL_ROOTS } from "./skills.js";
import { startRepl } from "./repl.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function fmtInput(input: unknown): string {
  const s = JSON.stringify(input);
  if (!s) return "";
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

function fmtOutput(out: string): string {
  const lines = out.split("\n");
  const head = lines.slice(0, 20).join("\n");
  return lines.length > 20
    ? head + `\n${C.dim}... (${lines.length - 20} more lines)${C.reset}`
    : head;
}

function plainOnEvent(e: AgentEvent) {
  switch (e.type) {
    case "iteration":
      process.stdout.write(`${C.dim}── turn ${e.n} ──${C.reset}\n`);
      break;
    case "skills_loaded":
      process.stdout.write(
        `${C.dim}skills (${e.count}): ${e.names.slice(0, 6).join(", ")}${e.count > 6 ? ", …" : ""}${C.reset}\n`,
      );
      break;
    case "assistant_text":
      process.stdout.write(`${C.cyan}joy:${C.reset} ${e.text}\n`);
      break;
    case "tool_call":
      process.stdout.write(
        `${C.magenta}⏵ ${e.name}${C.reset} ${C.dim}${fmtInput(e.input)}${C.reset}\n`,
      );
      break;
    case "tool_result": {
      const color = e.is_error ? C.red : C.green;
      const tag = e.is_error ? "✗" : "✓";
      process.stdout.write(`${color}${tag}${C.reset} ${fmtOutput(e.output)}\n`);
      break;
    }
    case "stop":
      process.stdout.write(`${C.dim}[stop: ${e.reason}]${C.reset}\n`);
      break;
  }
}

function printHelp() {
  console.log(`${C.bold}joy${C.reset} — coding agent

${C.bold}Usage${C.reset}
  joy                       Start interactive TUI
  joy "<prompt>"            Run a single prompt and exit
  joy config                Configure API token / base URL / model
  joy doctor                Show current config and run a tiny API ping
  joy skills                List skills discovered from local skill roots
  joy --no-tui              Use the plain readline REPL (no Ink)
  joy --help                Show this help

${C.bold}Config search order${C.reset}
  1. Environment variables (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, JOY_MODEL)
  2. ~/.joy-agent/config.json
  3. ~/.claude/settings.json, ~/.config/claude/settings.json
  4. ~/Library/Application Support/{Claude,CiciSwitch}/...

${C.bold}Skill search order${C.reset}
  ~/.agents/skills, ~/.codex/skills, ~/.claude/skills, ~/.config/agents/skills
  Extra: JOY_SKILL_ROOTS env (colon-separated) or "skill_roots" in config.

In the TUI: type "/" to open the slash picker, ↑/↓ to navigate, Tab to complete.`);
}

async function setupWizard() {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`${C.bold}joy setup${C.reset}\n`);
  const baseURL =
    (await rl.question(
      `API base URL ${C.dim}[http://127.0.0.1:15721]${C.reset}: `,
    )).trim() || "http://127.0.0.1:15721";
  const authToken = (await rl.question(`Auth token: `)).trim();
  const model =
    (await rl.question(
      `Model name ${C.dim}[claude-sonnet-4-6]${C.reset}: `,
    )).trim() || "claude-sonnet-4-6";
  rl.close();

  if (!authToken) {
    console.error(`${C.red}error:${C.reset} Auth token is required.`);
    process.exit(1);
  }

  const file = await writeUserConfig({ authToken, baseURL, model });
  console.log(`\n${C.green}✓${C.reset} Saved config to ${file}`);
}

async function doctor() {
  const cfg = await resolveConfig();
  console.log(`${C.bold}joy doctor${C.reset}`);
  console.log(`  base URL : ${cfg.baseURL || "(default Anthropic)"}`);
  console.log(`  model    : ${cfg.model || "(default)"}`);
  console.log(`  token    : ${cfg.authToken ? "set" : C.red + "MISSING" + C.reset}`);
  console.log(`  sources  : ${cfg.source.join(", ") || "(none)"}`);

  const skills = await discoverSkills(cfg.skillRoots);
  console.log(`  skills   : ${skills.length} found`);

  if (!cfg.authToken) {
    console.log(`\nRun ${C.cyan}joy config${C.reset} to set up.`);
    return;
  }

  process.env.ANTHROPIC_AUTH_TOKEN = cfg.authToken;
  if (cfg.baseURL) process.env.ANTHROPIC_BASE_URL = cfg.baseURL;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey: cfg.authToken,
      baseURL: cfg.baseURL,
    });
    const r = await client.messages.create({
      model: cfg.model || "claude-sonnet-4-6",
      max_tokens: 16,
      messages: [{ role: "user", content: "reply with the single word: ok" }],
    });
    const txt = r.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    console.log(`\n${C.green}✓${C.reset} API reachable. Response: ${txt.trim() || "(empty)"}`);
  } catch (err: any) {
    console.log(`\n${C.red}✗${C.reset} API error: ${err?.message ?? err}`);
    process.exit(1);
  }
}

async function listSkills(extraRoots: string[]) {
  const skills = await discoverSkills(extraRoots);
  console.log(
    `${C.bold}joy skills${C.reset} ${C.dim}(roots: ${[...DEFAULT_SKILL_ROOTS, ...extraRoots].join(", ")})${C.reset}`,
  );
  if (skills.length === 0) {
    console.log(`  ${C.dim}(no skills found)${C.reset}`);
    return;
  }
  for (const s of skills) {
    const desc =
      s.description.length > 140
        ? s.description.slice(0, 140) + "…"
        : s.description;
    console.log(`\n  ${C.bold}${s.name}${C.reset} ${C.dim}${s.path}${C.reset}`);
    console.log(`    ${desc}`);
  }
}

function extraRootsFromEnv(cfgRoots: string[] = []): string[] {
  const env = process.env.JOY_SKILL_ROOTS;
  const fromEnv = env
    ? env.split(":").map((s) => s.trim()).filter(Boolean)
    : [];
  return [...cfgRoots, ...fromEnv];
}

async function launchTui(opts: {
  model: string;
  skills: Awaited<ReturnType<typeof discoverSkills>>;
}) {
  // Dynamically import so the heavy React/Ink graph never loads for
  // non-TTY / scripted invocations.
  const [{ render }, { default: App }] = await Promise.all([
    import("ink"),
    import("./ui/App.js"),
  ]);
  const { waitUntilExit } = render(
    React.createElement(App, { initialModel: opts.model, skills: opts.skills }),
  );
  await waitUntilExit();
}

async function main() {
  const args = process.argv.slice(2);
  let useTui = true;
  const filtered: string[] = [];
  for (const a of args) {
    if (a === "--no-tui" || a === "--plain") useTui = false;
    else filtered.push(a);
  }
  const first = filtered[0];

  if (first === "--help" || first === "-h" || first === "help") {
    printHelp();
    return;
  }
  if (first === "config" || first === "setup") {
    await setupWizard();
    return;
  }
  if (first === "doctor") {
    await doctor();
    return;
  }
  if (first === "skills") {
    const cfg = await resolveConfig();
    await listSkills(extraRootsFromEnv(cfg.skillRoots));
    return;
  }

  const cfg = await resolveConfig();
  if (!cfg.authToken) {
    console.error(
      `${C.red}error:${C.reset} No API token found.\n` +
        `  Run ${C.cyan}joy config${C.reset} to save one,\n` +
        `  or export ANTHROPIC_AUTH_TOKEN in your shell.`,
    );
    process.exit(1);
  }

  const model =
    cfg.model ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    "claude-sonnet-4-6";
  process.env.ANTHROPIC_AUTH_TOKEN = cfg.authToken;
  if (cfg.baseURL) process.env.ANTHROPIC_BASE_URL = cfg.baseURL;

  const extraRoots = extraRootsFromEnv(cfg.skillRoots);
  const skills = await discoverSkills(extraRoots);

  const inlinePrompt = filtered.join(" ").trim();
  if (inlinePrompt) {
    // Single-shot mode always uses plain output (script-friendly)
    await runAgent(inlinePrompt, { model, onEvent: plainOnEvent, skills });
    return;
  }

  const isTty = Boolean(stdout.isTTY && stdin.isTTY);
  if (useTui && isTty) {
    await launchTui({ model, skills });
  } else {
    await startRepl({ model, skills, skillsExtraRoots: extraRoots });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
