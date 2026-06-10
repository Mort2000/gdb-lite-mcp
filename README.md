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
- A native compiler such as `gcc` if you want to build the bundled scenarios

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

## MCP Configuration

Point your MCP client at the built server entry point:

```json
{
  "mcpServers": {
    "gdb-lite": {
      "command": "node",
      "args": ["/absolute/path/to/gdb_lite_mcp/dist/index.js"]
    }
  }
}
```

For repository-local evaluation, `eval/opencode.json` starts the same server
from `../dist/index.js`.

## Tools

The server registers these MCP tools:

| Tool | Purpose |
| --- | --- |
| `gdb_spawn` | Start a GDB session for a local program, core file, attached PID, or remote target. |
| `gdb_exec` | Send a native GDB command, or poll output with an empty command. |
| `gdb_interrupt` | Send SIGINT and wait for GDB to return to a prompt. |
| `gdb_close` | Terminate and remove a GDB session, returning whether the session existed. |

`gdb_exec` and `gdb_interrupt` return structured state such as
`completion_reason` (`completed`, `timeout`, or `exited`), `at_prompt`,
`command_pending`, `needs_interrupt`, `timed_out`, `truncated`, and byte counts.
Use this metadata to avoid stacking commands behind a still-running inferior.

The server also exposes a `gdb-lite://debug-guide` resource backed by
`DEBUG_GUIDE.md`.

## Example Workflow

```text
gdb_spawn({
  "prog_path": "./scenarios/bin/ledger",
  "work_dir": "/absolute/path/to/gdb_lite_mcp"
})

gdb_exec({
  "session_id": "...",
  "command": "set pagination off\nbreak main\nrun\nbt\ninfo locals",
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

The `scenarios` directory contains small native debugging tasks used to evaluate
the MCP server and Skill.

Build all scenario binaries:

```bash
bash scenarios/build-all.sh
```

Binaries and core files are written to `scenarios/bin/`, which is ignored by
Git.

## Evaluation

Evaluation prompts and config live under `eval/`.

```bash
npm run build
bash scenarios/build-all.sh
bash eval/run-scenario.sh wrong-result-ledger
```

Run records should be kept in `eval/opencode-results.md`. That file is ignored
because it is a local intermediate result artifact.

## Development

```bash
npm run build
npm test
```

Generated artifacts such as `dist/`, `node_modules/`, `scenarios/bin/`, logs,
and local evaluation results are ignored by Git.

## License

MIT. See `LICENSE`.
