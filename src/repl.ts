import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { runAgent, type AgentEvent } from "./agent.js";
import type { ProviderName } from "./providers/types.js";
import type { SkillMeta } from "./skills.js";
import {
  SLASH_COMMANDS,
  findCommand,
  matchCommands,
  type CommandContext,
} from "./commands.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
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

function defaultOnEvent(e: AgentEvent) {
  switch (e.type) {
    case "iteration":
      stdout.write(`${C.dim}── turn ${e.n} ──${C.reset}\n`);
      break;
    case "skills_loaded":
      break;
    case "assistant_text":
      stdout.write(`${C.cyan}joy:${C.reset} ${e.text}\n`);
      break;
    case "tool_call":
      stdout.write(
        `${C.magenta}⏵ ${e.name}${C.reset} ${C.dim}${fmtInput(e.input)}${C.reset}\n`,
      );
      break;
    case "tool_result": {
      const color = e.is_error ? C.red : C.green;
      const tag = e.is_error ? "✗" : "✓";
      stdout.write(`${color}${tag}${C.reset} ${fmtOutput(e.output)}\n`);
      break;
    }
    case "turnEnd":
      stdout.write(
        `${C.dim}turn ${e.n} done · ${e.tools} tools · ${(e.durationMs / 1000).toFixed(1)}s · ↑${e.tokIn} ↓${e.tokOut}${C.reset}\n`,
      );
      break;
    case "usage":
      break;
    case "stop":
      break;
    case "compact":
      stdout.write(
        `${C.yellow}🗜 compact:${C.reset} saved ~${Math.round(e.savedTokens / 1000)}K tokens
`,
      );
      break;
  }
}

export interface ReplOptions {
  provider: ProviderName;
  model: string;
  skills: SkillMeta[];
  skillsExtraRoots?: string[];
}

export async function startRepl(opts: ReplOptions): Promise<void> {
  let provider = opts.provider;
  let model = opts.model;
  const skills = opts.skills;

  const completer: readline.Completer = (line: string) => {
    if (!line.startsWith("/")) return [[], line];
    const rest = line.slice(1);
    if (rest.includes(" ")) return [[], line];
    const matches = matchCommands(rest).map((c) => "/" + c.name + " ");
    return [matches.length ? matches : SLASH_COMMANDS.map((c) => "/" + c.name + " "), line];
  };

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
    completer,
    prompt: `${C.blue}you>${C.reset} `,
  });

  if (stdin.isTTY) {
    stdin.on("keypress", () => {
      setImmediate(() => maybeSuggest(rl));
    });
  }

  printBanner(provider, model, skills.length);
  rl.prompt();

  for await (const rawLine of rl as AsyncIterable<string>) {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      continue;
    }

    if (line.startsWith("/")) {
      const result = await runSlash(line, { model });
      if (result.clear) {
        stdout.write("\x1b[2J\x1b[H");
      }
      if (result.exit) {
        break;
      }
      if (process.env.JOY_MODEL && process.env.JOY_MODEL !== model) {
        model = process.env.JOY_MODEL;
      }
      if (result.prompt) {
        await runOnce(result.prompt, provider, model, skills);
      }
      stdout.write("\n");
      rl.prompt();
      continue;
    }

    try {
      await runOnce(line, provider, model, skills);
    } catch (err: any) {
      console.error(`${C.red}error:${C.reset} ${err?.message ?? err}`);
    }
    stdout.write("\n");
    rl.prompt();
  }

  rl.close();
}

function printBanner(provider: ProviderName, model: string, skillCount: number) {
  stdout.write(
    `${C.dim}tools: read, list_files, glob, grep, write, edit, bash  ·  skills: ${skillCount}  ·  model: ${provider}:${model}${C.reset}\n`,
  );
  stdout.write(
    `${C.dim}type ${C.reset}${C.cyan}/${C.reset}${C.dim} for commands, ${C.reset}${C.cyan}Tab${C.reset}${C.dim} to complete, ${C.reset}${C.cyan}/exit${C.reset}${C.dim} to quit${C.reset}\n\n`,
  );
}

async function runOnce(
  prompt: string,
  provider: ProviderName,
  model: string,
  skills: SkillMeta[],
): Promise<void> {
  await runAgent(prompt, {
    providerName: provider,
    model,
    skills,
    onEvent: defaultOnEvent,
    onCompact: (summary: string, _tokensSaved: number) => {
      return [
        {
          role: "user" as const,
          content: `[CONVERSATION HISTORY SUMMARY]\n\n${summary}\n\n---\nThe conversation above has been compressed. Continue working based on this summary.`,
        },
      ];
    },
  });
}

async function runSlash(
  line: string,
  state: { model: string },
): Promise<{ prompt?: string; exit?: boolean; clear?: boolean }> {
  const body = line.slice(1).trim();
  if (!body) {
    showMenu();
    return {};
  }
  const [head, ...rest] = body.split(/\s+/);
  const cmd = findCommand(head);
  if (!cmd) {
    const matches = matchCommands(head);
    if (matches.length === 1) {
      return runCommand(matches[0], rest, state);
    }
    if (matches.length > 1) {
      stdout.write(`${C.dim}Did you mean:${C.reset}\n`);
      for (const m of matches) {
        stdout.write(`  ${C.cyan}/${m.name}${C.reset}  ${C.dim}${m.description}${C.reset}\n`);
      }
      return {};
    }
    stdout.write(`${C.red}unknown command:${C.reset} /${head}  ${C.dim}(try /help)${C.reset}\n`);
    return {};
  }
  return runCommand(cmd, rest, state);
}

async function runCommand(
  cmd: ReturnType<typeof findCommand> & {},
  args: string[],
  state: { model: string },
): Promise<{ prompt?: string; exit?: boolean; clear?: boolean }> {
  const ctx: CommandContext = {
    args,
    raw: args.join(" "),
    cwd: process.cwd(),
    model: state.model,
    printLine: (msg) => stdout.write(msg + "\n"),
  };
  const out = await cmd.run(ctx);
  return out;
}

function showMenu() {
  stdout.write(`${C.bold}Slash commands${C.reset}\n`);
  const w = Math.max(...SLASH_COMMANDS.map((c) => c.name.length));
  for (const c of SLASH_COMMANDS) {
    stdout.write(
      `  ${C.cyan}/${c.name.padEnd(w)}${C.reset}  ${C.dim}${c.description}${C.reset}\n`,
    );
  }
  stdout.write(
    `${C.dim}Tip: press ${C.reset}${C.cyan}Tab${C.reset}${C.dim} after typing a prefix to autocomplete.${C.reset}\n`,
  );
}

function maybeSuggest(rl: readline.Interface) {
  const buf = (rl as any).line ?? "";
  if (!buf.startsWith("/") || buf.length <= 1) return;
}
