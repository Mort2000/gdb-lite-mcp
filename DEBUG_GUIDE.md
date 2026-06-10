# GDB Debugging Guide For LLM Agents

This guide is for agents using the GDB Lite MCP tools without a dedicated Skill.

The MCP tools are intentionally minimal:

- `gdb_spawn(prog_path?, work_dir, environments={}, core_path?, attach_pid?, remote_target?, gdb_args=[]) -> session_id`
- `gdb_exec(session_id, command="", timeout=5.0) -> output`
- `gdb_interrupt(session_id, timeout=5.0) -> output`
- `gdb_close(session_id)`

Treat `gdb_exec` as direct access to GDB. Prefer native GDB commands, breakpoint command lists, watchpoints, conditional breakpoints, and GDB Python over custom wrapper patterns.

`gdb_exec` and `gdb_interrupt` return structured metadata in addition to text output:

- `at_prompt`: GDB is ready for the next command.
- `command_pending`: a previous command has not reached a prompt or sentinel yet.
- `needs_interrupt`: the session is not at a prompt and should usually be interrupted before sending more commands.

When `timed_out=true` and `needs_interrupt=true`, avoid stacking more commands behind the running inferior. Use `gdb_interrupt`, collect a backtrace, then decide whether to continue, kill, or restart with narrower probes.

## Core Rules

1. Keep interaction count low.
   - Do not debug like a human pressing `next` repeatedly.
   - Batch related GDB commands in one `gdb_exec` call.
   - Use `commands ... end` or GDB Python for repeated observations.

2. Debug by hypotheses and invariants.
   - State what should be true.
   - Probe the earliest point where it should be true.
   - Compare expected and actual values.
   - Move earlier or later based on evidence.

3. Prefer labeled output.
   - Use `printf "label=%d\n", expr` instead of unlabeled `print expr` when tracing.
   - Labeled output is easier to parse and cite.

4. Keep raw evidence concise.
   - Ask for enough data to decide the current hypothesis.
   - Avoid dumping huge arrays, full logs, or many frames unless needed.

5. Always close the session.
   - Call `gdb_close` before finishing.

## Basic Workflow

1. Spawn GDB.

```text
gdb_spawn({
  "prog_path": "./program",
  "work_dir": "/path/to/workdir"
})
```

Other start modes:

```text
gdb_spawn({
  "prog_path": "./program",
  "core_path": "./program.core",
  "work_dir": "/path/to/workdir"
})

gdb_spawn({
  "prog_path": "./program",
  "attach_pid": 12345,
  "work_dir": "/path/to/workdir"
})

gdb_spawn({
  "prog_path": "./program",
  "remote_target": "localhost:1234",
  "work_dir": "/path/to/workdir",
  "gdb_args": ["-ex", "set sysroot /path/to/sysroot"]
})
```

2. Poll initial output if needed.

```text
gdb_exec({
  "session_id": "...",
  "command": "",
  "timeout": 2
})
```

3. Disable noise and set useful defaults.

```gdb
set pagination off
set print pretty on
set print elements 200
set confirm off
```

4. Set breakpoints or watchpoints based on the suspected invariant.

5. Run one batch probe.

6. Summarize evidence and decide the next probe.

7. Close GDB.

```text
gdb_close({ "session_id": "..." })
```

## Batch Snapshot Template

Use this when stopped at an interesting point.

```gdb
bt
frame
info args
info locals
print suspicious_expr
print another_expr
```

Use one `gdb_exec` call for the whole block.

## Wrong Result Debugging

Goal: find the first point where the actual value diverges from the expected invariant.

Good strategy:

1. Break at the function that returns the wrong value.
2. Inspect inputs.
3. Break or trace the update point for the accumulator/state.
4. Compare the value before and after each suspicious update.

Example trace:

```gdb
break compute_total
run
info args
info locals
```

If the bug is in a loop, avoid repeated stepping. Use breakpoint commands:

```gdb
break sample.c:25
commands
silent
printf "loop i=%d total_before=%d item=%s penalty=%d\n", i, total, items[i].name, items[i].penalty
continue
end
run
```

If you need to stop only when a value becomes suspicious:

```gdb
break sample.c:25 if total < 0
run
```

## Crash Debugging

Goal: identify the faulting operation and invalid value.

Start with:

```gdb
run
bt full
frame 0
info args
info locals
info registers
```

Then inspect the faulting expression:

```gdb
list
print ptr
print *ptr
x/16gx ptr
```

If the pointer was corrupted earlier, use a watchpoint after it is initialized:

```gdb
watch ptr
continue
```

For memory addressed through a struct field:

```gdb
watch object->field
continue
```

## Hang Or Infinite Loop Debugging

Goal: find the loop or blocking call and the state that prevents progress.

If the program is running and does not return to the GDB prompt within the timeout, poll with an empty command to collect output:

```text
gdb_exec({ "session_id": "...", "command": "", "timeout": 1 })
```

If `needs_interrupt=true`, interrupt the session and collect:

```text
gdb_interrupt({ "session_id": "...", "timeout": 5 })
```

```gdb
bt
thread apply all bt
info locals
```

Then add a low-noise trace around the suspected loop:

```gdb
break loop_body_location
commands
silent
printf "iter=%d state=%d progress=%d\n", iter, state, progress
continue
end
```

Use conditional breakpoints to stop only on non-progress:

```gdb
break loop_body_location if progress == 0
```

## Memory Corruption Debugging

Goal: find the write that changes a value unexpectedly.

1. Break after the value is initialized.
2. Set a watchpoint.
3. Continue until the unexpected write.

```gdb
break init_done_location
run
watch target_value
continue
bt
info locals
```

For raw memory:

```gdb
watch *(int*)address
continue
```

Use `x/` to inspect memory around the corruption:

```gdb
x/32bx address
x/16gx address
```

## Recursive Code Debugging

Goal: avoid stopping at every recursive call.

Use conditional breakpoints:

```gdb
break recursive_fn if n == 0
break recursive_fn if n < 0
```

Use breakpoint commands to trace compactly:

```gdb
break recursive_fn
commands
silent
printf "recursive_fn n=%d depth? result-state=%d\n", n, state
continue
end
```

If recursion is deep, trace only suspicious arguments.

## GDB Python

Use GDB Python when native command blocks become repetitive or hard to parse.

Keep scripts short and task-specific. Print labeled output.

Example: evaluate several expressions with stable labels.

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

Example: print current frame summary.

```gdb
python
frame = gdb.selected_frame()
print(f"frame={frame.name()}")
for sym in frame.block():
    if sym.is_variable or sym.is_argument:
        try:
            print(f"{sym.name} = {sym.value(frame)}")
        except Exception as e:
            print(f"{sym.name} = <error: {e}>")
end
```

Example: create a custom command for repeated snapshots.

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

## Interaction Patterns To Avoid

Avoid this pattern:

```text
print x
print y
print z
next
print x
next
print y
```

Prefer:

```gdb
printf "before x=%d y=%d z=%d\n", x, y, z
next
printf "after x=%d y=%d z=%d\n", x, y, z
```

Or use a breakpoint command list if the point repeats.

## Final Report Format

When done, report:

1. The root cause.
2. The exact source location.
3. The decisive GDB evidence.
4. The expected value versus actual value.
5. Any uncertainty or missing debug symbols.

Example:

```text
Root cause: sample.c:29 subtracts the last penalty twice.
Evidence: before line 29, total=81 and items[count-1].penalty=5; after stepping over line 29, total=76.
Expected: total should remain 81 because adjust_item already subtracts the penalty.
Actual: final output is total=76.
```
