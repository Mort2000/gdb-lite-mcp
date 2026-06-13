#!/usr/bin/env python3
"""Structured OpenCode eval runner for GDB Lite MCP."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EVAL_DIR = Path(__file__).resolve().parent
if str(EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_DIR))

from eval_report_lib import ensure_manual_eval


RUNNER_VERSION = "0.1.0"
REPO_ROOT = Path(__file__).resolve().parents[1]
PROMPT_DIR = REPO_ROOT / "eval" / "prompts"
ORACLE_DIR = REPO_ROOT / "eval" / "oracles"
DEFAULT_OUT_DIR = REPO_ROOT / "eval" / "runs"
SKILL_PROMPT_PREFIX = "/gdb-debugging "
FINAL_RESULT_TEMPLATE = {
    "status": "pending",
    "passed": None,
    "judge": "manual",
    "root_cause_correct": None,
    "evidence_quality": None,
    "notes": "",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(dt: datetime | None = None) -> str:
    dt = dt or utc_now()
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_segment(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    return value.strip("-") or "default"


def unique_dir(base: Path) -> Path:
    if not base.exists():
        return base
    for i in range(2, 1000):
        candidate = base.with_name(f"{base.name}-{i}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not allocate unique suite directory for {base}")


def repo_relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path.resolve())


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def as_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def command_output(args: list[str], cwd: Path = REPO_ROOT, timeout: int = 15) -> str | None:
    try:
        proc = subprocess.run(
            args,
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip()


def first_line(value: str | None) -> str | None:
    if not value:
        return None
    return value.splitlines()[0] if value.splitlines() else value


def resolve_opencode_bin(opencode_bin: str) -> str:
    found = shutil.which(opencode_bin)
    if found:
        return str(Path(found).resolve())
    if opencode_bin == "opencode":
        fallback = Path.home() / ".opencode" / "bin" / "opencode"
        if fallback.exists() and os.access(fallback, os.X_OK):
            return str(fallback)
    return opencode_bin


def git_commit() -> str | None:
    return command_output(["git", "rev-parse", "HEAD"])


def git_dirty() -> bool | None:
    out = command_output(["git", "status", "--porcelain"])
    if out is None:
        return None
    return bool(out)


def collect_environment(opencode_bin: str) -> dict[str, Any]:
    return {
        "runner_version": RUNNER_VERSION,
        "repo_root": str(REPO_ROOT),
        "git_commit": git_commit(),
        "dirty_worktree": git_dirty(),
        "opencode_version": first_line(command_output([opencode_bin, "--version"])),
        "opencode_bin": opencode_bin,
        "node_version": first_line(command_output(["node", "--version"])),
        "npm_version": first_line(command_output(["npm", "--version"])),
        "gdb_version": first_line(command_output(["gdb", "--version"])),
        "gcc_version": first_line(command_output(["gcc", "--version"])),
    }


def available_scenarios() -> list[str]:
    return sorted(path.stem for path in PROMPT_DIR.glob("*.md"))


def validate_inputs(scenarios: list[str], dry_run: bool = False) -> None:
    missing_prompts = [name for name in scenarios if not (PROMPT_DIR / f"{name}.md").is_file()]
    if missing_prompts:
        raise SystemExit(f"missing prompt(s): {', '.join(missing_prompts)}")
    if dry_run:
        return
    required_paths = [
        REPO_ROOT / "dist" / "index.js",
        REPO_ROOT / "scenarios" / "bin",
    ]
    missing = [repo_relative(path) for path in required_paths if not path.exists()]
    if missing:
        raise SystemExit(f"missing required build artifact(s): {', '.join(missing)}")
    if not any((REPO_ROOT / "scenarios" / "bin").iterdir()):
        raise SystemExit("missing scenario binaries under scenarios/bin; run bash scenarios/build-all.sh")


def load_oracle(scenario: str) -> dict[str, Any] | None:
    path = ORACLE_DIR / f"{scenario}.json"
    if not path.is_file():
        return None
    try:
        data = load_json(path)
    except json.JSONDecodeError:
        return {"scenario": scenario, "error": f"invalid oracle JSON: {repo_relative(path)}"}
    return data


def prompt_for_mode(mode: str, prompt_text: str) -> str:
    if mode in {"skill", "ablation"} and not prompt_text.startswith(SKILL_PROMPT_PREFIX):
        return f"{SKILL_PROMPT_PREFIX}{prompt_text}"
    return prompt_text


def build_workspace(round_dir: Path, mode: str) -> Path:
    workspace = Path(tempfile.mkdtemp(prefix=f"gdb-lite-eval-{safe_segment(round_dir.parent.name)}-"))
    shutil.copytree(REPO_ROOT / "scenarios", workspace / "scenarios", symlinks=True)
    if mode in {"skill", "ablation"}:
        skills_target = workspace / ".opencode" / "skills"
        skills_target.mkdir(parents=True, exist_ok=True)
        shutil.copytree(REPO_ROOT / "skills", skills_target, dirs_exist_ok=True)
    permission: dict[str, Any] = {}
    if mode in {"skill", "ablation"}:
        permission = {"skill": {"gdb-debugging": "allow"}}
    config = {
        "$schema": "https://opencode.ai/config.json",
        "permission": permission,
        "mcp": {
            "gdb-lite": {
                "type": "local",
                "command": ["node", str(REPO_ROOT / "dist" / "index.js")],
                "enabled": True,
                "timeout": 30000,
            }
        },
    }
    write_json(workspace / "opencode.json", config)
    return workspace


def kill_process_group(proc: subprocess.Popen[str]) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    proc.wait(timeout=5)


def run_opencode(
    opencode_bin: str,
    workspace: Path,
    prompt_text: str,
    model: str | None,
    variant: str | None,
    timeout_sec: int,
) -> dict[str, Any]:
    cmd = [opencode_bin, "run", "--format", "json", "--dir", str(workspace)]
    if model:
        cmd.extend(["--model", model])
    if variant:
        cmd.extend(["--variant", variant])
    cmd.extend(["--dangerously-skip-permissions", prompt_text])
    started = utc_now()
    started_monotonic = time.monotonic()
    proc = subprocess.Popen(
        cmd,
        cwd=workspace,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_process_group(proc)
        stdout, stderr = proc.communicate()
    ended = utc_now()
    used_ms = int((time.monotonic() - started_monotonic) * 1000)
    return {
        "command": redact_prompt_arg(cmd),
        "started_at": iso_z(started),
        "ended_at": iso_z(ended),
        "used_ms": used_ms,
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "stdout": stdout or "",
        "stderr": stderr or "",
    }


def redact_prompt_arg(cmd: list[str]) -> list[str]:
    if not cmd:
        return []
    redacted = list(cmd)
    if len(redacted) > 1:
        redacted[-1] = "<prompt text>"
    return redacted


def parse_ndjson(text: str) -> list[Any]:
    events: list[Any] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            events.append({"_raw": line, "_parse_error": True})
    return events


def normalize_run_stdout(events: list[Any], raw_stdout: str) -> str:
    lines: list[str] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        event_type = str(event.get("type") or event.get("event") or "")
        text = extract_event_text(event)
        if text:
            prefix = f"[{event_type}] " if event_type else ""
            lines.append(prefix + text)
    if lines:
        return "\n".join(lines) + "\n"
    return raw_stdout


def extract_event_text(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("text", "content", "message", "delta"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate
        for child in value.values():
            found = extract_event_text(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = extract_event_text(child)
            if found:
                return found
    return None


def extract_session_id_from_events(events: list[Any]) -> str | None:
    candidates: list[str] = []

    def walk(value: Any, path: list[str], event_type: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                key_lower = key.lower()
                child_path = path + [key_lower]
                if isinstance(child, str):
                    has_session_key = "session" in key_lower and ("id" in key_lower or key_lower == "session")
                    has_session_path = key_lower == "id" and any("session" in p for p in child_path)
                    has_session_event = key_lower == "id" and "session" in event_type.lower()
                    if has_session_key or has_session_path or has_session_event:
                        candidates.append(child)
                walk(child, child_path, event_type)
        elif isinstance(value, list):
            for child in value:
                walk(child, path, event_type)

    for event in events:
        if not isinstance(event, dict):
            continue
        event_type = str(event.get("type") or event.get("event") or "")
        walk(event, [], event_type)

    for candidate in candidates:
        if candidate.startswith("ses_"):
            return candidate
    for candidate in candidates:
        if len(candidate) >= 8:
            return candidate
    return None


def parse_millis(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        if value.isdigit():
            return int(value)
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return int(parsed.timestamp() * 1000)
        except ValueError:
            return None
    return None


def find_session_from_list(
    opencode_bin: str,
    workspace: Path,
    started_at: str,
    ended_at: str,
) -> str | None:
    try:
        proc = subprocess.run(
            [opencode_bin, "session", "list", "--format", "json", "--max-count", "50"],
            cwd=workspace,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        sessions = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(sessions, list):
        return None
    start_ms = parse_millis(started_at)
    end_ms = parse_millis(ended_at)
    workspace_str = str(workspace.resolve())
    candidates: list[dict[str, Any]] = []
    for session in sessions:
        if not isinstance(session, dict):
            continue
        session_id = session.get("id")
        if not isinstance(session_id, str):
            continue
        directory = str(session.get("directory") or session.get("cwd") or session.get("workspace") or "")
        time_value = parse_millis(session.get("created")) or parse_millis(session.get("updated"))
        directory_matches = directory and Path(directory).resolve() == Path(workspace_str)
        time_matches = True
        if start_ms is not None and end_ms is not None and time_value is not None:
            time_matches = (start_ms - 60000) <= time_value <= (end_ms + 60000)
        if directory_matches and time_matches:
            candidates.append(session)
    if not candidates:
        return None
    candidates.sort(key=lambda item: parse_millis(item.get("updated")) or parse_millis(item.get("created")) or 0)
    return str(candidates[-1]["id"])


def export_session(
    opencode_bin: str,
    workspace: Path,
    session_id: str,
    output_path: Path,
) -> tuple[dict[str, Any] | None, str, str, int]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with output_path.open("w", encoding="utf-8") as stdout_file:
            proc = subprocess.run(
                [opencode_bin, "export", session_id],
                cwd=workspace,
                text=True,
                stdout=stdout_file,
                stderr=subprocess.PIPE,
                timeout=120,
                check=False,
            )
    except subprocess.TimeoutExpired as exc:
        stdout = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
        return None, stdout, as_text(exc.stderr), 124
    except OSError as exc:
        return None, "", str(exc), 127
    session: dict[str, Any] | None = None
    stdout = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    if stdout.strip():
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, dict):
                session = parsed
        except json.JSONDecodeError:
            session = None
    return session, stdout, proc.stderr, proc.returncode


def deep_get(value: Any, path: list[str]) -> Any:
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def first_present(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def normalize_tokens(raw: Any) -> dict[str, Any]:
    result: dict[str, Any] = {
        "input": None,
        "output": None,
        "reasoning": None,
        "cache_read": None,
        "cache_write": None,
        "total": None,
    }
    if not isinstance(raw, dict):
        result["raw"] = raw
        return result
    result["input"] = first_present(
        raw.get("input"),
        raw.get("prompt"),
        raw.get("inputTokens"),
        raw.get("promptTokens"),
    )
    result["output"] = first_present(
        raw.get("output"),
        raw.get("completion"),
        raw.get("outputTokens"),
        raw.get("completionTokens"),
    )
    result["reasoning"] = first_present(raw.get("reasoning"), raw.get("reasoningTokens"))
    cache = raw.get("cache") if isinstance(raw.get("cache"), dict) else {}
    result["cache_read"] = first_present(
        raw.get("cache_read"),
        raw.get("cacheRead"),
        raw.get("cacheReadTokens"),
        cache.get("read") if isinstance(cache, dict) else None,
    )
    result["cache_write"] = first_present(
        raw.get("cache_write"),
        raw.get("cacheWrite"),
        raw.get("cacheWriteTokens"),
        cache.get("write") if isinstance(cache, dict) else None,
    )
    result["total"] = first_present(raw.get("total"), raw.get("totalTokens"))
    if result["total"] is None:
        numeric_values = [value for key, value in result.items() if key != "total" and isinstance(value, int)]
        if numeric_values:
            result["total"] = sum(numeric_values)
    result["raw"] = raw
    return result


def session_duration_ms(info: dict[str, Any]) -> int | None:
    time_info = info.get("time")
    if not isinstance(time_info, dict):
        return None
    created = parse_millis(time_info.get("created"))
    updated = parse_millis(time_info.get("updated"))
    if created is None or updated is None:
        return None
    return max(0, updated - created)


def iter_messages(session: dict[str, Any]) -> list[dict[str, Any]]:
    messages = session.get("messages")
    if isinstance(messages, list):
        return [message for message in messages if isinstance(message, dict)]
    if isinstance(messages, dict):
        return [message for message in messages.values() if isinstance(message, dict)]
    return []


def iter_parts(message: dict[str, Any]) -> list[dict[str, Any]]:
    parts = message.get("parts")
    if isinstance(parts, list):
        return [part for part in parts if isinstance(part, dict)]
    if isinstance(parts, dict):
        return [part for part in parts.values() if isinstance(part, dict)]
    content = message.get("content")
    if isinstance(content, list):
        return [part for part in content if isinstance(part, dict)]
    return []


def message_role(message: dict[str, Any]) -> str | None:
    role = first_present(
        message.get("role"),
        deep_get(message, ["info", "role"]),
        deep_get(message, ["metadata", "role"]),
    )
    return str(role) if role is not None else None


def part_text(part: dict[str, Any]) -> str | None:
    part_type = str(part.get("type") or "")
    if part_type and part_type not in {"text", "markdown", "message", "assistant"}:
        return None
    for key in ("text", "content", "message"):
        value = part.get(key)
        if isinstance(value, str):
            return value
    return None


def assistant_texts(session: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for message in iter_messages(session):
        role = message_role(message)
        if role and role != "assistant":
            continue
        text_parts: list[str] = []
        if isinstance(message.get("content"), str):
            text_parts.append(str(message["content"]))
        for part in iter_parts(message):
            text = part_text(part)
            if text:
                text_parts.append(text)
        final_text = "\n".join(part for part in text_parts if part).strip()
        if final_text:
            texts.append(final_text + "\n")
    return texts


def looks_like_final_report(text: str) -> bool:
    normalized = text.lower()
    markers = (
        "root cause",
        "expected invariant",
        "actual runtime state",
        "decisive gdb",
        "gdb evidence",
        "failed round",
    )
    return len(text) >= 200 and any(marker in normalized for marker in markers)


def extract_last_assistant_text(session: dict[str, Any]) -> str:
    texts = assistant_texts(session)
    if not texts:
        return ""
    return texts[-1]


def extract_final_answer(session: dict[str, Any]) -> str:
    texts = assistant_texts(session)
    for text in reversed(texts):
        if looks_like_final_report(text):
            return text
    if texts:
        return texts[-1]
    return ""


def output_status(state: dict[str, Any]) -> str | None:
    output = state.get("output")
    if output is None:
        return None
    if isinstance(output, dict):
        status = output.get("status") or output.get("type")
        if status is not None:
            return str(status)
    return "present"


def extract_session_id_from_output(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_lower = key.lower()
            if isinstance(child, str) and "session" in key_lower and "id" in key_lower:
                return child
            found = extract_session_id_from_output(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = extract_session_id_from_output(child)
            if found:
                return found
    if isinstance(value, str):
        match = re.search(r"ses_[A-Za-z0-9]+", value)
        if match:
            return match.group(0)
        match = re.search(
            r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
            value,
        )
        if match:
            return match.group(0)
        stripped = value.strip()
        if stripped and "\n" not in stripped and len(stripped) <= 128:
            return stripped
    return None


def extract_tool_calls(session: dict[str, Any]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for message in iter_messages(session):
        for part in iter_parts(message):
            if str(part.get("type") or "") != "tool":
                continue
            state = part.get("state") if isinstance(part.get("state"), dict) else {}
            input_value = first_present(
                state.get("input") if isinstance(state, dict) else None,
                part.get("input"),
            )
            tool = first_present(
                part.get("tool"),
                part.get("name"),
                part.get("toolName"),
                state.get("tool") if isinstance(state, dict) else None,
            )
            call = {
                "tool": str(tool) if tool is not None else None,
                "call_id": first_present(part.get("callID"), part.get("callId"), part.get("id")),
                "status": state.get("status") if isinstance(state, dict) else None,
                "input": input_value,
                "metadata": state.get("metadata") if isinstance(state, dict) else None,
                "time": state.get("time") if isinstance(state, dict) else None,
                "output_status": output_status(state) if isinstance(state, dict) else None,
                "error": state.get("error") if isinstance(state, dict) else None,
            }
            calls.append(call)
    return calls


def input_path(input_value: Any) -> str | None:
    if isinstance(input_value, dict):
        for key in ("filePath", "path", "filepath"):
            value = input_value.get(key)
            if isinstance(value, str):
                return value
    return None


def input_command(input_value: Any) -> str | None:
    if isinstance(input_value, dict):
        value = input_value.get("command")
        if isinstance(value, str):
            return value
    return None


def input_session_id(input_value: Any) -> str | None:
    if isinstance(input_value, dict):
        for key in ("session_id", "sessionID", "sessionId", "id"):
            value = input_value.get(key)
            if isinstance(value, str):
                return value
    return None


def input_skill_name(input_value: Any) -> str | None:
    if isinstance(input_value, dict):
        for key in ("name", "skill", "skillName"):
            value = input_value.get(key)
            if isinstance(value, str):
                return value
    return None


def is_tool(tool: str | None, expected: str) -> bool:
    if not tool:
        return False
    return tool == expected or tool.endswith(expected)


def extract_gdb_sessions(tool_calls: list[dict[str, Any]], raw_session: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    sessions: dict[str, list[dict[str, Any]]] = {"spawned": [], "closed": [], "interrupted": []}
    raw_parts_by_call = build_raw_parts_by_call(raw_session)
    for call in tool_calls:
        tool = call.get("tool")
        input_value = call.get("input")
        if is_tool(tool, "gdb_spawn"):
            raw_part = raw_parts_by_call.get(str(call.get("call_id")))
            output = deep_get(raw_part, ["state", "output"]) if isinstance(raw_part, dict) else None
            sessions["spawned"].append(
                {
                    "program": first_present(
                        input_value.get("program") if isinstance(input_value, dict) else None,
                        input_value.get("prog_path") if isinstance(input_value, dict) else None,
                    ),
                    "cwd": first_present(
                        input_value.get("cwd") if isinstance(input_value, dict) else None,
                        input_value.get("work_dir") if isinstance(input_value, dict) else None,
                    ),
                    "session_id": extract_session_id_from_output(output),
                }
            )
        elif is_tool(tool, "gdb_close"):
            sessions["closed"].append({"session_id": input_session_id(input_value)})
        elif is_tool(tool, "gdb_interrupt"):
            sessions["interrupted"].append({"session_id": input_session_id(input_value)})
    return sessions


def build_raw_parts_by_call(session: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for message in iter_messages(session):
        for part in iter_parts(message):
            call_id = first_present(part.get("callID"), part.get("callId"), part.get("id"))
            if call_id is not None:
                result[str(call_id)] = part
    return result


def extract_summary(
    session: dict[str, Any] | None,
    scenario: str,
    mode: str,
    requested_model: str | None,
    requested_variant: str | None,
    round_number: int,
    run_result: dict[str, Any],
    session_id: str | None,
    export_error: str | None = None,
) -> dict[str, Any]:
    session = session or {}
    info = session.get("info") if isinstance(session.get("info"), dict) else {}
    model_info = info.get("model") if isinstance(info.get("model"), dict) else {}
    last_assistant_text = extract_last_assistant_text(session) if session else ""
    final_answer = "" if run_result["timed_out"] else extract_final_answer(session)
    tool_calls = extract_tool_calls(session) if session else []
    count_by_name = Counter(call.get("tool") or "unknown" for call in tool_calls)
    gdb_commands = [
        command
        for command in (input_command(call.get("input")) for call in tool_calls if is_tool(call.get("tool"), "gdb_exec"))
        if command is not None
    ]
    file_reads = [
        path
        for path in (input_path(call.get("input")) for call in tool_calls if call.get("tool") == "read")
        if path is not None
    ]
    skill_reads = [
        name
        for name in (input_skill_name(call.get("input")) for call in tool_calls if call.get("tool") == "skill")
        if name is not None
    ]
    summary = {
        "scenario": scenario,
        "mode": mode,
        "round": round_number,
        "session_id": first_present(deep_get(session, ["info", "id"]), session_id),
        "model": requested_model or "default",
        "provider_id": first_present(model_info.get("providerID"), model_info.get("provider_id"), model_info.get("provider")),
        "model_id": first_present(model_info.get("id"), model_info.get("modelID"), model_info.get("model_id")),
        "effort": first_present(requested_variant, model_info.get("variant")),
        "used_ms": run_result["used_ms"],
        "session_ms": session_duration_ms(info),
        "exit_code": run_result["exit_code"],
        "timed_out": run_result["timed_out"],
        "tokens": normalize_tokens(info.get("tokens")),
        "cost": info.get("cost"),
        "tool_calls": tool_calls,
        "tool_call_count_by_name": dict(sorted(count_by_name.items())),
        "gdb_commands": gdb_commands,
        "gdb_command_lines": [line for command in gdb_commands for line in command.splitlines()],
        "gdb_command_count": len(gdb_commands),
        "gdb_sessions": extract_gdb_sessions(tool_calls, session) if session else {"spawned": [], "closed": [], "interrupted": []},
        "file_reads": file_reads,
        "skill_reads": skill_reads,
        "last_assistant_text": last_assistant_text,
        "partial_answer": last_assistant_text if run_result["timed_out"] else "",
        "final_answer": final_answer,
        "final_result": dict(FINAL_RESULT_TEMPLATE),
        "run": {
            "command": run_result["command"],
            "started_at": run_result["started_at"],
            "ended_at": run_result["ended_at"],
        },
        "export_error": export_error,
    }
    return summary


def token_total(summary: dict[str, Any]) -> Any:
    tokens = summary.get("tokens")
    if isinstance(tokens, dict):
        return tokens.get("total")
    return None


def render_round_report(summary: dict[str, Any], oracle: dict[str, Any] | None) -> str:
    checklist = ["- No oracle file is present; review final answer manually in the suite manual eval file."]
    if oracle:
        checklist = []
        root_cause = oracle.get("root_cause")
        if root_cause:
            checklist.append(f"- Root cause matches: {root_cause}")
        must_mention = oracle.get("must_mention")
        if isinstance(must_mention, list):
            for item in must_mention:
                checklist.append(f"- Final answer mentions `{item}`.")
        must_not_claim = oracle.get("must_not_claim")
        if isinstance(must_not_claim, list):
            for item in must_not_claim:
                checklist.append(f"- Final answer does not claim `{item}`.")
        if not checklist:
            checklist.append("- Review oracle file.")
    lines = [
        "# Eval Round Report",
        "",
        f"- Scenario: {summary.get('scenario')}",
        f"- Mode: {summary.get('mode')}",
        f"- Model: {summary.get('model')}",
        f"- Effort: {summary.get('effort')}",
        f"- Round: {summary.get('round')}",
        f"- Session: {summary.get('session_id')}",
        f"- Exit code: {summary.get('exit_code')}",
        f"- Timed out: {summary.get('timed_out')}",
        f"- Used ms: {summary.get('used_ms')}",
        f"- Tokens: {token_total(summary)}",
        f"- Cost: {summary.get('cost')}",
        "",
        "## Automated Trace Summary",
        "",
        f"- Tool calls: {len(summary.get('tool_calls') or [])}",
        f"- GDB command count: {summary.get('gdb_command_count')}",
        f"- File reads: {', '.join(summary.get('file_reads') or []) or '-'}",
        f"- Skill reads: {', '.join(summary.get('skill_reads') or []) or '-'}",
        "",
        "## Final Answer",
        "",
        "See `final-answer.md`.",
        "",
        "## Manual Judgment",
        "",
        "Fill manual judgment in the suite-level `manual-eval.json`, then run `python3 eval/summarize_run.py <suite-dir>` to validate it and render `report.md`.",
        "",
        "## Oracle Checklist",
        "",
        *checklist,
        "",
    ]
    return "\n".join(lines)


def render_suite_report(summaries: list[dict[str, Any]]) -> str:
    lines = [
        "# Eval Suite Trace Summary",
        "",
        "Human judgment belongs in suite-level `manual-eval.json`; render final `report.md` with `python3 eval/summarize_run.py <suite-dir>`.",
        "",
        "| Mode | Scenario | Round | Exit | Timeout | Used ms | Tokens | Cost | GDB cmds | Skill reads |",
        "| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for summary in summaries:
        skill_reads = ", ".join(summary.get("skill_reads") or [])
        lines.append(
            "| {mode} | {scenario} | {round} | {exit_code} | {timed_out} | {used_ms} | {tokens} | {cost} | {gdb} | {skills} |".format(
                mode=summary.get("mode"),
                scenario=summary.get("scenario"),
                round=summary.get("round"),
                exit_code=summary.get("exit_code"),
                timed_out=summary.get("timed_out"),
                used_ms=summary.get("used_ms"),
                tokens=token_total(summary),
                cost=summary.get("cost"),
                gdb=summary.get("gdb_command_count"),
                skills=skill_reads or "-",
            )
        )
    lines.extend(
        [
            "",
        ]
    )
    return "\n".join(lines)


def init_suite_manifest(args: argparse.Namespace, suite_id: str, suite_dir: Path, opencode_bin: str) -> dict[str, Any]:
    manifest = {
        **collect_environment(opencode_bin),
        "suite_id": suite_id,
        "suite_dir": repo_relative(suite_dir),
        "requested_model": args.model or "default",
        "requested_variant": args.variant,
        "modes": args.mode,
        "scenarios": args.scenario,
        "timeout_sec": args.timeout_sec,
        "round_count": args.rounds,
        "start_timestamp": iso_z(),
        "end_timestamp": None,
        "per_round_summary_paths": [],
        "rounds": [],
    }
    return manifest


def save_suite(suite_dir: Path, manifest: dict[str, Any], summaries: list[dict[str, Any]]) -> None:
    write_json(suite_dir / "suite.json", manifest)
    write_text(suite_dir / "report-template.md", render_suite_report(summaries))
    ensure_manual_eval(suite_dir)


def run_round(
    suite_dir: Path,
    manifest: dict[str, Any],
    summaries: list[dict[str, Any]],
    args: argparse.Namespace,
    opencode_bin: str,
    mode: str,
    scenario: str,
    round_number: int,
) -> None:
    round_dir = suite_dir / mode / scenario / f"round-{round_number:03d}"
    round_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = PROMPT_DIR / f"{scenario}.md"
    prompt_text = prompt_for_mode(mode, read_text(prompt_path))
    write_text(round_dir / "prompt.md", prompt_text)
    workspace = build_workspace(round_dir, mode)
    workspace_info = {
        "workspace": str(workspace),
        "preserved_workspace": None,
        "mode": mode,
        "scenario": scenario,
        "skills_copied": mode in {"skill", "ablation"},
        "opencode_config": str(workspace / "opencode.json"),
    }
    write_json(round_dir / "workspace-info.json", workspace_info)

    run_result = run_opencode(
        opencode_bin=opencode_bin,
        workspace=workspace,
        prompt_text=prompt_text,
        model=args.model,
        variant=args.variant,
        timeout_sec=args.timeout_sec,
    )
    events = parse_ndjson(run_result["stdout"])
    write_text(round_dir / "opencode.events.ndjson", run_result["stdout"])
    write_text(round_dir / "opencode.stdout.log", normalize_run_stdout(events, run_result["stdout"]))
    write_text(round_dir / "opencode.stderr.log", run_result["stderr"])

    session_id = extract_session_id_from_events(events)
    if not session_id:
        session_id = find_session_from_list(
            opencode_bin,
            workspace,
            run_result["started_at"],
            run_result["ended_at"],
        )

    session: dict[str, Any] | None = None
    export_error: str | None = None
    if session_id:
        session_path = round_dir / "opencode.session.json"
        session, export_stdout, export_stderr, export_code = export_session(opencode_bin, workspace, session_id, session_path)
        if not export_stdout.strip():
            write_json(session_path, {"error": "opencode export produced no stdout", "session_id": session_id})
        if export_stderr.strip():
            write_text(round_dir / "opencode.export.stderr.log", export_stderr)
        if export_code != 0:
            export_error = f"opencode export exited {export_code}"
        if session is None:
            export_error = export_error or "opencode export did not return a JSON object"
    else:
        write_json(round_dir / "opencode.session.json", {"error": "session id not found"})
        export_error = "session id not found"

    summary = extract_summary(
        session=session,
        scenario=scenario,
        mode=mode,
        requested_model=args.model,
        requested_variant=args.variant,
        round_number=round_number,
        run_result=run_result,
        session_id=session_id,
        export_error=export_error,
    )
    oracle = load_oracle(scenario)
    write_json(round_dir / "summary.json", summary)
    write_text(round_dir / "final-answer.md", summary.get("final_answer") or "")
    write_text(round_dir / "report.md", render_round_report(summary, oracle))

    if args.keep_workspace:
        preserved_workspace = round_dir / "workspace"
        if preserved_workspace.exists():
            shutil.rmtree(preserved_workspace)
        shutil.move(str(workspace), preserved_workspace)
        workspace_info["preserved_workspace"] = str(preserved_workspace)
        write_json(round_dir / "workspace-info.json", workspace_info)
    else:
        shutil.rmtree(workspace, ignore_errors=True)

    summaries.append(summary)
    summary_path = repo_relative(round_dir / "summary.json")
    manifest["per_round_summary_paths"].append(summary_path)
    manifest["rounds"].append(
        {
            "mode": mode,
            "scenario": scenario,
            "round": round_number,
            "summary_path": summary_path,
            "exit_code": summary["exit_code"],
            "timed_out": summary["timed_out"],
            "used_ms": summary["used_ms"],
            "session_id": summary["session_id"],
            "export_error": summary["export_error"],
        }
    )
    save_suite(suite_dir, manifest, summaries)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run structured OpenCode eval suites for GDB Lite MCP.")
    parser.add_argument("--scenario", action="append", default=[], help="Scenario name under eval/prompts; repeatable.")
    parser.add_argument("--all", action="store_true", help="Run all prompts under eval/prompts.")
    parser.add_argument("--mode", action="append", choices=["skill", "no-skill", "ablation"], help="Eval mode; repeatable.")
    parser.add_argument("--rounds", type=int, default=1, help="Rounds per scenario/mode pair.")
    parser.add_argument("--model", default=os.environ.get("OPENCODE_MODEL"), help="Provider/model passed to opencode run.")
    parser.add_argument("--variant", help="Provider-specific opencode --variant value.")
    parser.add_argument("--timeout-sec", type=int, default=300, help="Hard timeout per round.")
    parser.add_argument("--opencode-bin", default=os.environ.get("OPENCODE_BIN", "opencode"), help="OpenCode binary path.")
    parser.add_argument("--keep-workspace", action="store_true", help="Keep per-round temporary workspace.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="Suite output parent directory.")
    parser.add_argument("--tag", help="Optional suite id suffix.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned rounds without executing OpenCode.")
    args = parser.parse_args(argv)

    if args.rounds < 1:
        parser.error("--rounds must be >= 1")
    if args.timeout_sec < 1:
        parser.error("--timeout-sec must be >= 1")
    modes = args.mode or ["skill"]
    seen_modes: set[str] = set()
    args.mode = [mode for mode in modes if not (mode in seen_modes or seen_modes.add(mode))]
    scenario_names = set(available_scenarios()) if args.all else set()
    for scenario in args.scenario:
        if "/" in scenario:
            parser.error("scenario names must not include mode prefixes; use --mode no-skill --scenario <name>")
        scenario_names.add(scenario.removesuffix(".md"))
    if not scenario_names:
        parser.error("provide --all or at least one --scenario")
    args.scenario = sorted(scenario_names)
    args.out_dir = args.out_dir if args.out_dir.is_absolute() else (REPO_ROOT / args.out_dir)
    args.opencode_bin = resolve_opencode_bin(args.opencode_bin)
    return args


def print_dry_run(args: argparse.Namespace) -> None:
    planned = [
        {"mode": mode, "scenario": scenario, "round": round_number}
        for mode in args.mode
        for scenario in args.scenario
        for round_number in range(1, args.rounds + 1)
    ]
    print(json.dumps({"planned_rounds": planned}, indent=2))


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    validate_inputs(args.scenario, dry_run=args.dry_run)
    if args.dry_run:
        print_dry_run(args)
        return 0

    model_label = safe_segment((args.model or "default").split("/")[-1])
    mode_label = safe_segment("-".join(args.mode))
    suffix = f"-{safe_segment(args.tag)}" if args.tag else ""
    suite_id = f"{utc_now().strftime('%Y%m%dT%H%M%SZ')}-{model_label}-{mode_label}{suffix}"
    suite_dir = unique_dir(args.out_dir / suite_id)
    suite_dir.mkdir(parents=True)
    manifest = init_suite_manifest(args, suite_id, suite_dir, args.opencode_bin)
    summaries: list[dict[str, Any]] = []
    save_suite(suite_dir, manifest, summaries)

    print(f"suite: {repo_relative(suite_dir)}", file=sys.stderr)
    total = len(args.mode) * len(args.scenario) * args.rounds
    current = 0
    try:
        for mode in args.mode:
            for scenario in args.scenario:
                for round_number in range(1, args.rounds + 1):
                    current += 1
                    print(f"[{current}/{total}] {mode}/{scenario}/round-{round_number:03d}", file=sys.stderr)
                    run_round(suite_dir, manifest, summaries, args, args.opencode_bin, mode, scenario, round_number)
    finally:
        manifest["end_timestamp"] = iso_z()
        save_suite(suite_dir, manifest, summaries)
    print(f"summary: {repo_relative(suite_dir / 'suite.json')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
