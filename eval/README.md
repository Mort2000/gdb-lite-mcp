# opencode Evaluation

This directory contains prompts for evaluating GDB Lite MCP plus the repository-local `gdb-debugging` Skill.

Run from the repository root after building the MCP server and scenarios:

```bash
bash eval/run-scenario.sh wrong-result-ledger
```

The repository-root `opencode.json` starts the MCP server from `dist/index.js`, so
scenario prompts can use `work_dir="."` and root-relative `scenarios/...` paths.

Each prompt asks the agent to:

1. Read `skills/gdb-debugging/SKILL.md`.
2. Use the relevant Skill reference.
3. Use the GDB Lite MCP tools to collect runtime evidence.
4. Avoid source edits.
5. Report root cause, exact source location, expected versus actual state, and decisive GDB evidence.

No-Skill A/B prompts live under `prompts/no-skill/`. They use the same MCP server and targets but explicitly avoid the repository-local Skill.

Examples:

```bash
bash eval/run-scenario.sh hang-settlement-cursor
bash eval/run-scenario.sh core-invoice-export
bash eval/run-scenario.sh no-skill/hang-settlement-cursor
bash eval/run-scenario.sh no-skill/core-invoice-export
```

Record real runs in `opencode-results.md`.
