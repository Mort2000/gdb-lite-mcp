---
name: gdb-debugging
description: Debug native C/C++/Rust or other compiled programs with GDB through MCP or shell. Use when localizing crashes, wrong results, hangs, memory corruption, recursion/control-flow bugs, or when an LLM should minimize debugger round trips with breakpoint commands, watchpoints, conditional breakpoints, and GDB Python.
---

# GDB Debugging

Use GDB as the debugging engine. Keep the MCP API thin: spawn a session, send native GDB command batches, read incremental output, and close the session.

## Workflow

1. Read enough source to state the symptom, expected invariant, and likely boundary where the invariant first matters.
2. Spawn GDB and set low-noise defaults:

```gdb
set pagination off
set print pretty on
set print elements 200
set confirm off
```

3. Prefer one discriminating probe over many tiny probes. A good first batch usually includes `break`, `run`, `bt`, `frame`, `info args`, `info locals`, and labeled `print` or `printf` expressions.
4. For repeated observations, use GDB-native automation: `commands ... end`, conditional breakpoints, watchpoints, or short `python ... end` blocks.
5. Keep a compact hypothesis/evidence table mentally or in notes. Stop probing when the evidence identifies the earliest wrong state transition; do not add disassembly or step-by-step confirmation unless source and runtime evidence conflict.
6. Close the GDB session before finishing.

## Start Modes

- Use `prog_path` for normal local execution.
- Use `core_path` with `prog_path` when the artifact is a core file; inspect `bt full` before rerunning.
- Use `attach_pid` for an already-running local process; collect thread backtraces before changing state.
- Use `remote_target` for `target remote`; pass native setup in `gdb_args` when sysroot, solib paths, or connection timeouts matter.

## Interaction Economy

- Batch related commands in one `gdb_exec` call.
- Avoid human-style repeated `next`/`print` calls unless narrowing one transition.
- Print labels with values: `printf "i=%d total=%d\n", i, total`.
- Limit output. If a trace is large, rerun with a conditional breakpoint or narrower range.
- Treat `timed_out && needs_interrupt` as "do not stack more commands." Use `gdb_interrupt`, then collect `bt`, `thread apply all bt`, and locals.
- Treat `at_prompt=false` and `command_pending=true` as a session-control issue before it is a debugging hypothesis.
- For MCP `gdb_spawn`, use a stable `work_dir` such as the repository root and a `prog_path` relative to that directory, or pass an absolute `prog_path`. Avoid mixing a binary directory `work_dir` with paths already relative to another directory.

## Reference Selection

- Wrong final value, bad accumulator, parser mismatch: read `references/wrong-result.md`.
- Segfault, abort, invalid pointer, failed assertion: read `references/crash.md`.
- Hang, infinite loop, blocking wait: read `references/hang.md`.
- Value changes unexpectedly, heap/stack overwrite: read `references/memory-corruption.md`.
- Recursive search, dynamic programming, memoization, or repeated stack states: read `references/recursion.md`.
- Repetitive inspection or structured output: read `references/gdb-python.md`.

If the MCP server exposes `gdb-lite://debug-guide`, read it when you need fallback examples or when a client cannot load this Skill.

## Final Report

Report only decisive evidence:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- The GDB evidence that proves the transition.
- Any uncertainty, missing symbols, or untested edge case.
