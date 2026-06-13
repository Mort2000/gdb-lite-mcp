#!/usr/bin/env python3
"""Compare evaluated GDB Lite MCP run directories."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from eval_report_lib import (
    ManualEvalError,
    aggregate_records,
    records_with_judgments,
    repo_relative,
    suite_id,
    table_cell,
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare manual eval results and runtime metrics across suite directories.")
    parser.add_argument("suite_dirs", nargs="+", type=Path, help="Suite directories under eval/runs.")
    parser.add_argument("-o", "--output", type=Path, help="Write markdown comparison report to this path.")
    parser.add_argument("--allow-incomplete", action="store_true", help="Allow pending or incomplete manual eval files.")
    parser.add_argument(
        "--match-key",
        choices=["mode-scenario-round", "scenario-round"],
        default="mode-scenario-round",
        help="Pairwise delta key. Use scenario-round to compare skill vs no-skill suites.",
    )
    return parser.parse_args(argv)


def load_suite(suite_dir: Path, allow_incomplete: bool) -> dict[str, object]:
    resolved = suite_dir.resolve()
    records = records_with_judgments(resolved, allow_incomplete=allow_incomplete)
    return {
        "suite_dir": resolved,
        "suite_id": suite_id(resolved),
        "records": records,
        "aggregate": aggregate_records(records),
    }


def round_identity(record: dict[str, object], match_key: str = "mode-scenario-round") -> tuple[object, ...]:
    summary = record["summary"]
    assert isinstance(summary, dict)
    if match_key == "scenario-round":
        return (summary.get("scenario"), summary.get("round"))
    return (summary.get("mode"), summary.get("scenario"), summary.get("round"))


def skill_reads_text(record: dict[str, object]) -> str:
    summary = record["summary"]
    assert isinstance(summary, dict)
    return ", ".join(summary.get("skill_reads") or []) or "-"


def keyed_records(records: list[dict[str, object]], match_key: str, suite_name: object) -> tuple[dict[tuple[object, ...], dict[str, object]], list[str]]:
    keyed: dict[tuple[object, ...], dict[str, object]] = {}
    errors: list[str] = []
    for record in records:
        key = round_identity(record, match_key)
        if key in keyed:
            errors.append(f"{suite_name}: duplicate pairwise key {key!r}; use a stricter --match-key")
        keyed[key] = record
    return keyed, errors


def render_comparison(suites: list[dict[str, object]], match_key: str = "mode-scenario-round") -> str:
    lines = [
        "# Eval Run Comparison",
        "",
        "## Runs",
        "",
        "| Run | Directory | Total | Pass | Fail | Timeout | Invalid | Avg used ms | Total GDB cmds |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for suite in suites:
        aggregate = suite["aggregate"]
        assert isinstance(aggregate, dict)
        lines.append(
            "| {run} | `{directory}` | {total} | {passed} | {failed} | {timeout} | {invalid} | {avg} | {gdb} |".format(
                run=table_cell(suite["suite_id"]),
                directory=table_cell(repo_relative(suite["suite_dir"])),
                total=aggregate["total"],
                passed=aggregate["pass"],
                failed=aggregate["fail"],
                timeout=aggregate["timeout"],
                invalid=aggregate["invalid"],
                avg=aggregate["avg_used_ms"],
                gdb=aggregate["total_gdb_commands"],
            )
        )
    lines.extend(
        [
            "",
            "## Rounds",
            "",
            "| Scenario | Round | Run | Mode | Result | Used ms | GDB cmds | Skill reads | Notes |",
            "| --- | ---: | --- | --- | --- | ---: | ---: | --- | --- |",
        ]
    )

    all_rows: list[tuple[str, int, dict[str, object], dict[str, object]]] = []
    for suite in suites:
        records = suite["records"]
        assert isinstance(records, list)
        for record in records:
            summary = record["summary"]
            assert isinstance(summary, dict)
            all_rows.append((str(summary.get("scenario")), int(summary.get("round") or 0), suite, record))
    for _, _, suite, record in sorted(all_rows, key=lambda row: (row[0], row[1], str(row[2]["suite_id"]))):
        summary = record["summary"]
        judgment = record["judgment"]
        assert isinstance(summary, dict)
        assert isinstance(judgment, dict)
        lines.append(
            "| {scenario} | {round} | {run} | {mode} | {result} | {used} | {gdb} | {skills} | {notes} |".format(
                scenario=table_cell(summary.get("scenario")),
                round=table_cell(summary.get("round")),
                run=table_cell(suite["suite_id"]),
                mode=table_cell(summary.get("mode")),
                result=table_cell(judgment.get("result")),
                used=table_cell(summary.get("used_ms")),
                gdb=table_cell(summary.get("gdb_command_count")),
                skills=table_cell(skill_reads_text(record)),
                notes=table_cell(judgment.get("notes")),
            )
        )

    if len(suites) == 2:
        first, second = suites
        first_records, first_errors = keyed_records(first["records"], match_key, first["suite_id"])  # type: ignore[index, union-attr]
        second_records, second_errors = keyed_records(second["records"], match_key, second["suite_id"])  # type: ignore[index, union-attr]
        common_keys = sorted(set(first_records) & set(second_records))
        lines.extend(
            [
                "",
                f"## Pairwise Delta ({second['suite_id']} minus {first['suite_id']})",
                "",
                f"Match key: `{match_key}`",
                "",
                "| Scenario | Round | Result change | Used ms delta | GDB cmd delta | Skill reads | Notes |",
                "| --- | ---: | --- | ---: | ---: | --- | --- |",
            ]
        )
        for error in first_errors + second_errors:
            lines.append(f"| - | - | ERROR: {table_cell(error)} | - | - | - | - |")
        if not common_keys:
            lines.append("")
            label = "`(mode, scenario, round)`" if match_key == "mode-scenario-round" else "`(scenario, round)`"
            lines.append(f"No matching {label} rows for pairwise delta.")
        for key in common_keys:
            base = first_records[key]
            candidate = second_records[key]
            base_summary = base["summary"]
            candidate_summary = candidate["summary"]
            base_judgment = base["judgment"]
            candidate_judgment = candidate["judgment"]
            used_delta = int(candidate_summary.get("used_ms") or 0) - int(base_summary.get("used_ms") or 0)
            gdb_delta = int(candidate_summary.get("gdb_command_count") or 0) - int(base_summary.get("gdb_command_count") or 0)
            result_change = f"{base_judgment.get('result', '-')} -> {candidate_judgment.get('result', '-')}"
            lines.append(
                "| {scenario} | {round} | {result} | {used_delta} | {gdb_delta} | {skills} | {notes} |".format(
                    scenario=table_cell(candidate_summary.get("scenario")),
                    round=table_cell(candidate_summary.get("round")),
                    result=table_cell(result_change),
                    used_delta=used_delta,
                    gdb_delta=gdb_delta,
                    skills=table_cell(skill_reads_text(candidate)),
                    notes=table_cell(candidate_judgment.get("notes")),
                )
            )

    lines.append("")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        suites = [load_suite(path, allow_incomplete=args.allow_incomplete) for path in args.suite_dirs]
    except ManualEvalError as exc:
        for error in exc.errors:
            print(error, file=sys.stderr)
        return 1

    report = render_comparison(suites, match_key=args.match_key)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
        print(f"comparison: {repo_relative(args.output)}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
