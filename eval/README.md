# opencode Evaluation

This directory contains prompts and configuration for evaluating GDB Lite MCP plus the repository-local `gdb-debugging` Skill.

Run from this directory after building the MCP server and scenarios:

```bash
cd eval
opencode run --dangerously-skip-permissions --print-logs --log-level INFO "$(cat prompts/wrong-result-ledger.md)"
```

The local `opencode.json` starts the MCP server from `../dist/index.js`.

Each prompt asks the agent to:

1. Read `../skills/gdb-debugging/SKILL.md`.
2. Use the relevant Skill reference.
3. Use the GDB Lite MCP tools to collect runtime evidence.
4. Avoid source edits.
5. Report root cause, exact source location, expected versus actual state, and decisive GDB evidence.

No-Skill A/B prompts live under `prompts/no-skill/`. They use the same MCP server and targets but explicitly avoid the repository-local Skill.

Examples:

```bash
bash run-scenario.sh hang-settlement-cursor
bash run-scenario.sh core-invoice-export
bash run-scenario.sh no-skill/hang-settlement-cursor
bash run-scenario.sh no-skill/core-invoice-export
```

Record real runs in `opencode-results.md`.
