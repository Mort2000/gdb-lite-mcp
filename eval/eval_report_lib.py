#!/usr/bin/env python3
"""Shared helpers for GDB Lite eval reports."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from statistics import mean
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
ORACLE_DIR = REPO_ROOT / "eval" / "oracles"
MANUAL_EVAL_FILENAME = "manual-eval.json"
REPORT_FILENAME = "report.md"
MANUAL_SCHEMA_VERSION = 1

RESULT_VALUES = {"pass", "fail", "timeout", "invalid"}
EVIDENCE_VALUES = {"high", "medium", "low"}
CHECKLIST_STATUS_VALUES = {"pass", "fail", "partial", "na"}
ROOT_CAUSE_VALUES = {True, False, "partial"}


class ManualEvalError(Exception):
    """Raised when a manual eval file is missing or incomplete."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def repo_relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path.resolve())


def token_total(summary: dict[str, Any]) -> Any:
    tokens = summary.get("tokens")
    if isinstance(tokens, dict):
        return tokens.get("total")
    return None


def round_key(mode: str, scenario: str, round_number: int) -> str:
    return f"{mode}/{scenario}/round-{round_number:03d}"


def summary_round_key(summary: dict[str, Any]) -> str:
    return round_key(str(summary.get("mode")), str(summary.get("scenario")), int(summary.get("round") or 0))


def table_cell(value: Any) -> str:
    text = "-" if value is None or value == "" else str(value)
    return text.replace("|", "\\|").replace("\n", "<br>")


def boolish_text(value: Any) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    if value == "partial":
        return "partial"
    return "-"


def load_oracle(scenario: str) -> dict[str, Any] | None:
    path = ORACLE_DIR / f"{scenario}.json"
    if not path.is_file():
        return None
    return load_json(path)


def oracle_checklist(scenario: str, default_status: str = "pending") -> list[dict[str, Any]]:
    oracle = load_oracle(scenario)
    if not oracle:
        return [
            {
                "label": "scenario-specific oracle review",
                "status": default_status,
                "text": "No oracle file is present; review final answer manually.",
                "notes": "",
            }
        ]

    items: list[dict[str, Any]] = []
    root_cause = oracle.get("root_cause")
    if root_cause:
        items.append(
            {
                "label": "root cause matches",
                "status": default_status,
                "text": root_cause,
                "notes": "",
            }
        )
    for item in oracle.get("must_mention") or []:
        items.append(
            {
                "label": f"final answer mentions `{item}`",
                "status": default_status,
                "text": str(item),
                "notes": "",
            }
        )
    for item in oracle.get("must_not_claim") or []:
        items.append(
            {
                "label": f"final answer does not claim `{item}`",
                "status": default_status,
                "text": str(item),
                "notes": "",
            }
        )
    return items or [
        {
            "label": "oracle file review",
            "status": default_status,
            "text": "Oracle file has no checklist items.",
            "notes": "",
        }
    ]


def discover_summary_paths(suite_dir: Path) -> list[Path]:
    manifest_path = suite_dir / "suite.json"
    paths: list[Path] = []
    if manifest_path.is_file():
        manifest = load_json(manifest_path)
        for raw_path in manifest.get("per_round_summary_paths") or []:
            path = Path(raw_path)
            if not path.is_absolute():
                path = REPO_ROOT / path
            if path.is_file():
                paths.append(path)
    paths.extend(sorted(suite_dir.glob("*/*/round-*/summary.json")))
    return sorted(dict.fromkeys(paths))


def manifest_summary_path_warnings(suite_dir: Path) -> list[str]:
    manifest_path = suite_dir / "suite.json"
    if not manifest_path.is_file():
        return []
    manifest = load_json(manifest_path)
    raw_paths = manifest.get("per_round_summary_paths") or []
    manifest_paths: set[Path] = set()
    warnings: list[str] = []
    for raw_path in raw_paths:
        path = Path(raw_path)
        if not path.is_absolute():
            path = REPO_ROOT / path
        manifest_paths.add(path.resolve())
        if not path.is_file():
            warnings.append(f"suite.json references missing summary: {repo_relative(path)}")

    for path in sorted(suite_dir.glob("*/*/round-*/summary.json")):
        if path.resolve() not in manifest_paths:
            warnings.append(f"summary exists but is absent from suite.json: {repo_relative(path)}")
    return warnings


def load_round_records(suite_dir: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for summary_path in discover_summary_paths(suite_dir):
        summary = load_json(summary_path)
        records.append({"summary_path": summary_path, "summary": summary, "key": summary_round_key(summary)})
    return sorted(
        records,
        key=lambda record: (
            str(record["summary"].get("mode")),
            str(record["summary"].get("scenario")),
            int(record["summary"].get("round") or 0),
        ),
    )


def suite_id(suite_dir: Path) -> str:
    manifest_path = suite_dir / "suite.json"
    if manifest_path.is_file():
        manifest = load_json(manifest_path)
        if manifest.get("suite_id"):
            return str(manifest["suite_id"])
    return suite_dir.name


def final_result_template_from_summary(summary: dict[str, Any]) -> dict[str, Any]:
    final_result = summary.get("final_result")
    if not isinstance(final_result, dict):
        final_result = {}

    status = final_result.get("status")
    passed = final_result.get("passed")
    if status not in RESULT_VALUES:
        if passed is True:
            status = "pass"
        elif passed is False:
            status = "fail"
        else:
            status = "pending"

    checklist_status = "pass" if status == "pass" else "pending"
    return {
        "mode": summary.get("mode"),
        "scenario": summary.get("scenario"),
        "round": summary.get("round"),
        "result": status,
        "root_cause_correct": final_result.get("root_cause_correct"),
        "failed_round": "",
        "evidence_quality": final_result.get("evidence_quality"),
        "notes": final_result.get("notes") or "",
        "checklist": oracle_checklist(str(summary.get("scenario")), default_status=checklist_status),
    }


def merge_judgment(template: dict[str, Any], existing: dict[str, Any] | None) -> dict[str, Any]:
    if not existing:
        return template
    merged = dict(template)
    for field in ("result", "root_cause_correct", "failed_round", "evidence_quality", "notes"):
        if field in existing:
            merged[field] = existing[field]
    if isinstance(existing.get("checklist"), list):
        merged["checklist"] = existing["checklist"]
    return merged


def build_manual_eval(suite_dir: Path, records: list[dict[str, Any]], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing_rounds = (existing or {}).get("rounds")
    if not isinstance(existing_rounds, dict):
        existing_rounds = {}
    manual = {
        "schema_version": MANUAL_SCHEMA_VERSION,
        "suite_id": suite_id(suite_dir),
        "instructions": (
            "Fill every round before publishing report.md. result must be one of "
            "pass/fail/timeout/invalid; root_cause_correct must be true/false/partial; "
            "evidence_quality must be high/medium/low; every checklist status must be "
            "pass/fail/partial/na."
        ),
        "rounds": {},
    }
    for record in records:
        key = record["key"]
        template = final_result_template_from_summary(record["summary"])
        manual["rounds"][key] = merge_judgment(template, existing_rounds.get(key))
    return manual


def ensure_manual_eval(suite_dir: Path) -> dict[str, Any]:
    manual_path = suite_dir / MANUAL_EVAL_FILENAME
    existing = load_json(manual_path) if manual_path.is_file() else None
    manual = build_manual_eval(suite_dir, load_round_records(suite_dir), existing=existing)
    write_json(manual_path, manual)
    return manual


def validate_manual_eval(suite_dir: Path, records: list[dict[str, Any]], manual: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    errors.extend(manifest_summary_path_warnings(suite_dir))
    rounds = manual.get("rounds")
    if not isinstance(rounds, dict):
        return [f"{MANUAL_EVAL_FILENAME}: missing object field `rounds`"]

    expected_keys = {record["key"] for record in records}
    manual_keys = set(rounds)
    for key in sorted(expected_keys - manual_keys):
        errors.append(f"{key}: missing manual judgment")
    for key in sorted(manual_keys - expected_keys):
        errors.append(f"{key}: manual judgment has no matching summary.json")

    for key in sorted(expected_keys & manual_keys):
        judgment = rounds.get(key)
        if not isinstance(judgment, dict):
            errors.append(f"{key}: judgment must be an object")
            continue

        result = judgment.get("result")
        if result not in RESULT_VALUES:
            errors.append(f"{key}: result must be one of {sorted(RESULT_VALUES)}, got {result!r}")

        root_cause_correct = judgment.get("root_cause_correct")
        if root_cause_correct not in ROOT_CAUSE_VALUES:
            errors.append(f"{key}: root_cause_correct must be true, false, or 'partial'")

        evidence_quality = judgment.get("evidence_quality")
        if evidence_quality not in EVIDENCE_VALUES:
            errors.append(f"{key}: evidence_quality must be one of {sorted(EVIDENCE_VALUES)}")

        if "notes" not in judgment or not isinstance(judgment.get("notes"), str):
            errors.append(f"{key}: notes must be present as a string")

        checklist = judgment.get("checklist")
        if not isinstance(checklist, list) or not checklist:
            errors.append(f"{key}: checklist must be a non-empty list")
            continue
        for index, item in enumerate(checklist, start=1):
            if not isinstance(item, dict):
                errors.append(f"{key}: checklist item {index} must be an object")
                continue
            status = item.get("status")
            if status not in CHECKLIST_STATUS_VALUES:
                errors.append(
                    f"{key}: checklist item {index} status must be one of {sorted(CHECKLIST_STATUS_VALUES)}, got {status!r}"
                )
            if "label" not in item and "text" not in item:
                errors.append(f"{key}: checklist item {index} needs label or text")

    return errors


def load_manual_eval(suite_dir: Path) -> dict[str, Any]:
    manual_path = suite_dir / MANUAL_EVAL_FILENAME
    if not manual_path.is_file():
        raise ManualEvalError([f"missing {manual_path}; run summarize_run.py --init-manual first"])
    return load_json(manual_path)


def records_with_judgments(suite_dir: Path, allow_incomplete: bool = False) -> list[dict[str, Any]]:
    records = load_round_records(suite_dir)
    manual = load_manual_eval(suite_dir)
    errors = validate_manual_eval(suite_dir, records, manual)
    if errors and not allow_incomplete:
        raise ManualEvalError(errors)

    rounds = manual.get("rounds") if isinstance(manual.get("rounds"), dict) else {}
    joined = []
    for record in records:
        joined.append({**record, "judgment": rounds.get(record["key"], {})})
    return joined


def render_suite_report(suite_dir: Path, allow_incomplete: bool = False) -> str:
    records = records_with_judgments(suite_dir, allow_incomplete=allow_incomplete)
    validation_errors: list[str] = []
    if allow_incomplete:
        manual = load_manual_eval(suite_dir)
        validation_errors = validate_manual_eval(suite_dir, load_round_records(suite_dir), manual)

    result_counts = Counter(str(record["judgment"].get("result") or "pending") for record in records)
    used_values = [int(record["summary"].get("used_ms") or 0) for record in records]
    gdb_values = [int(record["summary"].get("gdb_command_count") or 0) for record in records]

    lines = [
        "# Eval Suite Report",
        "",
        f"- Suite: {suite_id(suite_dir)}",
        f"- Directory: `{repo_relative(suite_dir)}`",
        f"- Manual eval: `{MANUAL_EVAL_FILENAME}`",
        f"- Validation: {'incomplete' if validation_errors else 'complete'}",
        "",
        "## Summary",
        "",
        f"- Total rounds: {len(records)}",
        f"- Pass: {result_counts.get('pass', 0)}",
        f"- Fail: {result_counts.get('fail', 0)}",
        f"- Timeout: {result_counts.get('timeout', 0)}",
        f"- Invalid: {result_counts.get('invalid', 0)}",
        f"- Average used ms: {int(mean(used_values)) if used_values else 0}",
        f"- Total GDB commands: {sum(gdb_values)}",
        "",
    ]
    if validation_errors:
        lines.extend(["## Validation Errors", ""])
        lines.extend(f"- {error}" for error in validation_errors)
        lines.append("")

    lines.extend(
        [
            "## Rounds",
            "",
            "| Mode | Scenario | Round | Exit | Timeout | Used ms | Tokens | Cost | GDB cmds | Skill reads | Result | Root cause | Evidence | Notes |",
            "| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |",
        ]
    )
    for record in records:
        summary = record["summary"]
        judgment = record["judgment"]
        skill_reads = ", ".join(summary.get("skill_reads") or []) or "-"
        lines.append(
            "| {mode} | {scenario} | {round} | {exit_code} | {timed_out} | {used_ms} | {tokens} | {cost} | {gdb} | {skills} | {result} | {root} | {evidence} | {notes} |".format(
                mode=table_cell(summary.get("mode")),
                scenario=table_cell(summary.get("scenario")),
                round=table_cell(summary.get("round")),
                exit_code=table_cell(summary.get("exit_code")),
                timed_out=table_cell(summary.get("timed_out")),
                used_ms=table_cell(summary.get("used_ms")),
                tokens=table_cell(token_total(summary)),
                cost=table_cell(summary.get("cost")),
                gdb=table_cell(summary.get("gdb_command_count")),
                skills=table_cell(skill_reads),
                result=table_cell(judgment.get("result")),
                root=table_cell(boolish_text(judgment.get("root_cause_correct"))),
                evidence=table_cell(judgment.get("evidence_quality")),
                notes=table_cell(judgment.get("notes")),
            )
        )
    lines.append("")

    lines.extend(["## Manual Checklist", ""])
    for record in records:
        judgment = record["judgment"]
        lines.append(f"### {record['key']}")
        lines.append("")
        lines.append(f"- Result: {judgment.get('result', '-')}")
        lines.append(f"- Root cause correct: {boolish_text(judgment.get('root_cause_correct'))}")
        lines.append(f"- Evidence quality: {judgment.get('evidence_quality', '-')}")
        if judgment.get("failed_round"):
            lines.append(f"- Failed round: {judgment.get('failed_round')}")
        if judgment.get("notes"):
            lines.append(f"- Notes: {judgment.get('notes')}")
        lines.append("")
        for item in judgment.get("checklist") or []:
            label = item.get("label") or item.get("text") or "check"
            notes = f" — {item.get('notes')}" if item.get("notes") else ""
            lines.append(f"- {str(item.get('status', '-')).upper()}: {label}{notes}")
        lines.append("")
    return "\n".join(lines)


def write_suite_report(suite_dir: Path, allow_incomplete: bool = False) -> Path:
    report = render_suite_report(suite_dir, allow_incomplete=allow_incomplete)
    report_path = suite_dir / REPORT_FILENAME
    report_path.write_text(report, encoding="utf-8")
    return report_path


def aggregate_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    result_counts = Counter(str(record["judgment"].get("result") or "pending") for record in records)
    used_values = [int(record["summary"].get("used_ms") or 0) for record in records]
    return {
        "total": len(records),
        "pass": result_counts.get("pass", 0),
        "fail": result_counts.get("fail", 0),
        "timeout": result_counts.get("timeout", 0),
        "invalid": result_counts.get("invalid", 0),
        "avg_used_ms": int(mean(used_values)) if used_values else 0,
        "total_gdb_commands": sum(int(record["summary"].get("gdb_command_count") or 0) for record in records),
    }
