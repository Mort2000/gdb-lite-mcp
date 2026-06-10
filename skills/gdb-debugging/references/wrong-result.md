# Wrong Result

Goal: find the first state transition where the program diverges from the expected invariant.

Use this sequence:

1. Break at the function that computes or returns the wrong value.
2. Inspect inputs and local state once.
3. Trace the update point for the accumulator, index, parser state, or return value.
4. Stop at the earliest transition where "before" satisfies the invariant and "after" violates it.

Batch snapshot:

```gdb
break compute_fn
run
bt
frame
info args
info locals
print expected_boundary_expr
```

Loop trace:

```gdb
break file.c:LINE
commands
silent
printf "i=%d before=%d input=%d flag=%d\n", i, total, input[i], flag
next
printf "i=%d after=%d\n", i, total
continue
end
run
```

Conditional localization:

```gdb
break file.c:LINE if total < 0
break file.c:LINE if i == suspicious_index
```

Prefer labeled `printf` traces over many separate `print` calls.

Stop after the first trace that proves the transition from correct state to incorrect state. Extra disassembly or single-step confirmation is only useful if the source line and observed behavior disagree.
