import path from "node:path";

import { loadEvalCases, runEvalCase } from "./eval.js";
import type { ProviderName } from "./providers/types.js";

export interface EvalCliOptions {
  casesDir?: string;
  workRoot?: string;
  caseName?: string;
  provider?: ProviderName;
  model?: string;
  list?: boolean;
  json?: boolean;
  keepRuns?: boolean;
  write?: (text: string) => void;
}

export async function runEvalCli(opts: EvalCliOptions = {}): Promise<number> {
  const write = opts.write ?? ((text: string) => process.stdout.write(text));
  const casesDir = opts.casesDir ?? path.resolve("evals/cases");
  const workRoot = opts.workRoot ?? path.resolve(".joy-eval-runs");
  const cases = await loadEvalCases(casesDir);
  const selected = opts.caseName
    ? cases.filter((testCase) => testCase.name === opts.caseName)
    : cases;

  if (selected.length === 0) {
    write(`No eval cases found${opts.caseName ? ` for ${opts.caseName}` : ""}.\n`);
    return 1;
  }

  // --list mode: print names without running
  if (opts.list) {
    return printEvalList(selected, write, opts.json ?? false);
  }

  // Run cases
  let passed = 0;
  let failed = 0;
  const results: Array<{
    caseName: string;
    status: string;
    provider: string;
    model: string;
    workDir: string;
    kept: boolean;
    failures: string[];
    verify: { command: string; exitCode: number | null; stdout: string; stderr: string };
    toolCalls: Array<{ id: string; name: string; input: unknown }>;
  }> = [];

  for (const testCase of selected) {
    const result = await runEvalCase(testCase, {
      workRoot,
      provider: opts.provider,
      model: opts.model,
      keepRuns: opts.keepRuns,
    });

    if (opts.json) {
      results.push({
        caseName: result.caseName,
        status: result.status,
        provider: result.provider,
        model: result.model,
        workDir: result.workDir,
        kept: result.kept,
        failures: result.failures,
        verify: result.verify,
        toolCalls: result.toolCalls,
      });
    } else {
      if (result.status === "passed") {
        passed++;
        write(`PASS ${result.caseName}\n`);
        if (opts.keepRuns) {
          write(`  work dir: ${result.workDir}\n`);
        }
      } else {
        failed++;
        write(`FAIL ${result.caseName}\n`);
        for (const failure of result.failures) {
          write(`  - ${failure}\n`);
        }
        if (result.verify.stdout.trim()) write(`  stdout: ${result.verify.stdout.trim()}\n`);
        if (result.verify.stderr.trim()) write(`  stderr: ${result.verify.stderr.trim()}\n`);
        write(`  work dir: ${result.workDir}\n`);
      }
    }
  }

  if (opts.json) {
    const allPassed = results.every((r) => r.status === "passed");
    write(
      JSON.stringify(
        {
          status: allPassed ? "passed" : "failed",
          passed: results.filter((r) => r.status === "passed").length,
          failed: results.filter((r) => r.status === "failed").length,
          results,
        },
        null,
        2,
      ) + "\n",
    );
    return allPassed ? 0 : 1;
  }

  write(`${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

async function printEvalList(
  cases: Array<{ name: string; provider: ProviderName; model: string }>,
  write: (text: string) => void,
  json: boolean,
): Promise<number> {
  if (json) {
    const metadata = cases.map((c) => ({
      name: c.name,
      provider: c.provider,
      model: c.model,
    }));
    write(JSON.stringify(metadata, null, 2) + "\n");
  } else {
    for (const c of cases) {
      write(`${c.name}\n`);
    }
  }
  return 0;
}

export function parseEvalArgs(args: string[]): Pick<EvalCliOptions, "caseName" | "casesDir" | "provider" | "model" | "list" | "json" | "keepRuns"> {
  const out: Pick<EvalCliOptions, "caseName" | "casesDir" | "provider" | "model" | "list" | "json" | "keepRuns"> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--case" && args[i + 1]) {
      out.caseName = args[++i];
    } else if (arg === "--cases-dir" && args[i + 1]) {
      out.casesDir = args[++i];
    } else if (arg === "--list") {
      out.list = true;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--keep-runs") {
      out.keepRuns = true;
    } else if (arg === "--provider" && args[i + 1]) {
      out.provider = normalizeProviderArg(args[++i]);
    } else if (arg === "--model" && args[i + 1]) {
      out.model = args[++i];
    } else if (!arg.startsWith("-") && !out.caseName) {
      out.caseName = arg;
    }
  }
  return out;
}

function normalizeProviderArg(value: string): ProviderName {
  const v = value.toLowerCase();
  if (v === "anthropic" || v === "mock" || v === "glm") return v;
  return "mock";
}
