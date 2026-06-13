---
name: gdb-debugging
description: Debug native C/C++/Rust or other compiled programs with GDB through MCP or shell. Use when localizing crashes, wrong results, hangs, memory corruption, recursion/control-flow bugs, or when an LLM should minimize debugger round trips with breakpoint commands, watchpoints, conditional breakpoints, and GDB Python.
---

# GDB Debugging

Use GDB as the debugging engine. Keep the MCP API thin: spawn a session, send native GDB command batches, read incremental output, and close the session.

## Workflow

1. Read enough source to state the symptom, expected invariant, and likely boundary where the invariant first matters.
2. Spawn GDB. GDB Lite applies low-noise startup defaults automatically; use `gdb_args` only for target-specific setup.
3. Prefer one discriminating probe over many tiny probes.
4. For repeated observations, use GDB-native automation such as breakpoint command lists, conditional breakpoints, watchpoints, or short GDB Python blocks.
5. Keep a compact hypothesis/evidence table mentally or in notes. Stop probing when the evidence identifies the earliest wrong state transition, or when a complete trace proves the expected value or fixture is inconsistent with runtime inputs.
6. Close the GDB session before finishing.

## Start Modes

- Use `prog_path` for normal local execution.
- Use `core_path` with `prog_path` when the artifact is a core file; inspect `bt full` before rerunning.
- Use `attach_pid` for an already-running local process; collect thread backtraces before changing state.
- Use `remote_target` for `target remote`; pass native setup in `gdb_args` when sysroot, solib paths, or connection timeouts matter.

## Interaction Economy

- Batch related commands in one `gdb_exec` call.
- Avoid human-style repeated `next`/`print` calls unless narrowing one transition.
- Print labels with values when collecting traces.
- For non-hang loop traces, prefer passive before/after breakpoints over repeated stepping.
- Limit output. If a trace is large, rerun with a conditional breakpoint or narrower range.
- For hang or infinite-loop cases, do not use auto-continuing breakpoint command lists; use plain breakpoints, bounded manual `continue`/`next`, or stop-on-condition probes instead.
- Treat `timed_out && needs_interrupt` as "do not stack more commands." Use `gdb_interrupt`, then collect `bt`, `thread apply all bt`, and locals.
- Treat `at_prompt=false` and `command_pending=true` as a session-control issue before it is a debugging hypothesis.
- For MCP `gdb_spawn`, use a stable `work_dir` such as the repository root and a `prog_path` relative to that directory, or pass an absolute `prog_path`. Avoid mixing a binary directory `work_dir` with paths already relative to another directory.

## Scenario Hints

- Wrong result, bad accumulator, parser mismatch, or exact equality failure: consider `break`, conditional `break`, `commands`, `printf`, `display`, `watch`, `finish`, and `print`.
- Segfault, abort, invalid pointer, failed assertion, or core file: consider `run`, `bt full`, `frame`, `info args`, `info locals`, `info registers`, `list`, `up`, and `x`.
- Hang, infinite loop, or blocking wait: consider bounded `run` or `continue`, `gdb_interrupt`, `bt`, `thread apply all bt`, `frame`, `info locals`, conditional `break`, and bounded `next`.
- Memory corruption, unexpected field change, or overwrite: consider `watch`, hardware watchpoints, `awatch`, `rwatch`, `x`, `bt`, `frame`, and caller inspection when a library write triggers the watchpoint.
- Recursion, dynamic programming, memoization, or repeated stack states: consider conditional `break`, `commands`, `printf`, `finish`, `bt`, and state tuple plus cache-slot inspection.
- Repetitive inspection or structured output: read `references/gdb-python.md`.

If the MCP server exposes `gdb-lite://debug-guide`, read it when you need fallback examples or when a client cannot load this Skill.

## Final Report

Report only decisive evidence:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- The GDB evidence that proves the transition.
- Any uncertainty, missing symbols, or untested edge case.
