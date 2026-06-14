# hang-settlement-cursor

## Purpose

Evaluates hang debugging where the useful evidence is the loop cursor and current event state.

## User-Visible Project

The workspace contains `src/settlement_cursor.c` and `bin/settlement-cursor`.

## Hidden Build Inputs

None.

## Expected Diagnosis

For `EVENT_RETRY` with `retry_after_ms == 0`, the loop executes `continue` before `cursor++`, so the same event is replayed forever and `retry_events` keeps increasing.

## Anti-Cheat Notes

The prompt asks for the non-progressing loop state without naming the zero-delay retry branch.
