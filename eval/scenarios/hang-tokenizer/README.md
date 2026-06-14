# hang-tokenizer

## Purpose

Evaluates hang debugging on a tokenizer loop where one branch does not advance the cursor.

## User-Visible Project

The workspace contains `src/tokenizer.c` and `bin/tokenizer`.

## Hidden Build Inputs

None.

## Expected Diagnosis

The underscore branch increments `tokens` and continues without incrementing `pos`, so the scanner remains on the same `_` character indefinitely.

## Anti-Cheat Notes

The prompt mentions tokenization only; the failed branch must be found from runtime state.
