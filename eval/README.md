# OpenCode Evaluation

This directory contains natural prompts for evaluating GDB Lite MCP with and without the repository-local `gdb-debugging` Skill.

Run from the repository root after building the MCP server and scenarios:

```bash
npm run build
bash scenarios/build-all.sh
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode skill --all
```

`eval/run_eval.py` creates one suite directory under `eval/runs/` per
invocation and one round directory per scenario. Each round stores the prompt,
workspace metadata, raw OpenCode JSON events, stderr, exported OpenCode session
JSON, extracted `summary.json`, `final-answer.md`, and a per-round read-only
`report.md`. The suite directory also contains `suite.json`, a
`manual-eval.json` file for all human judgments in that suite, and a legacy
`report-template.md` aggregate.

The runner creates an isolated workspace for each round, writes an
`opencode.json` that starts the MCP server from the built repository
`dist/index.js`, and copies `scenarios/` into that workspace. `skill` and
`ablation` modes install the repository-local Skill under `.opencode/skills/`;
`no-skill` mode omits that project Skill. Repository-local Skill visibility is
controlled by the generated workspace, not by prompt instructions.

Useful examples:

```bash
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode skill --scenario hang-tokenizer
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode no-skill --all --timeout-sec 300
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode skill --mode no-skill --all --dry-run
```

Each prompt asks the agent to:

1. Debug the target with GDB Lite MCP.
2. Avoid source edits.
3. Report root cause, exact source location, expected versus actual state, and decisive GDB evidence.

No-Skill A/B runs use the same natural prompt as Skill-visible runs. Use
`--mode no-skill --scenario <name>` for a single no-skill run.

Final correctness remains a manual judgment. `summary.json` records objective
runtime data such as exit code, timeout, token/cost fields when exported by
OpenCode, tool calls, GDB commands, file reads, Skill reads, and final answer,
but a zero process exit code is not a pass/fail signal.

Human judgment should be filled only in the suite-level `manual-eval.json`.
After editing it, validate completeness and render the suite-level
`report.md`:

```bash
python3 eval/summarize_run.py eval/runs/<suite-id>
```

To initialize or refresh `manual-eval.json` without rendering a report:

```bash
python3 eval/summarize_run.py eval/runs/<suite-id> --init-manual
```

To compare multiple completed suite directories:

```bash
python3 eval/compare_runs.py eval/runs/<baseline-suite> eval/runs/<candidate-suite> -o eval/runs/compare-report.md
```

Optional oracle hints can be added under `eval/oracles/<scenario>.json`. These
files pre-fill the `manual-eval.json` checklist only; the runner still
initializes each judgment as pending unless a non-pending `summary.json`
`final_result` already exists.

For a quick smoke test of the runner without calling OpenCode:

```bash
python3 eval/run_eval.py --mode skill --scenario wrong-result-ledger --dry-run
```

Record real runs in `opencode-results.md`.
