import importlib.util
import json
import os
import tempfile
import textwrap
import unittest
from argparse import Namespace
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_EVAL_PATH = REPO_ROOT / "eval" / "run_eval.py"
SPEC = importlib.util.spec_from_file_location("run_eval", RUN_EVAL_PATH)
run_eval = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(run_eval)


GDB_SESSION_ID = "81a80d2e-1111-2222-3333-444455556666"


class RunEvalTest(unittest.TestCase):
    def fake_opencode(self, tmpdir: Path) -> str:
        script = tmpdir / "fake_opencode.py"
        fake_source = textwrap.dedent(
            """\
                #!/usr/bin/env python3
                import json
                import sys

                session = {
                    "info": {
                        "id": "ses_eval_test",
                        "model": {"providerID": "fake-provider", "id": "fake-model", "variant": "low"},
                        "tokens": {"input": 10, "output": 5, "reasoning": 1, "cache": {"read": 2, "write": 3}},
                        "cost": 0.01,
                        "time": {"created": 1000, "updated": 2500},
                    },
                    "messages": [
                        {
                            "role": "assistant",
                            "parts": [
                                {"type": "tool", "tool": "read", "callID": "read1", "state": {"status": "completed", "input": {"filePath": "scenarios/foo.c"}, "output": "ok"}},
                                {"type": "tool", "tool": "skill", "callID": "skill1", "state": {"status": "completed", "input": {"name": "gdb-debugging"}, "output": "ok"}},
                                {"type": "tool", "tool": "gdb-lite_gdb_spawn", "callID": "spawn1", "state": {"status": "completed", "input": {"prog_path": "scenarios/bin/foo", "work_dir": "/tmp/work"}, "output": "__GDB_SESSION_ID__"}},
                                {"type": "tool", "tool": "gdb-lite_gdb_exec", "callID": "exec1", "state": {"status": "completed", "input": {"session_id": "__GDB_SESSION_ID__", "command": "bt\\nprint x"}, "output": "ok"}},
                                {"type": "tool", "tool": "gdb-lite_gdb_interrupt", "callID": "int1", "state": {"status": "completed", "input": {"session_id": "__GDB_SESSION_ID__"}}},
                                {"type": "tool", "tool": "gdb-lite_gdb_close", "callID": "close1", "state": {"status": "completed", "input": {"session_id": "__GDB_SESSION_ID__"}}},
                                {"type": "text", "text": "Final answer text"},
                            ],
                        }
                    ],
                }

                if len(sys.argv) > 1 and sys.argv[1] == "--version":
                    print("1.17.1")
                elif len(sys.argv) > 1 and sys.argv[1] == "run":
                    print(json.dumps({"type": "session.created", "id": "ses_eval_test"}))
                elif len(sys.argv) > 1 and sys.argv[1] == "export":
                    print(json.dumps(session))
                    print("Exporting session: ses_eval_test", file=sys.stderr)
                elif len(sys.argv) > 2 and sys.argv[1:3] == ["session", "list"]:
                    print("[]")
                else:
                    print("unexpected fake opencode args: " + repr(sys.argv), file=sys.stderr)
                    sys.exit(2)
                """
        ).replace("__GDB_SESSION_ID__", GDB_SESSION_ID)
        script.write_text(fake_source, encoding="utf-8")
        script.chmod(0o755)
        return str(script)

    def test_run_round_extracts_artifacts_without_export_stderr_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            suite_dir = tmpdir / "suite"
            suite_dir.mkdir()
            args = Namespace(model="fake/provider-model", variant="low", timeout_sec=5, keep_workspace=False)
            manifest = {"per_round_summary_paths": [], "rounds": []}
            summaries = []

            run_eval.run_round(
                suite_dir=suite_dir,
                manifest=manifest,
                summaries=summaries,
                args=args,
                opencode_bin=self.fake_opencode(tmpdir),
                mode="skill",
                scenario="wrong-result-ledger",
                round_number=1,
            )

            round_dir = suite_dir / "skill" / "wrong-result-ledger" / "round-001"
            summary = json.loads((round_dir / "summary.json").read_text(encoding="utf-8"))
            prompt = (round_dir / "prompt.md").read_text(encoding="utf-8")
            self.assertIsNone(summary["export_error"])
            self.assertTrue(prompt.startswith("/gdb-debugging "))
            self.assertEqual(summary["session_id"], "ses_eval_test")
            self.assertEqual(summary["final_answer"], "Final answer text\n")
            self.assertEqual(summary["provider_id"], "fake-provider")
            self.assertEqual(summary["tokens"]["total"], 21)
            self.assertEqual(summary["gdb_commands"], ["bt\nprint x"])
            self.assertEqual(summary["gdb_command_lines"], ["bt", "print x"])
            self.assertEqual(summary["file_reads"], ["scenarios/foo.c"])
            self.assertEqual(summary["skill_reads"], ["gdb-debugging"])
            self.assertEqual(summary["gdb_sessions"]["spawned"][0]["program"], "scenarios/bin/foo")
            self.assertEqual(summary["gdb_sessions"]["spawned"][0]["cwd"], "/tmp/work")
            self.assertEqual(summary["gdb_sessions"]["spawned"][0]["session_id"], GDB_SESSION_ID)
            self.assertEqual(summary["gdb_sessions"]["interrupted"][0]["session_id"], GDB_SESSION_ID)
            self.assertEqual(summary["gdb_sessions"]["closed"][0]["session_id"], GDB_SESSION_ID)
            self.assertTrue((round_dir / "opencode.export.stderr.log").is_file())
            self.assertFalse((round_dir / "workspace").exists())
            self.assertTrue((suite_dir / "manual-eval.json").is_file())
            self.assertEqual(len(manifest["per_round_summary_paths"]), 1)

    def test_timed_out_summary_keeps_partial_answer_separate(self) -> None:
        session = {
            "info": {"id": "ses_partial", "tokens": {}, "time": {"created": 1000, "updated": 2000}},
            "messages": [{"role": "assistant", "parts": [{"type": "text", "text": "Still investigating"}]}],
        }
        run_result = {
            "used_ms": 100,
            "exit_code": -15,
            "timed_out": True,
            "command": ["opencode", "run"],
            "started_at": "2026-06-13T00:00:00Z",
            "ended_at": "2026-06-13T00:00:01Z",
        }
        summary = run_eval.extract_summary(
            session=session,
            scenario="hang-tokenizer",
            mode="skill",
            requested_model="fake/model",
            requested_variant=None,
            round_number=1,
            run_result=run_result,
            session_id="ses_partial",
        )
        self.assertEqual(summary["final_answer"], "")
        self.assertEqual(summary["partial_answer"], "Still investigating\n")
        self.assertEqual(summary["last_assistant_text"], "Still investigating\n")

    def test_final_answer_prefers_report_over_cleanup_text(self) -> None:
        session = {
            "messages": [
                {
                    "info": {"role": "assistant"},
                    "parts": [
                        {
                            "type": "text",
                            "text": (
                                "## Root Cause\n\n"
                                "The buffer overflows.\n\n"
                                "## Expected invariant vs actual runtime state\n\n"
                                "The checksum should remain stable, but it changes.\n\n"
                                "## Decisive GDB evidence\n\n"
                                "A watchpoint shows the write in memcpy after a long trace."
                            ),
                        }
                    ],
                },
                {"info": {"role": "assistant"}, "parts": [{"type": "text", "text": "Let me clean up the GDB session."}]},
                {"info": {"role": "assistant"}, "parts": [{"type": "text", "text": "All done."}]},
            ]
        }
        self.assertIn("## Root Cause", run_eval.extract_final_answer(session))
        self.assertEqual(run_eval.extract_last_assistant_text(session), "All done.\n")

    def test_resolve_opencode_bin_returns_absolute_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = Path.cwd()
            try:
                os.chdir(tmp)
                script = Path("relative-opencode")
                script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                script.chmod(0o755)
                resolved = run_eval.resolve_opencode_bin("./relative-opencode")
            finally:
                os.chdir(old_cwd)
        self.assertTrue(Path(resolved).is_absolute())

    def test_prompt_prefix_only_for_skill_mode(self) -> None:
        base_prompt = "Debug the target.\n"
        self.assertEqual(run_eval.prompt_for_mode("skill", base_prompt), "/gdb-debugging Debug the target.\n")
        self.assertEqual(run_eval.prompt_for_mode("ablation", base_prompt), "/gdb-debugging Debug the target.\n")
        self.assertEqual(run_eval.prompt_for_mode("skill", "/gdb-debugging Debug the target.\n"), "/gdb-debugging Debug the target.\n")
        self.assertEqual(run_eval.prompt_for_mode("no-skill", base_prompt), base_prompt)

    def test_no_skill_workspace_does_not_copy_project_skill(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            round_dir = Path(tmp) / "suite" / "no-skill" / "hang-tokenizer" / "round-001"
            workspace = run_eval.build_workspace(round_dir, "no-skill")
            try:
                self.assertFalse((workspace / ".opencode" / "skills" / "gdb-debugging").exists())
                config = json.loads((workspace / "opencode.json").read_text(encoding="utf-8"))
                self.assertEqual(config["permission"], {})
            finally:
                import shutil

                shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
