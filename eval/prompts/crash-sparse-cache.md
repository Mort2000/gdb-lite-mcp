Use the repository-local Skill at `../skills/gdb-debugging/SKILL.md` and its relevant reference file.

Debug `scenarios/bin/sparse-cache` with GDB Lite MCP. The source is under `scenarios/crash-sparse-cache/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/sparse-cache"`.

The program segfaults while reading cache entries. Do not edit files. Use GDB through the MCP tools to identify the faulting operation and the invalid value that caused it. Prefer one batched crash triage over step-by-step probing.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on how the Skill affected interaction efficiency.
