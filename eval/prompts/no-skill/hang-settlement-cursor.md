Do not read or use files under `../skills/`. Use only the GDB Lite MCP tools and the scenario source.

Debug `scenarios/bin/settlement-cursor` with GDB Lite MCP. The source is under `scenarios/hang-settlement-cursor/`.

When calling `gdb_spawn`, use `work_dir="."` and `prog_path="scenarios/bin/settlement-cursor"`.

The program hangs while replaying a settlement journal. Do not edit files. Use GDB through the MCP tools to identify the loop state that prevents progress.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on interaction efficiency without the Skill.
