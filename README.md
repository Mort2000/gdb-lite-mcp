# GDB Lite MCP

A small TypeScript MCP server for driving GDB sessions from LLM agents.

GDB Lite MCP intentionally exposes only a thin set of primitives around native
GDB. Agents can spawn sessions, execute GDB commands, interrupt hung programs,
and close sessions while still using normal GDB features such as breakpoints,
watchpoints, command lists, Python snippets, core files, attach, and remote
targets.

## Requirements

- Node.js 20 or newer
- GDB available on `PATH`
- A native compiler such as `gcc` if you want to build the repository scenarios

## Install

```bash
npm install
npm run build
```

Run the server locally:

```bash
npm start
```

The package also exposes a `gdb-lite-mcp` binary after it has been built.

The npm package is intentionally limited to the runtime server, debug guide,
and debugging Skill. The `eval/scenarios/` directory contains repository
development assets; clone this repository if you want to run them locally.

## MCP Configuration

Point your MCP client at the published package via `npx`:

```json
{
  "mcpServers": {
    "gdb-lite": {
      "command": "npx",
      "args": ["-y", "gdb-lite-mcp"]
    }
  }
}
```

For repository-local evaluation, `eval/run_eval.py` writes a temporary
`opencode.json` that starts the same server from the built `dist/index.js`.

Runtime environment variables:

- `GDB_LITE_GDB_PATH`: GDB executable path. Defaults to `gdb`.
- `GDB_LITE_MAX_SESSIONS`: maximum live sessions. Defaults to `8`; must be a positive integer.
- `GDB_LITE_MAX_INTERNAL_BUFFER_CHARS`: per-session retained output buffer. Defaults to `4194304`; must be a positive integer.
- `GDB_LITE_AUTO_INIT`: set to `0`, `false`, `no`, or `off` to disable automatic startup defaults.

Invalid runtime configuration values fail fast when the server starts.

## Tools

The server registers these MCP tools:

| Tool | Purpose |
| --- | --- |
| `gdb_spawn` | Start a GDB session for a local program, core file, attached PID, or remote target. |
| `gdb_exec` | Send a native GDB command, poll output with an empty command, or list sessions with an empty or unknown `session_id`. |
| `gdb_interrupt` | Send SIGINT and wait for GDB to return to a prompt. |
| `gdb_close` | Terminate and remove a GDB session, or return the current session list when `session_id` is unknown. |

`gdb_exec` and `gdb_interrupt` return structured state such as
`completion_reason` (`completed`, `timeout`, or `exited`), `at_prompt`,
`command_pending`, `needs_interrupt`, `timed_out`, `truncated`, and byte counts.
Use this metadata to avoid stacking commands behind a still-running inferior.
Calls on the same session are not queued; concurrent `gdb_exec` or
`gdb_interrupt` requests are rejected.

The server also exposes a `gdb-lite://debug-guide` resource backed by
`GUIDE.md`.

## Example Workflow

```text
gdb_spawn({
  "prog_path": "bin/program",
  "work_dir": "/absolute/path/to/debug-workspace"
})

gdb_exec({
  "session_id": "...",
  "command": "break main\nrun\nbt\ninfo locals",
  "timeout": 5
})

gdb_close({
  "session_id": "..."
})
```

Prefer batching related GDB commands in one tool call. For hangs, let the run
time out, call `gdb_interrupt`, then inspect `bt`, `info threads`, and relevant
locals before continuing.

## Debugging Skill

The `skills/gdb-debugging` directory contains an agent Skill with focused
debugging workflows for:

- crashes
- hangs
- memory corruption
- recursion issues
- wrong results
- GDB Python probes

Agents that support repository-local Skills should read
`skills/gdb-debugging/SKILL.md` before using the MCP tools.

## Scenarios

The repository `eval/scenarios` directory contains small native debugging tasks
used to evaluate the MCP server and Skill. It is not included in the npm
package.

Build all scenario binaries:

```bash
python3 eval/scenarios/build_scenarios.py
```

Each scenario writes local build artifacts under `eval/scenarios/<name>/build/`,
which is ignored by Git.

## Evaluation

Repository-local evaluation prompts and config live under `eval/`. They are not
included in the npm package.

```bash
npm run build
python3 eval/run_eval.py --scenario hang-tokenizer
```

Run outputs are written under `eval/runs/`, which is ignored because it is a
local evaluation result artifact.

## Development

```bash
npm run build
npm test
```

Generated artifacts such as `dist/`, `node_modules/`, scenario build
directories, logs, and local evaluation results are ignored by Git.

## License

MIT. See `LICENSE`.
