#!/usr/bin/env python3
"""Build eval scenario artifacts via each scenario Makefile."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


EVAL_DIR = Path(__file__).resolve().parents[1]
if str(EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_DIR))

from scenario_discovery import Scenario, require_scenarios


def repo_relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(EVAL_DIR.parent))
    except ValueError:
        return str(path.resolve())


def run_make(scenario: Scenario, target: str) -> int:
    build_dir = scenario.path / "build"
    cmd = ["make", "-C", str(scenario.path), target, f"BUILD_DIR={build_dir}"]
    print(f"[{target}] {scenario.name}: {' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.run(cmd, text=True, check=False)
    if proc.returncode != 0:
        print(
            f"failed {target} for {scenario.name}\n"
            f"  Makefile: {repo_relative(scenario.makefile_path)}\n"
            f"  command: {' '.join(cmd)}",
            file=sys.stderr,
        )
    return proc.returncode


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build eval scenarios from eval/scenarios/*/Makefile.")
    parser.add_argument("--scenario", action="append", default=[], help="Scenario name; repeatable. Defaults to all.")
    parser.add_argument("--clean", action="store_true", help="Run make clean instead of make build.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        scenarios = require_scenarios(args.scenario)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if not scenarios:
        print("no enabled scenarios found", file=sys.stderr)
        return 2

    target = "clean" if args.clean else "build"
    failures: list[str] = []
    for scenario in scenarios:
        if run_make(scenario, target) != 0:
            failures.append(scenario.name)

    if failures:
        print(f"{target} failed for: {', '.join(failures)}", file=sys.stderr)
        return 1

    print(f"{target} succeeded for {len(scenarios)} scenario(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
