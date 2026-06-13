The invoice export job crashed in production. Please debug it with GDB Lite MCP.

The binary is `scenarios/bin/invoice-export`, the core file is `scenarios/bin/invoice-export.core`, and the source is under `scenarios/core-invoice-export/`.

Only the core file is available for the failing production run. Do not edit files and do not rerun the binary before inspecting the core. Identify the faulting operation and invalid value.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
