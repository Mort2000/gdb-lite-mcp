The program `bin/import-job` reports that an import job is corrupted after loading a vendor manifest feed. Please debug it with GDB Lite MCP.

The visible source is under `src/`. The vendor manifest implementation is linked like a third-party binary library without source or debug information. The input feed is a binary file at `data/manifest-feed.bin`. Do not rebuild or edit files. Identify where the job first diverges from its expected state and explain the underlying cause.

Final answer format:

- Root cause and responsible boundary between visible code and black-box code.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
