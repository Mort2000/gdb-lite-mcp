Do not read or use files under `../skills/`. Use only the GDB Lite MCP tools and the scenario source.

Debug the core file for `scenarios/bin/invoice-export` with GDB Lite MCP. The source is under `scenarios/core-invoice-export/`.

When calling `gdb_spawn`, use `work_dir="."`, `prog_path="scenarios/bin/invoice-export"`, and `core_path="scenarios/bin/invoice-export.core"`.

The invoice export job crashed in production and only the core file is available. Do not edit files and do not rerun the binary before inspecting the core. Use GDB through the MCP tools to identify the faulting operation and invalid value.

Final answer format:

- Root cause and exact source location.
- Expected invariant versus actual runtime state.
- Decisive GDB evidence.
- Brief note on interaction efficiency without the Skill.
