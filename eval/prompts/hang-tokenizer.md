Use the repository-local Skill at `../skills/gdb-debugging/SKILL.md` and its relevant reference file.

Debug `scenarios/bin/tokenizer` with GDB Lite MCP. The source is under `scenarios/hang-tokenizer/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/tokenizer"`.

The program hangs while tokenizing an identifier string. Do not edit files. Use GDB through the MCP tools to find the loop state that prevents progress. Avoid unbounded traces; use conditional breakpoints or narrow command lists.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on how the Skill affected interaction efficiency.
