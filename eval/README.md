# OpenCode Evaluation

This directory contains scenario packages for evaluating GDB Lite MCP with and without the repository-local `gdb-debugging` Skill.

Run from the repository root after building the MCP server:

```bash
npm run build
python3 eval/scenarios/build_scenarios.py
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode skill --all
```

Each scenario lives under `eval/scenarios/<name>/`:

```text
public/      files installed into the model workspace
private/     optional build-only inputs, never installed
prompt.md    natural task prompt
oracle.json  manual judgment checklist data
README.md    evaluator-facing notes
Makefile     build/install/clean contract
```

The runner creates a fresh temporary workspace for every round, then calls:

```bash
make -C eval/scenarios/<name> install BUILD_DIR=<round>/build WORKSPACE_DIR=<workspace>
```

The scenario Makefile defines the user-visible mini C project layout, usually
`src/` plus `bin/`. The runner then writes `opencode.json` and installs the
repository-local Skill only for `skill` and `ablation` modes.

`eval/run_eval.py` creates one suite directory under `eval/runs/` per
invocation and one round directory per scenario. Each round stores the prompt,
workspace metadata, raw OpenCode JSON events, stderr, exported OpenCode session
JSON, extracted `summary.json`, `final-answer.md`, and a per-round read-only
`report.md`. The suite directory also contains `suite.json`, a
`manual-eval.json` file for all human judgments in that suite, and a legacy
`report-template.md` aggregate.

Repository-local Skill visibility is controlled by the generated workspace, not
by prompt instructions.

Useful examples:

```bash
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode skill --scenario hang-tokenizer
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode no-skill --all --timeout-sec 600
python3 eval/run_eval.py --model deepseek/deepseek-v4-flash --mode skill --mode no-skill --all --dry-run
```

Each prompt asks the agent to:

1. Debug the target with GDB Lite MCP.
2. Avoid source edits.
3. Report root cause, exact source location, expected versus actual state, and decisive GDB evidence.

No-Skill A/B runs use the same natural prompt as Skill-visible runs. Use
`--mode no-skill --scenario <name>` for a single no-skill run.

The scenario set keeps two small representatives, `crash-sparse-cache` and
`hang-tokenizer`, plus two complex black-box scenarios,
`memory-corruption-binary-bridge` and `wrong-result-risk-buckets`.

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

Oracle hints live in each scenario's `oracle.json`. These files pre-fill the
`manual-eval.json` checklist only; the runner still initializes each judgment
as pending unless a non-pending `summary.json` `final_result` already exists.

For a quick smoke test of the runner without calling OpenCode:

```bash
python3 eval/run_eval.py --mode skill --scenario hang-tokenizer --dry-run
```

Run outputs are written under `eval/runs/`; use `opencode-results.md` only for
local notes when needed.
