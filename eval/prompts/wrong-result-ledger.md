The program `scenarios/bin/ledger` runs 10 floating-point ledger reconciliation rounds. Each round compares `expect` and `actual`, but a failed comparison only sets the final process result to 1. Please debug it with GDB Lite MCP.

The source is under `scenarios/wrong-result-ledger/`. Do not edit files. Localize the failed round and the root cause.

Final answer format:

- Root cause and exact source location.
- Failed round and expected invariant versus actual runtime state.
- Decisive GDB evidence.
