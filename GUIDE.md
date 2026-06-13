# GDB Lite Guide For LLM Agents

This guide is the fallback workflow for agents using GDB Lite MCP without a
dedicated debugging Skill.

Use GDB as the debugging engine. Keep the MCP API thin: spawn a session, send
native GDB command batches, read incremental output, and close the session.

## MCP Tools

- `gdb_spawn(prog_path?, work_dir, environments={}, core_path?, attach_pid?, remote_target?, gdb_args=[]) -> session_id`
- `gdb_exec(session_id, command="", timeout=5.0, max_output_bytes?) -> output + state`
- `gdb_interrupt(session_id, timeout=5.0, max_output_bytes?) -> output + state`
- `gdb_close(session_id) -> { closed, existed }`

`gdb_exec` sends native GDB commands. An empty command polls output. An empty or
unknown `session_id` returns the current session list.

`gdb_exec` and `gdb_interrupt` return structured state:

- `completion_reason`: `completed`, `timeout`, or `exited`.
- `at_prompt`: GDB is ready for the next command.
- `command_pending`: a previous command has not completed.
- `needs_interrupt`: GDB is not at a prompt and usually needs `gdb_interrupt`.
- `timed_out`, `truncated`, byte counts, and elapsed time.

Calls on the same session are not queued. Do not send concurrent `gdb_exec` or
`gdb_interrupt` requests for the same session.

## Workflow

1. Read enough source to state the symptom, expected invariant, and likely
   boundary where the invariant first matters.
2. Spawn GDB. GDB Lite applies low-noise startup defaults automatically; use
   `gdb_args` only for target-specific setup.
3. Prefer one discriminating probe over many tiny probes. A good first batch
   often includes `break`, `run`, `bt`, `frame`, `info args`, `info locals`, and
   labeled `print` or `printf` expressions.
4. For repeated observations, use GDB-native automation: `commands ... end`,
   conditional breakpoints, watchpoints, or short `python ... end` blocks.
5. Stop probing when the evidence identifies the earliest wrong state
   transition, or when a complete trace proves the expected value or fixture is
   inconsistent with runtime inputs.
6. Close the GDB session before finishing.

## Start Modes

Use `prog_path` for normal local execution:

```text
gdb_spawn({
  "prog_path": "scenarios/bin/program",
  "work_dir": "/absolute/repository/root"
})
```

Use `core_path` with `prog_path` for core files. Inspect the core before
rerunning:

```text
gdb_spawn({
  "prog_path": "scenarios/bin/program",
  "core_path": "scenarios/bin/program.core",
  "work_dir": "/absolute/repository/root"
})
```

Use `attach_pid` for an already-running local process; collect thread
backtraces before changing state.

Use `remote_target` for `target remote`; pass native setup such as sysroot or
shared library paths through `gdb_args`.

Relative `prog_path` and `core_path` values are resolved from `work_dir`. Use a
stable `work_dir` such as the repository root, or pass absolute paths. Avoid
mixing a binary directory `work_dir` with paths already relative to another
directory.

For program arguments, use `run arg1 arg2` or `set args ...` in GDB. For
environment variables, prefer the `environments` spawn parameter.

## Interaction Economy

- Batch related commands in one `gdb_exec` call.
- Avoid human-style repeated `next` and `print` calls unless narrowing one
  transition.
- Print labels with values: `printf "i=%d total=%d\n", i, total`.
- Limit output. If a trace is large, rerun with a conditional breakpoint,
  narrower range, or `max_output_bytes`.
- Treat `timed_out && needs_interrupt` as "do not stack more commands." Use
  `gdb_interrupt`, then collect `bt`, `thread apply all bt`, and locals.
- Treat `at_prompt=false` and `command_pending=true` as a session-control issue
  before it is a debugging hypothesis.

For non-hang loop traces, prefer passive before/after breakpoints over `next` or
`step` inside breakpoint command lists:

```gdb
break file.c:UPDATE_LINE
commands
silent
printf "before i=%d state=%d input=%d\n", i, state, input[i]
continue
end
break file.c:AFTER_UPDATE_LINE
commands
silent
printf "after i=%d state=%d\n", i, state
continue
end
run
```

For hang or infinite-loop cases, do not use auto-continuing breakpoint command
lists. Use plain breakpoints, bounded manual `continue` or `next`, or
stop-on-condition probes instead.

## Wrong Results

Goal: find the first state transition where runtime state diverges from the
expected invariant. If every runtime transition matches the source and inputs,
prove whether the expected value, fixture, or input data is inconsistent.

Use this sequence:

1. Break at the function that computes or returns the wrong value.
2. Inspect inputs, local state, and where the expected value comes from.
3. Trace the update point for the accumulator, index, parser state, or return
   value.
4. Stop at the earliest transition where "before" satisfies the invariant and
   "after" violates it.
5. If all transitions match the source and input data but the final value still
   differs from expected, report an expected-value, fixture, or input-data
   mismatch. Do not keep searching for an algorithm bug that the evidence rules
   out.

Useful starting batch:

```gdb
break compute_fn
run
bt
frame
info args
info locals
print expected_boundary_expr
```

Conditional localization:

```gdb
break file.c:LINE if total < 0
break file.c:LINE if i == suspicious_index
```

## Crashes And Core Files

Goal: identify the faulting operation and the invalid value that made it fault.

For a live crash, start with one batch:

```gdb
run
bt full
frame 0
info args
info locals
info registers
list
```

For a core file, start GDB with both `prog_path` and `core_path`; do not rerun
first. Use:

```gdb
bt full
frame 0
info args
info locals
list
```

Only rerun after the core proves the faulting operation and you need earlier
history.

Then inspect the expression on the faulting line:

```gdb
print ptr
print *ptr
x/16gx ptr
```

If the crashing value was corrupted earlier, rerun and set a watchpoint after
initialization:

```gdb
break init_done_location
run
watch object->field
continue
bt
info locals
```

For assertions or aborts, move up the stack from libc frames until reaching
project code, then inspect the failed invariant and its inputs.

## Hangs And Infinite Loops

Goal: find where progress stops and which state prevents progress.

If `run` or `continue` times out, do not keep issuing blind commands. Poll once
for output. If `needs_interrupt=true`, call `gdb_interrupt`, then collect a
batched snapshot:

```gdb
bt
thread apply all bt
frame 0
info args
info locals
list
```

If the interrupted frame is inside libc or a blocking syscall, move up to the
project frame and inspect the wait condition, queue/cursor state, or lock owner.

Loop probe:

```gdb
break loop_body_location
run
printf "iter=%d state=%d progress=%d cursor=%d\n", iter, state, progress, cursor
```

Stop directly on non-progress when you can express the condition:

```gdb
break loop_body_location if progress == 0
break loop_body_location if cursor == old_cursor
```

If output grows too large, add a condition on the iteration count or suspicious
state before rerunning.

## Memory Corruption

Goal: find the write that changes a value unexpectedly.

Use watchpoints instead of guessing:

```gdb
break after_initialization
run
watch target_value
continue
bt
frame
info locals
```

For struct fields:

```gdb
watch object.field
watch object->field
```

For raw memory:

```gdb
watch *(int*)address
continue
x/32bx address
x/16gx address
```

If the value is in an array, first break after allocation or initialization and
print the address:

```gdb
print &items[index].field
watch items[index].field
```

When a watchpoint hits inside a library function, inspect the caller frames to
identify the project-level write.

## Recursion And Memoization

Goal: find the first recursive state where the returned value violates the state
invariant.

Avoid stopping at every call. Trace only the key state tuple and return values:

```gdb
break solve
commands
silent
printf "enter solve day=%d coupon_used=%d memo=%d\n", day, coupon_used, memo[day]
continue
end
run
```

Use conditional breakpoints to focus:

```gdb
break solve if day == suspicious_day
break solve if day == suspicious_day && coupon_used == suspicious_state
```

For memoization bugs, verify that the cache key includes every input that can
affect the result. If two calls with different state reuse the same slot, print
both state tuples and the memo slot:

```gdb
break file.c:LINE
commands
silent
printf "reuse day=%d coupon_used=%d memo[%d]=%d\n", day, coupon_used, day, memo[day]
continue
end
```

Stop when the trace proves one state reused a value computed for a different
state.

## GDB Python

Use short GDB Python blocks when native commands become repetitive or hard to
parse. Print stable labels.

Evaluate several expressions:

```gdb
python
exprs = ["count", "total", "items[count-1].name", "items[count-1].penalty"]
for expr in exprs:
    try:
        print(f"{expr} = {gdb.parse_and_eval(expr)}")
    except gdb.error as e:
        print(f"{expr} = <error: {e}>")
end
```

Print the current frame summary:

```gdb
python
frame = gdb.selected_frame()
print(f"frame={frame.name()}")
for sym in frame.block():
    if sym.is_argument or sym.is_variable:
        try:
            print(f"{sym.name} = {sym.value(frame)}")
        except Exception as e:
            print(f"{sym.name} = <error: {e}>")
end
```

Define a temporary custom command for repeated snapshots:

```gdb
python
class LiteSnapshot(gdb.Command):
    def __init__(self):
        super(LiteSnapshot, self).__init__("lite_snapshot", gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        print("=== lite_snapshot ===")
        gdb.execute("frame")
        gdb.execute("info args")
        gdb.execute("info locals")
        print("=== end_snapshot ===")

LiteSnapshot()
end
lite_snapshot
```

## Final Report

Report only decisive evidence:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- The GDB evidence that proves the transition.
- Any uncertainty, missing symbols, or untested edge case.
