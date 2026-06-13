import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
LIB_PATH = REPO_ROOT / "eval" / "eval_report_lib.py"
COMPARE_PATH = REPO_ROOT / "eval" / "compare_runs.py"
sys.path.insert(0, str(REPO_ROOT / "eval"))

SPEC = importlib.util.spec_from_file_location("eval_report_lib", LIB_PATH)
eval_report_lib = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(eval_report_lib)

COMPARE_SPEC = importlib.util.spec_from_file_location("compare_runs", COMPARE_PATH)
compare_runs = importlib.util.module_from_spec(COMPARE_SPEC)
assert COMPARE_SPEC.loader is not None
COMPARE_SPEC.loader.exec_module(compare_runs)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def make_suite(root: Path, name: str, mode: str, used_ms: int, gdb_count: int, skill_reads: list[str]) -> Path:
    suite = root / name
    summary_path = suite / mode / "hang-tokenizer" / "round-001" / "summary.json"
    summary = {
        "scenario": "hang-tokenizer",
        "mode": mode,
        "round": 1,
        "model": "fake/model",
        "effort": "default",
        "session_id": "ses_test",
        "exit_code": 0,
        "timed_out": False,
        "used_ms": used_ms,
        "tokens": {"total": 100},
        "cost": 0.01,
        "tool_calls": [],
        "gdb_command_count": gdb_count,
        "file_reads": [],
        "skill_reads": skill_reads,
        "final_answer": "underscore branch does not advance pos; continue increments tokens forever",
        "final_result": {
            "status": "pass",
            "passed": True,
            "judge": "manual",
            "root_cause_correct": True,
            "evidence_quality": "high",
            "notes": f"{mode} note",
        },
    }
    write_json(summary_path, summary)
    write_json(
        suite / "suite.json",
        {
            "suite_id": name,
            "per_round_summary_paths": [str(summary_path.relative_to(REPO_ROOT)) if summary_path.is_relative_to(REPO_ROOT) else str(summary_path)],
        },
    )
    return suite


class EvalReportTest(unittest.TestCase):
    def test_manual_eval_initializes_from_summary_and_renders_report(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as tmp:
            suite = make_suite(Path(tmp), "suite-a", "skill", 1000, 2, ["gdb-debugging"])

            manual = eval_report_lib.ensure_manual_eval(suite)
            key = "skill/hang-tokenizer/round-001"
            self.assertEqual(manual["rounds"][key]["result"], "pass")
            self.assertTrue(manual["rounds"][key]["root_cause_correct"])
            self.assertEqual(manual["rounds"][key]["evidence_quality"], "high")

            errors = eval_report_lib.validate_manual_eval(suite, eval_report_lib.load_round_records(suite), manual)
            self.assertEqual(errors, [])

            report_path = eval_report_lib.write_suite_report(suite)
            report = report_path.read_text(encoding="utf-8")
            self.assertIn("| skill | hang-tokenizer | 1 |", report)
            self.assertIn("| gdb-debugging | pass | yes | high | skill note |", report)

    def test_manual_eval_validation_rejects_pending_values(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as tmp:
            suite = make_suite(Path(tmp), "suite-pending", "skill", 1000, 2, [])
            manual = eval_report_lib.ensure_manual_eval(suite)
            key = "skill/hang-tokenizer/round-001"
            manual["rounds"][key]["result"] = "pending"
            manual["rounds"][key]["checklist"][0]["status"] = "pending"

            errors = eval_report_lib.validate_manual_eval(suite, eval_report_lib.load_round_records(suite), manual)
            self.assertTrue(any("result must be one of" in error for error in errors))
            self.assertTrue(any("checklist item 1 status" in error for error in errors))

    def test_compare_runs_renders_aggregate_and_pairwise_delta(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as tmp:
            root = Path(tmp)
            first = make_suite(root, "baseline", "no-skill", 2000, 5, [])
            second = make_suite(root, "candidate", "skill", 1500, 3, ["gdb-debugging"])
            eval_report_lib.ensure_manual_eval(first)
            eval_report_lib.ensure_manual_eval(second)

            suites = [
                compare_runs.load_suite(first, allow_incomplete=False),
                compare_runs.load_suite(second, allow_incomplete=False),
            ]
            report = compare_runs.render_comparison(suites)
            self.assertIn("| baseline |", report)
            self.assertIn("| candidate |", report)
            self.assertIn("No matching `(mode, scenario, round)` rows for pairwise delta.", report)

            cross_mode_report = compare_runs.render_comparison(suites, match_key="scenario-round")
            self.assertIn("Match key: `scenario-round`", cross_mode_report)
            self.assertIn("| hang-tokenizer | 1 | pass -> pass | -500 | -2 | gdb-debugging | skill note |", cross_mode_report)

    def test_compare_runs_pairwise_delta_matches_mode_scenario_and_round(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as tmp:
            root = Path(tmp)
            first = make_suite(root, "baseline", "skill", 2000, 5, ["gdb-debugging"])
            second = make_suite(root, "candidate", "skill", 1500, 3, ["gdb-debugging"])
            eval_report_lib.ensure_manual_eval(first)
            eval_report_lib.ensure_manual_eval(second)

            suites = [
                compare_runs.load_suite(first, allow_incomplete=False),
                compare_runs.load_suite(second, allow_incomplete=False),
            ]
            report = compare_runs.render_comparison(suites)
            self.assertIn("| hang-tokenizer | 1 | pass -> pass | -500 | -2 | gdb-debugging | skill note |", report)

    def test_discovery_unions_manifest_and_filesystem_and_warns(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO_ROOT) as tmp:
            root = Path(tmp)
            suite = make_suite(root, "suite-manifest", "skill", 1000, 2, ["gdb-debugging"])
            extra_summary = suite / "skill" / "crash-sparse-cache" / "round-001" / "summary.json"
            write_json(
                extra_summary,
                {
                    "scenario": "crash-sparse-cache",
                    "mode": "skill",
                    "round": 1,
                    "used_ms": 2000,
                    "gdb_command_count": 4,
                    "skill_reads": ["gdb-debugging"],
                    "tokens": {"total": 10},
                    "final_result": {
                        "status": "pass",
                        "passed": True,
                        "root_cause_correct": True,
                        "evidence_quality": "high",
                        "notes": "extra",
                    },
                },
            )

            records = eval_report_lib.load_round_records(suite)
            self.assertEqual(len(records), 2)
            manual = eval_report_lib.ensure_manual_eval(suite)
            errors = eval_report_lib.validate_manual_eval(suite, records, manual)
            self.assertTrue(any("absent from suite.json" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
