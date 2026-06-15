export const COMPACT_SUMMARY_PROMPT = `Create a machine-generated summary of the previous conversation as a structured task handoff.

Use these exact Markdown sections:

## User Goal
Summarize the user's overarching goal and current intent.

## User Preferences
Record durable preferences, communication style, skill level, language preference, and product direction that should affect future answers.

## Current Task
State the active task, its status, and what the next assistant should do first.

## Completed Work
List meaningful work completed so far. Prefer concise bullets over narrative.

## Modified Files
List files examined, modified, or created. For each important file, include the path, what changed, and whether it was verified.

## Decisions
Record key decisions, tradeoffs, and why they were made.

## Verification Status
List verification commands that were run, their pass/fail status, and exact evidence when available. Clearly mark unverified claims and commands not yet run.

## Open TODOs
List remaining tasks, blockers, and follow-up options.

## Important Context
Include technical context needed to continue: provider/model/config details, branch/commit status, relevant constraints, and important implementation notes.

## Recent Evidence
Summarize only the most important recent tool results, command outputs, errors, and observations. Do not paste long raw logs unless essential.

## Do Not Forget
Capture critical warnings, user instructions, safety constraints, and facts that would be costly to lose.

Rules:
- Be thorough but concise.
- Preserve concrete file paths, command names, test results, commit hashes, and unresolved decisions.
- Separate durable facts from temporary process details.
- Do not invent verification. If something was not verified, say so.
- This summary will replace conversation history to save context space. The agent will continue working from this summary.`;

export function buildManualCompactPrompt(): string {
  return `[COMPACT]\n\n${COMPACT_SUMMARY_PROMPT}\n\nDo NOT continue working on the task — just provide the summary.`;
}
