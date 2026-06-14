The prebuilt program `bin/risk-buckets` validates a compact digest for a generated risk-position book, but exits with failure. Please debug it with GDB Lite MCP.

The visible source is under `src/`. The digest implementation is linked like a third-party object without source or debug information. `reference_digest.py` describes the expected bucket and digest semantics. Do not rebuild or edit files. Localize the first position whose runtime bucket disagrees with the reference bucket, and identify the root cause.

Final answer format:

- Root cause, responsible black-box function, and visible call path.
- Failed position and expected invariant versus actual runtime state.
- Decisive GDB evidence.
