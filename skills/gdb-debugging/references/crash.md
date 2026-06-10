# Crash

Goal: identify the faulting operation and the invalid value that made it fault.

Start with one batch:

```gdb
run
bt full
frame 0
info args
info locals
info registers
list
```

For a core file, start GDB with both `prog_path` and `core_path`; do not rerun first. Use:

```gdb
bt full
frame 0
info args
info locals
list
```

Only rerun after the core proves the faulting operation and you need earlier history.

Then inspect the expression on the faulting line:

```gdb
print ptr
print *ptr
x/16gx ptr
```

If the crashing value was corrupted earlier, rerun and set a watchpoint after initialization:

```gdb
break init_done_location
run
watch object->field
continue
bt
info locals
```

For assertions or aborts, move up the stack from libc frames until reaching project code, then inspect the failed invariant and its inputs.
