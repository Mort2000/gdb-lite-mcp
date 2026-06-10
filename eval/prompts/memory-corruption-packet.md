Use the repository-local Skill at `../skills/gdb-debugging/SKILL.md` and its relevant reference file.

Debug `scenarios/bin/packet` with GDB Lite MCP. The source is under `scenarios/memory-corruption-packet/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/packet"`.

The packet checksum changes unexpectedly after loading a label. Do not edit files. Use GDB through the MCP tools to find the write that corrupts the value. Prefer watchpoints and concise snapshots.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on how the Skill affected interaction efficiency.
