import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runAgent } from "./agent.js";
import { defaultModelForProvider } from "./providers/index.js";
import { MockProvider } from "./providers/mock.js";
export async function loadEvalCases(casesDir = path.resolve("evals/cases")) {
    const entries = await fs.readdir(casesDir, { withFileTypes: true });
    const cases = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory())
            continue;
        const dir = path.join(casesDir, entry.name);
        const manifestPath = path.join(dir, "case.json");
        const raw = await fs.readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        cases.push(normalizeEvalCase(parsed, dir));
    }
    return cases;
}
function normalizeEvalCase(parsed, dir) {
    const name = String(parsed.name ?? path.basename(dir));
    const provider = normalizeProvider(parsed.provider ?? "mock");
    const model = String(parsed.model ?? provider);
    const files = parsed.files && typeof parsed.files === "object" ? parsed.files : {};
    return {
        name,
        dir,
        prompt: String(parsed.prompt ?? ""),
        provider,
        model,
        files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, String(v)])),
        mockResponses: Array.isArray(parsed.mockResponses) ? parsed.mockResponses : undefined,
        verify: {
            command: String(parsed.verify?.command ?? ""),
            expectExitCode: parsed.verify?.expectExitCode,
            expectStdoutIncludes: parsed.verify?.expectStdoutIncludes,
            expectStderrIncludes: parsed.verify?.expectStderrIncludes,
            expectToolCalls: normalizeExpectedToolCalls(parsed.verify?.expectToolCalls),
        },
    };
}
function normalizeExpectedToolCalls(value) {
    if (!Array.isArray(value))
        return undefined;
    const calls = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            continue;
        const raw = entry;
        const name = typeof raw.name === "string" ? raw.name : "";
        if (!name)
            continue;
        const inputIncludes = raw.inputIncludes && typeof raw.inputIncludes === "object" && !Array.isArray(raw.inputIncludes)
            ? { ...raw.inputIncludes }
            : undefined;
        calls.push(inputIncludes ? { name, inputIncludes } : { name });
    }
    return calls;
}
function normalizeProvider(value) {
    const s = String(value).toLowerCase();
    if (s === "anthropic" || s === "mock" || s === "glm")
        return s;
    return "mock";
}
export async function runEvalCase(testCase, opts = {}) {
    const workRoot = opts.workRoot ?? path.resolve(".joy-eval-runs");
    const { provider, model } = resolveEvalProviderModel(testCase, opts);
    await fs.mkdir(workRoot, { recursive: true });
    const workDir = await fs.mkdtemp(path.join(workRoot, `${safeName(testCase.name)}-`));
    await writeInitialFiles(workDir, testCase.files);
    const previousCwd = process.cwd();
    let agentResult = "";
    const toolCalls = [];
    try {
        process.chdir(workDir);
        agentResult = await runAgent(testCase.prompt, {
            providerName: provider,
            provider: providerForCase(testCase, provider),
            model,
            skills: [],
            onEvent: (event) => {
                if (event.type === "tool_call") {
                    toolCalls.push({ id: event.id, name: event.name, input: event.input });
                }
            },
        });
    }
    finally {
        process.chdir(previousCwd);
    }
    const verify = await runCommand(testCase.verify.command, workDir);
    const failures = [
        ...checkVerify(testCase.verify, verify),
        ...checkToolCalls(testCase.verify.expectToolCalls, toolCalls),
    ];
    const status = failures.length === 0 ? "passed" : "failed";
    const kept = opts.keepRuns === true || status === "failed";
    if (!kept) {
        await fs.rm(workDir, { recursive: true, force: true });
    }
    return {
        caseName: testCase.name,
        status,
        provider,
        model,
        workDir,
        kept,
        agentResult,
        verify,
        toolCalls,
        failures,
    };
}
function resolveEvalProviderModel(testCase, opts) {
    const provider = opts.provider ?? testCase.provider;
    const model = opts.model ?? (opts.provider ? defaultModelForProvider(provider) : testCase.model);
    return { provider, model };
}
function providerForCase(testCase, provider) {
    if (provider !== "mock")
        return undefined;
    return new MockProvider(testCase.mockResponses ?? []);
}
async function writeInitialFiles(workDir, files) {
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(workDir, relativePath);
        if (!filePath.startsWith(workDir + path.sep)) {
            throw new Error(`Eval file path escapes workdir: ${relativePath}`);
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
    }
}
function runCommand(command, cwd) {
    return new Promise((resolve) => {
        const child = spawn("bash", ["-lc", command], {
            cwd,
            env: process.env,
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on("data", (d) => stdout.push(d));
        child.stderr.on("data", (d) => stderr.push(d));
        child.on("close", (code) => {
            resolve({
                command,
                exitCode: code,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
        child.on("error", (err) => {
            resolve({ command, exitCode: 127, stdout: "", stderr: err.message });
        });
    });
}
function checkVerify(spec, result) {
    const failures = [];
    if (spec.expectExitCode !== undefined && result.exitCode !== spec.expectExitCode) {
        failures.push(`expected exit ${spec.expectExitCode}, got ${result.exitCode}`);
    }
    if (spec.expectStdoutIncludes !== undefined && !result.stdout.includes(spec.expectStdoutIncludes)) {
        failures.push(`expected stdout to include ${JSON.stringify(spec.expectStdoutIncludes)}`);
    }
    if (spec.expectStderrIncludes !== undefined && !result.stderr.includes(spec.expectStderrIncludes)) {
        failures.push(`expected stderr to include ${JSON.stringify(spec.expectStderrIncludes)}`);
    }
    return failures;
}
function checkToolCalls(expected, actual) {
    if (!expected || expected.length === 0)
        return [];
    const failures = [];
    let cursor = 0;
    for (let i = 0; i < expected.length; i++) {
        const exp = expected[i];
        let matched = false;
        for (let j = cursor; j < actual.length; j++) {
            if (toolCallMatches(exp, actual[j])) {
                cursor = j + 1;
                matched = true;
                break;
            }
        }
        if (!matched) {
            failures.push(formatToolCallFailure(i, exp, actual));
        }
    }
    return failures;
}
function toolCallMatches(expected, actual) {
    if (actual.name !== expected.name)
        return false;
    if (!expected.inputIncludes)
        return true;
    if (!actual.input || typeof actual.input !== "object" || Array.isArray(actual.input))
        return false;
    const input = actual.input;
    return Object.entries(expected.inputIncludes).every(([key, value]) => Object.prototype.hasOwnProperty.call(input, key) && isDeepStrictEqual(input[key], value));
}
function formatToolCallFailure(index, expected, actual) {
    const inputPart = expected.inputIncludes
        ? ` with inputIncludes ${JSON.stringify(expected.inputIncludes)}`
        : "";
    const actualNames = actual.length > 0 ? actual.map((call) => call.name).join(", ") : "none";
    return `expected tool call #${index + 1} ${expected.name}${inputPart}; actual calls: ${actualNames}`;
}
function safeName(name) {
    const safe = name.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
    return safe || `case-${Date.now()}`;
}
