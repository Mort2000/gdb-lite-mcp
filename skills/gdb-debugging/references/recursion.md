# Recursion And Memoization

Goal: find the first recursive state where the returned value violates the state invariant.

Avoid stopping at every call. Trace only the key state tuple and return values.

Useful probes:

```gdb
break solve
commands
silent
printf "enter solve day=%d coupon_used=%d memo=%d\n", day, coupon_used, memo[day]
continue
end
run
```

Conditional breakpoints:

```gdb
break solve if day == suspicious_day
break solve if day == suspicious_day && coupon_used == suspicious_state
```

For memoization bugs, verify that the cache key includes every input that can affect the result. If two calls with different state reuse the same slot, print both state tuples and the memo slot:

```gdb
break file.c:LINE
commands
silent
printf "reuse day=%d coupon_used=%d memo[%d]=%d\n", day, coupon_used, day, memo[day]
continue
end
```

Stop when the trace proves one state reused a value computed for a different state.
