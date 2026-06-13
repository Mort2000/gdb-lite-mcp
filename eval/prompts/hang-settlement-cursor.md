Use the repository-local Skill at `skills/gdb-debugging/SKILL.md` and its `references/hang.md` file.

Debug `scenarios/bin/settlement-cursor` with GDB Lite MCP. The source is under `scenarios/hang-settlement-cursor/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/settlement-cursor"`.

The program hangs while replaying a settlement journal. Do not edit files. Use GDB through the MCP tools to identify the loop state that prevents progress. If `gdb_exec` times out with `needs_interrupt=true`, use `gdb_interrupt` before collecting stack and local state. Prefer plain breakpoints and bounded manual stepping; avoid auto-continuing breakpoint command lists in hang or infinite-loop scenarios.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on how the Skill affected interaction efficiency.
