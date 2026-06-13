#!/usr/bin/env python3
"""Build a suite report from system summaries plus manual eval JSON."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from eval_report_lib import (
    MANUAL_EVAL_FILENAME,
    ManualEvalError,
    ensure_manual_eval,
    load_manual_eval,
    load_round_records,
    repo_relative,
    validate_manual_eval,
    write_suite_report,
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate manual eval JSON and render suite report.md.")
    parser.add_argument("suite_dir", type=Path, help="Directory under eval/runs containing suite.json and round summaries.")
    parser.add_argument("--init-manual", action="store_true", help=f"Create or update {MANUAL_EVAL_FILENAME}.")
    parser.add_argument("--check", action="store_true", help="Validate manual eval completeness.")
    parser.add_argument("--write-report", action="store_true", help="Write report.md from summary.json plus manual eval.")
    parser.add_argument("--allow-incomplete", action="store_true", help="Allow report.md to be written with validation errors.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    suite_dir = args.suite_dir.resolve()
    if not suite_dir.is_dir():
        print(f"not a directory: {suite_dir}", file=sys.stderr)
        return 2

    run_all = not (args.init_manual or args.check or args.write_report)
    init_manual = args.init_manual or run_all
    check = args.check or run_all
    write_report = args.write_report or run_all

    if init_manual:
        manual = ensure_manual_eval(suite_dir)
        print(f"manual eval: {repo_relative(suite_dir / MANUAL_EVAL_FILENAME)} ({len(manual.get('rounds') or {})} rounds)")

    if check:
        try:
            manual = load_manual_eval(suite_dir)
        except ManualEvalError as exc:
            for error in exc.errors:
                print(error, file=sys.stderr)
            return 1
        errors = validate_manual_eval(suite_dir, load_round_records(suite_dir), manual)
        if errors:
            for error in errors:
                print(error, file=sys.stderr)
            if not args.allow_incomplete:
                return 1
        else:
            print("manual eval complete")

    if write_report:
        try:
            report_path = write_suite_report(suite_dir, allow_incomplete=args.allow_incomplete)
        except ManualEvalError as exc:
            for error in exc.errors:
                print(error, file=sys.stderr)
            return 1
        print(f"report: {repo_relative(report_path)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

