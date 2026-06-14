# wrong-result-ledger

## Purpose

Evaluates wrong-result debugging on a program that hides the failed iteration until the agent inspects loop state.

## User-Visible Project

The workspace contains `src/ledger.c` and `bin/ledger`.

## Hidden Build Inputs

None.

## Expected Diagnosis

`round-07` compares `0.1 + 0.2 - 0.3` with `0.0` using exact binary floating-point equality. The decimal expression appears balanced, but the runtime `actual` is not exactly equal to `expect`.

## Anti-Cheat Notes

The prompt describes the symptom without naming the failing round.
