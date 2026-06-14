# core-invoice-export

## Purpose

Evaluates postmortem core-file debugging. The agent should inspect the captured production crash instead of rerunning first.

## User-Visible Project

The workspace contains `src/invoice_export.c`, `bin/invoice-export`, and `bin/invoice-export.core`.

## Hidden Build Inputs

None.

## Expected Diagnosis

`find_active_account` returns `NULL` for inactive `acct-200`. The caller passes that pointer to `emit_invoice_row`, which dereferences `account->display_name`.

## Anti-Cheat Notes

The core is generated from the installed workspace during `make install`, so core metadata points at the temporary mini project rather than the repository scenario directory.
