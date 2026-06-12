import { promises as fs } from "node:fs";
import path from "node:path";
import { discoverSkills } from "./skills.js";
const C = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
};
export const SLASH_COMMANDS = [
    {
        name: "help",
        description: "Show available slash commands",
        run: async ({ printLine }) => {
            printLine(`${C.bold}Slash commands${C.reset}`);
            const w = Math.max(...SLASH_COMMANDS.map((c) => c.name.length));
            for (const c of SLASH_COMMANDS) {
                printLine(`  ${C.cyan}/${c.name.padEnd(w)}${C.reset}  ${C.dim}${c.description}${C.reset}`);
            }
            printLine(`\n${C.dim}Tip: type ${C.reset}${C.cyan}/${C.reset}${C.dim} alone to see this menu; ${C.reset}${C.cyan}/<prefix>${C.reset}${C.dim} to filter.${C.reset}`);
            return {};
        },
    },
    {
        name: "init",
        description: "Have joy explore the project and create an AGENTS.md",
        run: async () => ({
            prompt: "Please explore the current project directory. Look at the top-level files, " +
                "package metadata, and any existing README/AGENTS files. Then create or update " +
                "an `AGENTS.md` in the project root with: a 1-paragraph project summary, key " +
                "directories, how to run/build/test, and any conventions worth knowing. " +
                "Use the `read` and `bash` tools to investigate before writing.",
        }),
    },
    {
        name: "skills",
        description: "List skills discovered from local skill roots",
        run: async ({ printLine }) => {
            const skills = await discoverSkills();
            if (skills.length === 0) {
                printLine(`${C.dim}(no skills found)${C.reset}`);
                return {};
            }
            printLine(`${C.bold}Skills${C.reset} ${C.dim}(${skills.length})${C.reset}`);
            for (const s of skills) {
                const d = s.description.length > 100
                    ? s.description.slice(0, 100) + "…"
                    : s.description;
                printLine(`  ${C.cyan}${s.name}${C.reset}  ${C.dim}${d}${C.reset}`);
            }
            return {};
        },
    },
    {
        name: "tools",
        description: "List built-in tools the agent can call",
        run: async ({ printLine }) => {
            printLine(`${C.bold}Built-in tools${C.reset}`);
            printLine(`  ${C.cyan}read${C.reset}        ${C.dim}read a file${C.reset}`);
            printLine(`  ${C.cyan}list_files${C.reset}  ${C.dim}list directory contents${C.reset}`);
            printLine(`  ${C.cyan}glob${C.reset}        ${C.dim}find files by glob pattern${C.reset}`);
            printLine(`  ${C.cyan}grep${C.reset}        ${C.dim}search text with regex${C.reset}`);
            printLine(`  ${C.cyan}write${C.reset}       ${C.dim}create/overwrite a file${C.reset}`);
            printLine(`  ${C.cyan}edit${C.reset}        ${C.dim}replace exact text in a file${C.reset}`);
            printLine(`  ${C.cyan}bash${C.reset}        ${C.dim}run a shell command (bash -lc)${C.reset}`);
            return {};
        },
    },
    {
        name: "model",
        description: "Print current model, or switch with `/model <name>`",
        usage: "/model [name]",
        run: async ({ args, model, printLine }) => {
            if (args.length === 0) {
                printLine(`${C.dim}current model:${C.reset} ${model}`);
                printLine(`${C.dim}common: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-8${C.reset}`);
                return {};
            }
            // Mutation handled by the REPL through a side-channel via process.env
            process.env.JOY_MODEL = args[0];
            printLine(`${C.green}✓${C.reset} model set to ${args[0]} (effective next turn)`);
            return {};
        },
    },
    {
        name: "cwd",
        description: "Print working directory, or `cd` with `/cwd <path>`",
        usage: "/cwd [path]",
        run: async ({ args, cwd, printLine }) => {
            if (args.length === 0) {
                printLine(cwd);
                return {};
            }
            const target = path.resolve(cwd, args[0]);
            try {
                const stat = await fs.stat(target);
                if (!stat.isDirectory())
                    throw new Error("not a directory");
                process.chdir(target);
                printLine(`${C.green}✓${C.reset} cwd → ${target}`);
            }
            catch (err) {
                printLine(`${C.dim}error:${C.reset} ${err?.message ?? err}`);
            }
            return {};
        },
    },
    {
        name: "compact",
        description: "Compress conversation history to save context",
        run: async ({ printLine }) => {
            printLine(`${C.yellow}Compressing conversation history...${C.reset}`);
            // The actual compression is handled by the REPL/App via the prompt mechanism
            return {
                prompt: "[COMPACT] Please summarize the conversation so far. Include the user's original request, " +
                    "key decisions, files modified, current progress, and what remains to be done. " +
                    "After summarizing, the conversation history will be replaced with your summary to save context space. " +
                    "Do NOT continue working on the task — just provide the summary.",
            };
        },
    },
    {
        name: "clear",
        description: "Clear the screen",
        run: async () => ({ clear: true }),
    },
    {
        name: "exit",
        description: "Exit joy",
        run: async () => ({ exit: true }),
    },
    {
        name: "quit",
        description: "Exit joy (alias of /exit)",
        run: async () => ({ exit: true }),
    },
];
export function findCommand(name) {
    return SLASH_COMMANDS.find((c) => c.name === name);
}
export function matchCommands(prefix) {
    const p = prefix.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(p));
}
