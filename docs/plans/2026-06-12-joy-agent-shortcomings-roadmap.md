# Joy Agent Shortcomings Roadmap

## Goal

Record the current 13 known shortcomings of Joy Agent and turn them into a gradual implementation roadmap. Joy is being positioned as a GLM-ready coding agent for Chinese developer workflows. The project should improve steadily without rushing into real GLM integration before the foundation is reliable.

## Current Baseline

Joy already has:

- Provider architecture with `anthropic`, `mock`, and reserved `glm` providers.
- A deterministic mock provider for local development and evals.
- Local eval harness with starter English and Chinese cases.
- Core coding tools: `read`, `write`, `edit`, `bash`, `list_files`, `glob`, `grep`.
- REPL/TUI foundations and slash commands.
- README positioning as a GLM-ready terminal coding agent.

## The 13 Current Shortcomings

### 1. Joy is GLM-ready, not GLM-powered yet

The `glm` provider is currently a skeleton. It does not call the real GLM API. Future work needs to implement real GLM request/response handling, tool calling, streaming, errors, rate limits, and context behavior.

### 2. Weak long-term memory

Joy does not yet behave like a long-term project partner. It lacks durable project memory, user preferences, project conventions, repeated command knowledge, and previous decision tracking.

### 3. Coarse context management

The compact mechanism exists, but it is still a broad conversation summary. Joy lacks repo maps, file summaries, task-state summaries, decision logs, and separation between chat history and durable project facts.

### 4. Tool safety and permissions are still basic

Joy has powerful tools such as `bash`, `write`, and `edit`, but does not yet have a mature permission model for dangerous commands, deletion, overwrites, git operations, or sandbox policies.

### 5. Editing capability is basic

The current `edit` tool relies on exact string replacement. This is safe but fragile. Joy needs stronger patch/diff editing, better failure messages, and ideally symbol-aware or context-aware editing later.

### 6. Eval coverage is still small

The eval harness exists, but the case set is still tiny. Joy needs broader eval coverage: bugfix, refactor, test-driven repair, Chinese requirements, tool failure recovery, read-only tasks, long-context tasks, and safety tasks.

### 7. Chinese developer workflow support is shallow

Joy has Chinese starter cases, but true Chinese developer workflows should include Chinese PRDs, bug reports, business terms, mixed Chinese/English docs, domestic project conventions, and realistic product-manager-style requirements.

### 8. REPL/TUI experience is still rough

Tool display, diff display, task progress, collapsed long output, errors, test summaries, and subagent output can become more usable and closer to a polished coding-agent UX.

### 9. Subagent capability is early-stage

Joy has subagent primitives, but lacks clear role templates such as researcher, reviewer, tester, bug locator, and implementer. It also lacks strong coordination and conflict handling.

### 10. Task execution discipline is mostly prompt-based

Joy asks the model to plan, search, edit, and verify, but the framework does not strongly enforce reliable engineering workflow. Future Joy should guide or enforce plan → search → edit → test → repair → final summary.

### 11. Lack of real-project pressure testing

Current evals are small fixtures. Joy has not yet been measured on realistic repositories with many files, package scripts, failing tests, multi-file bugs, monorepos, or framework-specific conventions.

### 12. Installation and distribution are not productized

The README still emphasizes developer commands such as `node dist/cli.js` and `npm run dev`. Joy needs clearer global install/link instructions, first-run setup, config guidance, and `joy doctor` improvements.

### 13. GLM differentiation is not deep enough

Joy should not only be a simplified Claude Code clone with a future GLM backend. Its differentiation should become: GLM-oriented, Chinese developer workflows, local evals, domestic tooling assumptions, and benchmark-driven GLM adaptation.

## Recommended Implementation Roadmap

### Phase 1 — Reliability foundation

Focus: make Joy safer and more reliable before adding model-specific complexity.

1. Add `apply_patch` or structured patch editing.
2. Add diff preview and clearer edit failure output.
3. Add eval cases for multi-file patch edits.
4. Add eval cases for test failure → fix → verify loops.
5. Add final verification discipline: when code changes, Joy should strongly prefer running tests/builds before claiming completion.

### Phase 2 — Eval expansion

Focus: turn evals into Joy's capability scorecard.

1. Add 10 basic coding eval cases.
2. Add 10 Chinese workflow cases.
3. Add tool-failure recovery cases.
4. Add read-only and no-edit cases.
5. Add JSON reports that are easy to compare across providers/models.
6. Later, use the same evals to compare Anthropic, mock, and GLM.

### Phase 3 — Project memory and context

Focus: make Joy understand a project over time.

1. Auto-read `AGENTS.md` or project instructions.
2. Add `.joy/memory.md` or equivalent project memory.
3. Add repo-map generation.
4. Add file summaries for frequently read files.
5. Add structured task-state summaries.
6. Improve compact so it preserves decisions, files, commands, and verification status.

### Phase 4 — Tool safety and permissions

Focus: avoid accidental destructive behavior.

1. Add confirmation for dangerous shell commands.
2. Add confirmation or diff preview before overwrites/deletes.
3. Add git operation safeguards.
4. Add configurable allowlist/denylist policies.
5. Add sandbox mode documentation and tests.

### Phase 5 — Chinese workflow depth

Focus: make Joy genuinely useful for Chinese developer scenarios.

1. Add Chinese PRD implementation cases.
2. Add Chinese bug report cases.
3. Add Chinese business terminology cases.
4. Add mixed Chinese/English docs and comments.
5. Add cases based on domestic frontend/backend project conventions.

### Phase 6 — Real GLM provider

Focus: move from GLM-ready to GLM-powered when API access is available.

1. Implement real GLM provider.
2. Adapt GLM tool-calling format.
3. Add GLM streaming support if available.
4. Normalize GLM errors, rate limits, and retries.
5. Run existing evals against GLM.
6. Record GLM-specific failure modes and tune prompts/tools accordingly.

### Phase 7 — Productization and UX

Focus: make Joy easier for others to install and use.

1. Improve `joy doctor`.
2. Add first-run provider/model setup guidance.
3. Document `npm link` and global install flow.
4. Improve REPL/TUI tool cards, diff display, and long-output folding.
5. Add examples, demo screenshots, or demo videos.

## Suggested Next Concrete Task

The best next implementation task is:

> Add an `apply_patch` tool with diff-friendly editing behavior and eval coverage.

Why:

- It improves Joy's core coding-agent capability immediately.
- It does not require GLM API access.
- It benefits Anthropic, mock, and future GLM providers equally.
- It gives evals a stronger editing scenario.
- It addresses one of the most important reliability gaps.

A good next prompt would be:

```text
帮 Joy 新增 apply_patch 工具：支持 unified diff patch；失败时返回清晰错误；新增 mock eval case 验证多文件 patch 修改。先输出实现计划，不要直接写代码。
```
