# opencode Evaluation

This directory contains natural prompts for evaluating GDB Lite MCP with and without the repository-local `gdb-debugging` Skill.

Run from the repository root after building the MCP server and scenarios:

```bash
bash eval/run-scenario.sh wrong-result-ledger
```

`eval/run-scenario.sh` creates a temporary workspace for each run, writes an
`opencode.json` that starts the MCP server from the built repository
`dist/index.js`, and copies `scenarios/` into that workspace. Normal runs also
install the repository-local Skill under `.opencode/skills/`, which is
OpenCode's project-local discovery layout; `no-skill/...` runs do not install
that project Skill. Repository-local Skill visibility is controlled by the
generated workspace, not by prompt instructions.

Each prompt asks the agent to:

1. Debug the target with GDB Lite MCP.
2. Avoid source edits.
3. Report root cause, exact source location, expected versus actual state, and decisive GDB evidence.

No-Skill A/B runs use the same natural prompt as Skill-visible runs:
`no-skill/<scenario>` strips the prefix for prompt lookup, then omits the
project-local `.opencode/skills/gdb-debugging` install from the temporary
workspace.

Examples:

```bash
bash eval/run-scenario.sh hang-settlement-cursor
bash eval/run-scenario.sh core-invoice-export
bash eval/run-scenario.sh no-skill/hang-settlement-cursor
bash eval/run-scenario.sh no-skill/core-invoice-export
```

Record real runs in `opencode-results.md`.
