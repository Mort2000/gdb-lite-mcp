# Wrong Result

Goal: find the first state transition where runtime state diverges from the expected invariant. If every runtime transition matches the source and inputs, prove whether the expected value, fixture, or input data is the inconsistent part.

Use this sequence:

1. Break at the function that computes or returns the wrong value.
2. Inspect inputs, local state, and where the expected value comes from.
3. Trace the update point for the accumulator, index, parser state, or return value.
4. Stop at the earliest transition where "before" satisfies the invariant and "after" violates it.
5. If all transitions match the source and input data but the final value still differs from expected, stop and report an expected-value, fixture, or input-data mismatch. Do not keep searching for an algorithm bug that the evidence rules out.

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

Prefer passive before/after breakpoints over `next` or `step` inside breakpoint command lists. Stepping inside `commands ... end` can leave the session at a surprising source line or make later command-list lines hard to interpret.

```gdb
break file.c:UPDATE_LINE
commands
silent
printf "i=%d before=%d input=%d flag=%d\n", i, total, input[i], flag
continue
end
break file.c:AFTER_UPDATE_LINE
commands
silent
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

Expected-value or fixture mismatch check:

```gdb
break final_check_line
run
print actual
print expected
print input_array[0]
print input_array[1]
print input_array[2]
```

If the trace proves the final value is exactly what the source and runtime inputs imply, report that mismatch directly. Include the arithmetic or state table that shows the expected value cannot be produced from the observed inputs under the implemented rules.

Stop after the first trace that proves the transition from correct state to incorrect state, or after the first complete trace that proves the expected value is inconsistent with the runtime inputs. Extra disassembly or single-step confirmation is only useful if the source and runtime evidence conflict.
