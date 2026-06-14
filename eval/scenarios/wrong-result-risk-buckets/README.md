# wrong-result-risk-buckets

## Purpose

Evaluates GDB Python on a wrong-result case with a black-box compiled unit. The efficient route is to compare runtime bucket values against the Python reference across generated positions and stop at the first mismatch.

## User-Visible Project

The workspace contains `src/risk_buckets.c`, `src/risk_digest.h`, `reference_digest.py`, and `bin/risk-buckets`.

## Hidden Build Inputs

`private/risk_digest.c` is used only to build the linked digest object. It is compiled with optimization and without debug information, then linked into the visible driver.

## Expected Diagnosis

The black-box `risk_bucket_for` path multiplies `net_exposure` by `volatility_bp` in 32-bit unsigned arithmetic. For `pos-apac-equity-073`, runtime wraps before division and returns bucket 0, while the reference full-width arithmetic returns bucket 3.

## Anti-Cheat Notes

The private digest source is not installed into the model workspace. The prompt exposes the reference script because the expected semantics must be discoverable, but the source of the linked implementation remains hidden.
