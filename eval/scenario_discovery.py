"""Scenario discovery helpers shared by eval runners and build tooling."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parent
SCENARIO_ROOT = EVAL_DIR / "scenarios"


@dataclass(frozen=True)
class Scenario:
    name: str
    path: Path

    @property
    def prompt_path(self) -> Path:
        return self.path / "prompt.md"

    @property
    def oracle_path(self) -> Path:
        return self.path / "oracle.json"

    @property
    def makefile_path(self) -> Path:
        return self.path / "Makefile"

    @property
    def public_dir(self) -> Path:
        return self.path / "public"

    @property
    def disabled_path(self) -> Path:
        return self.path / ".disabled"

    @property
    def enabled(self) -> bool:
        return not self.disabled_path.exists()

    @property
    def runnable(self) -> bool:
        return self.enabled and self.prompt_path.is_file() and self.makefile_path.is_file()


def scenario_root(root: Path | None = None) -> Path:
    return root or SCENARIO_ROOT


def _normalize_requested(names: Iterable[str]) -> list[str]:
    normalized: list[str] = []
    for name in names:
        value = name.removesuffix(".md").strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def discover_scenarios(root: Path | None = None) -> list[Scenario]:
    root = scenario_root(root)
    if not root.is_dir():
        return []
    scenarios: list[Scenario] = []
    for path in root.iterdir():
        if not path.is_dir():
            continue
        scenario = Scenario(path.name, path)
        if scenario.runnable:
            scenarios.append(scenario)
    return sorted(scenarios, key=lambda item: item.name)


def require_scenarios(names: Iterable[str], root: Path | None = None) -> list[Scenario]:
    root = scenario_root(root)
    requested = _normalize_requested(names)
    if not requested:
        return discover_scenarios(root)

    scenarios: list[Scenario] = []
    errors: list[str] = []
    for name in requested:
        path = root / name
        scenario = Scenario(name, path)
        if not path.is_dir():
            errors.append(f"{name}: scenario directory not found under {root}")
        elif scenario.disabled_path.exists():
            errors.append(f"{name}: scenario is disabled by {scenario.disabled_path}")
        elif not scenario.prompt_path.is_file():
            errors.append(f"{name}: missing prompt.md")
        elif not scenario.makefile_path.is_file():
            errors.append(f"{name}: missing Makefile")
        else:
            scenarios.append(scenario)
    if errors:
        raise ValueError("\n".join(errors))
    return sorted(scenarios, key=lambda item: item.name)


def scenario_names(root: Path | None = None) -> list[str]:
    return [scenario.name for scenario in discover_scenarios(root)]
