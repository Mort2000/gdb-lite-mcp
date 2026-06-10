Use the repository-local Skill at `../skills/gdb-debugging/SKILL.md` and its relevant reference file.

Debug `scenarios/bin/memo-cost` with GDB Lite MCP. The source is under `scenarios/recursion-memo-cost/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/memo-cost"`.

The recursive optimizer returns a cost lower than the expected cost. Do not edit files. Use GDB through the MCP tools to identify the invalid recursive or memoized state. Prefer conditional breakpoints, compact recursion traces, or GDB Python summaries over repeated manual stepping.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on how the Skill affected interaction efficiency.
