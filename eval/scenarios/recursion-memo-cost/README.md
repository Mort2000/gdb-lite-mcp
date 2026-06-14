# recursion-memo-cost

## Purpose

Evaluates recursive-state debugging where the bug is an incomplete memoization key.

## User-Visible Project

The workspace contains `src/memo_cost.c` and `bin/memo-cost`.

## Hidden Build Inputs

None.

## Expected Diagnosis

`solve(day, coupon_used)` stores results only by `day`, but the result depends on both `day` and `coupon_used`. A memoized value computed with one coupon state is reused for the other state.

## Anti-Cheat Notes

The prompt describes the low result without telling the agent which state dimension is missing.
