# Hang

Goal: find where progress stops and which state prevents progress.

If `run` or `continue` times out, do not keep issuing blind commands. Poll once for output and then use one of these approaches:

- If `needs_interrupt=true`, call `gdb_interrupt`, then collect `bt`, `thread apply all bt`, and locals.
- If interrupt is not available, rerun with a breakpoint or command trace before the suspected loop.

After interrupting, use one batched snapshot:

```gdb
bt
thread apply all bt
frame 0
info args
info locals
list
```

If the interrupted frame is inside libc or a blocking syscall, move up to the project frame and inspect the wait condition, queue/cursor state, or lock owner.

Loop trace:

```gdb
break loop_body_location
commands
silent
printf "iter=%d state=%d progress=%d cursor=%d\n", iter, state, progress, cursor
continue
end
run
```

Stop only on non-progress:

```gdb
break loop_body_location if progress == 0
break loop_body_location if cursor == old_cursor
```

If output grows too large, add a condition on the iteration count or suspicious state.
