#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import React from "react";
import { runAgent } from "./agent.js";
import { resolveConfig, writeUserConfig } from "./config.js";
import { runEvalCli, parseEvalArgs } from "./evalCli.js";
import { createProvider, defaultModelForProvider, tokenRequiredForProvider } from "./providers/index.js";
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
function fmtInput(input) {
    const s = JSON.stringify(input);
    if (!s)
        return "";
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
function fmtOutput(out) {
    const lines = out.split("\n");
    const head = lines.slice(0, 20).join("\n");
    return lines.length > 20
        ? head + `\n${C.dim}... (${lines.length - 20} more lines)${C.reset}`
        : head;
}
function plainOnEvent(e) {
    switch (e.type) {
        case "iteration":
            process.stdout.write(`${C.dim}── turn ${e.n} ──${C.reset}\n`);
            break;
        case "skills_loaded":
            process.stdout.write(`${C.dim}skills (${e.count}): ${e.names.slice(0, 6).join(", ")}${e.count > 6 ? ", …" : ""}${C.reset}\n`);
            break;
        case "assistant_text":
            process.stdout.write(`${C.cyan}joy:${C.reset} ${e.text}\n`);
            break;
        case "tool_call":
            process.stdout.write(`${C.magenta}⏵ ${e.name}${C.reset} ${C.dim}${fmtInput(e.input)}${C.reset}\n`);
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
  joy eval [case]           Run local eval cases
  joy eval --list           List eval case names
  joy eval --json           Print machine-readable eval results
  joy eval --provider mock  Override case provider
  joy eval --keep-runs      Keep passing run directories
  joy skills                List skills discovered from local skill roots
  joy --no-tui              Use the plain readline REPL (no Ink)
  joy --help                Show this help

${C.bold}Config search order${C.reset}
  1. Environment variables (JOY_PROVIDER, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, JOY_MODEL)
  2. ~/.joy-agent/config.json
  3. ~/.claude/settings.json, ~/.config/claude/settings.json
  4. ~/Library/Application Support/{Claude,CiciSwitch}/...

${C.bold}Skill search order${C.reset}
  ~/.agents/skills, ~/.codex/skills, ~/.claude/skills, ~/.config/agents/skills
  Extra: JOY_SKILL_ROOTS env (colon-separated) or "skill_roots" in config.

In the TUI: type "/" to open the slash picker, ↑/↓ to navigate, Tab to complete.`);
}
function normalizeProvider(value) {
    const v = value.toLowerCase();
    return v === "mock" || v === "glm" || v === "anthropic" ? v : "anthropic";
}
async function setupWizard() {
    const rl = createInterface({ input: stdin, output: stdout });
    console.log(`${C.bold}joy setup${C.reset}\n`);
    const provider = normalizeProvider((await rl.question(`Provider ${C.dim}[anthropic/mock/glm] [anthropic]${C.reset}: `)).trim() || "anthropic");
    const baseURL = (await rl.question(`API base URL ${C.dim}[provider default]${C.reset}: `)).trim() || undefined;
    const authToken = (await rl.question(`Auth token ${C.dim}[blank allowed for mock/glm]${C.reset}: `)).trim();
    const model = (await rl.question(`Model name ${C.dim}[${defaultModelForProvider(provider)}]${C.reset}: `)).trim() || defaultModelForProvider(provider);
    rl.close();
    if (tokenRequiredForProvider(provider) && !authToken) {
        console.error(`${C.red}error:${C.reset} Auth token is required for provider '${provider}'.`);
        process.exit(1);
    }
    if (provider === "glm") {
        console.log(`${C.dim}note: GLM support is reserved and does not call a real GLM API yet.${C.reset}`);
    }
    const file = await writeUserConfig({
        provider,
        ...(authToken ? { authToken } : {}),
        ...(baseURL ? { baseURL } : {}),
        model,
    });
    console.log(`\n${C.green}✓${C.reset} Saved config to ${file}`);
}
async function doctor() {
    const cfg = await resolveConfig();
    console.log(`${C.bold}joy doctor${C.reset}`);
    console.log(`  provider : ${cfg.provider}`);
    console.log(`  base URL : ${cfg.baseURL || "(provider default)"}`);
    console.log(`  model    : ${cfg.model || defaultModelForProvider(cfg.provider)}`);
    console.log(`  token    : ${cfg.authToken ? "set" : tokenRequiredForProvider(cfg.provider) ? C.red + "MISSING" + C.reset : "not required"}`);
    console.log(`  sources  : ${cfg.source.join(", ") || "(none)"}`);
    const skills = await discoverSkills(cfg.skillRoots);
    console.log(`  skills   : ${skills.length} found`);
    if (tokenRequiredForProvider(cfg.provider) && !cfg.authToken) {
        console.log(`\nRun ${C.cyan}joy config${C.reset} to set up.`);
        return;
    }
    if (cfg.authToken)
        process.env.ANTHROPIC_AUTH_TOKEN = cfg.authToken;
    if (cfg.baseURL)
        process.env.ANTHROPIC_BASE_URL = cfg.baseURL;
    try {
        const provider = createProvider(cfg);
        if (cfg.provider === "glm") {
            console.log(`\n${C.green}✓${C.reset} GLM provider is reserved/skeleton; no GLM network call was attempted.`);
            return;
        }
        const r = await provider.createMessage({
            model: cfg.model || defaultModelForProvider(cfg.provider),
            maxTokens: 16,
            system: "",
            tools: [],
            messages: [{ role: "user", content: "reply with the single word: ok" }],
        });
        const txt = r.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
        console.log(`\n${C.green}✓${C.reset} Provider check succeeded. Response: ${txt.trim() || "(empty)"}`);
    }
    catch (err) {
        console.log(`\n${C.red}✗${C.reset} API error: ${err?.message ?? err}`);
        process.exit(1);
    }
}
async function listSkills(extraRoots) {
    const skills = await discoverSkills(extraRoots);
    console.log(`${C.bold}joy skills${C.reset} ${C.dim}(roots: ${[...DEFAULT_SKILL_ROOTS, ...extraRoots].join(", ")})${C.reset}`);
    if (skills.length === 0) {
        console.log(`  ${C.dim}(no skills found)${C.reset}`);
        return;
    }
    for (const s of skills) {
        const desc = s.description.length > 140
            ? s.description.slice(0, 140) + "…"
            : s.description;
        console.log(`\n  ${C.bold}${s.name}${C.reset} ${C.dim}${s.path}${C.reset}`);
        console.log(`    ${desc}`);
    }
}
function extraRootsFromEnv(cfgRoots = []) {
    const env = process.env.JOY_SKILL_ROOTS;
    const fromEnv = env
        ? env.split(":").map((s) => s.trim()).filter(Boolean)
        : [];
    return [...cfgRoots, ...fromEnv];
}
async function launchTui(opts) {
    // Dynamically import so the heavy React/Ink graph never loads for
    // non-TTY / scripted invocations.
    const [{ render }, { default: App }] = await Promise.all([
        import("ink"),
        import("./ui/App.js"),
    ]);
    const { waitUntilExit } = render(React.createElement(App, { initialProvider: opts.provider, initialModel: opts.model, skills: opts.skills }));
    await waitUntilExit();
}
async function main() {
    const args = process.argv.slice(2);
    let useTui = true;
    const filtered = [];
    for (const a of args) {
        if (a === "--no-tui" || a === "--plain")
            useTui = false;
        else
            filtered.push(a);
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
    if (first === "eval") {
        const exitCode = await runEvalCli(parseEvalArgs(filtered.slice(1)));
        process.exit(exitCode);
    }
    if (first === "skills") {
        const cfg = await resolveConfig();
        await listSkills(extraRootsFromEnv(cfg.skillRoots));
        return;
    }
    const cfg = await resolveConfig();
    if (tokenRequiredForProvider(cfg.provider) && !cfg.authToken) {
        console.error(`${C.red}error:${C.reset} No API token found for provider '${cfg.provider}'.\n` +
            `  Run ${C.cyan}joy config${C.reset} to save one,\n` +
            `  or export ANTHROPIC_AUTH_TOKEN in your shell.`);
        process.exit(1);
    }
    const provider = cfg.provider;
    const model = cfg.model || defaultModelForProvider(provider);
    if (cfg.authToken)
        process.env.ANTHROPIC_AUTH_TOKEN = cfg.authToken;
    if (cfg.baseURL)
        process.env.ANTHROPIC_BASE_URL = cfg.baseURL;
    const extraRoots = extraRootsFromEnv(cfg.skillRoots);
    const skills = await discoverSkills(extraRoots);
    const inlinePrompt = filtered.join(" ").trim();
    if (inlinePrompt) {
        // Single-shot mode always uses plain output (script-friendly)
        await runAgent(inlinePrompt, { providerName: provider, model, onEvent: plainOnEvent, skills });
        return;
    }
    const isTty = Boolean(stdout.isTTY && stdin.isTTY);
    if (useTui && isTty) {
        await launchTui({ provider, model, skills });
    }
    else {
        await startRepl({ provider, model, skills, skillsExtraRoots: extraRoots });
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
