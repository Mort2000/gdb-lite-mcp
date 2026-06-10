Use the repository-local Skill at `../skills/gdb-debugging/SKILL.md` and its relevant reference file.

Debug `scenarios/bin/ledger` with GDB Lite MCP. The source is under `scenarios/wrong-result-ledger/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/ledger"`.

The program prints a closing balance that does not match the expected balance. Do not edit files. Use GDB through the MCP tools to localize the root cause with low interaction count. Prefer batched GDB commands, breakpoint command lists, conditional breakpoints, or GDB Python when useful.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on how the Skill affected interaction efficiency.
