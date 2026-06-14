# crash-sparse-cache

## Purpose

Evaluates crash triage with a small data-structure invariant failure.

## User-Visible Project

The workspace contains `src/sparse_cache.c` and `bin/sparse-cache`.

## Hidden Build Inputs

None.

## Expected Diagnosis

`find_entry` treats the embedded `NULL` entry at `cache[2]` as an end sentinel and returns `NULL` before reaching the `gamma` entry. `read_metric` then dereferences the returned `NULL` pointer.

## Anti-Cheat Notes

The prompt points to the cache read crash but does not name `gamma` or the sentinel condition.
