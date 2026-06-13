The program `scenarios/bin/settlement-cursor` hangs while replaying a settlement journal. Please debug it with GDB Lite MCP.

The source is under `scenarios/hang-settlement-cursor/`. Do not edit files. Identify the loop state that prevents progress.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
