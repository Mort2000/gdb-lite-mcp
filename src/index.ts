#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GdbController, type GdbExecResult, type SessionInfo } from "./gdb-controller.js";

const controller = new GdbController();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const debugGuidePath = path.resolve(moduleDir, "../GUIDE.md");
const debugGuideUri = "gdb-lite://debug-guide";

const server = new McpServer({
  name: "gdb-lite-mcp",
  version: "0.1.0",
});

const maxOutputBytesSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Optional maximum returned output size in bytes. Keeps the tail with a truncation marker.");

const executionStateOutputSchema = {
  output: z.string(),
  completion_reason: z.enum(["completed", "timeout", "exited"]),
  saw_prompt: z.boolean(),
  timed_out: z.boolean(),
  session_exited: z.boolean(),
  at_prompt: z.boolean(),
  command_pending: z.boolean(),
  needs_interrupt: z.boolean(),
  bytes: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  truncated: z.boolean(),
  omitted_bytes: z.number().int().nonnegative(),
  internal_buffer_bytes: z.number().int().nonnegative(),
};

const sessionInfoSchema = z.object({
  session_id: z.string(),
  work_dir: z.string(),
  program: z.string().nullable(),
});

const sessionExecutionInputSchema = {
  session_id: z.string(),
  timeout: z.number().min(0).default(5.0),
  max_output_bytes: maxOutputBytesSchema,
};

server.registerResource(
  "debug-guide",
  debugGuideUri,
  {
    title: "GDB Lite Debug Guide",
    description:
      "Fallback workflow guide for LLM agents using GDB Lite MCP without a dedicated Skill.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: await readFile(debugGuidePath, "utf8"),
      },
    ],
  }),
);

server.registerTool(
  "gdb_spawn",
  {
    title: "Spawn gdb",
    description:
      "Start a gdb session and return a session id. Supports local programs, core files, attach, remote targets, and extra native gdb args.",
    inputSchema: {
      prog_path: z
        .string()
        .optional()
        .describe("Program path. Relative paths are resolved from work_dir."),
      work_dir: z.string().describe("Working directory for gdb and the debuggee."),
      environments: z.record(z.string()).default({}).describe("Extra environment variables."),
      core_path: z
        .string()
        .optional()
        .describe(
          "Optional core file path. Relative paths are resolved from work_dir. Mutually exclusive with attach_pid and remote_target.",
        ),
      attach_pid: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional local process id to attach to. Mutually exclusive with core_path and remote_target."),
      remote_target: z
        .string()
        .optional()
        .describe(
          'Optional native GDB remote target, for example "localhost:1234". Mutually exclusive with core_path and attach_pid.',
        ),
      gdb_args: z
        .array(z.string())
        .default([])
        .describe("Optional extra native gdb command-line arguments."),
    },
    outputSchema: {
      session_id: z.string(),
    },
  },
  async ({ prog_path, work_dir, environments, core_path, attach_pid, remote_target, gdb_args }) => {
    const sessionId = await controller.spawn({
      prog_path,
      work_dir,
      environments,
      core_path,
      attach_pid,
      remote_target,
      gdb_args,
    });

    return {
      content: [
        {
          type: "text",
          text: sessionId,
        },
      ],
      structuredContent: {
        session_id: sessionId,
      },
    };
  },
);

server.registerTool(
  "gdb_exec",
  {
    title: "Execute gdb command",
    description:
      "Send a gdb command and return all output since the previous gdb_exec or gdb_interrupt call. Join multiple commands with \\n. Empty command only polls output. If session_id is empty or unknown, returns the current gdb session list instead of executing a command.",
    inputSchema: {
      session_id: z.string().default("").describe("GDB session id. Leave empty to list current sessions."),
      timeout: z.number().min(0).default(5.0),
      max_output_bytes: maxOutputBytesSchema,
      command: z.string().default(""),
    },
    outputSchema: {
      ...executionStateOutputSchema,
      sessions: z.array(sessionInfoSchema).optional(),
      requested_session_id: z.string().optional(),
    },
  },
  async ({ session_id, command, timeout, max_output_bytes }) => {
    if (session_id.trim() === "" || !controller.hasSession(session_id)) {
      const result = buildSessionListExecResult(controller.listSessions(), session_id);
      return {
        content: [
          {
            type: "text",
            text: result.output,
          },
        ],
        structuredContent: result,
      };
    }

    const result = await controller.exec(session_id, command, timeout, max_output_bytes);
    return {
      content: [
        {
          type: "text",
          text: result.output,
        },
      ],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "gdb_interrupt",
  {
    title: "Interrupt gdb",
    description:
      "Send SIGINT to the gdb session/debuggee, wait for the GDB prompt, and return incremental output.",
    inputSchema: sessionExecutionInputSchema,
    outputSchema: {
      ...executionStateOutputSchema,
      interrupted: z.boolean(),
    },
  },
  async ({ session_id, timeout, max_output_bytes }) => {
    const result = await controller.interrupt(session_id, timeout, max_output_bytes);
    return {
      content: [
        {
          type: "text",
          text: result.output,
        },
      ],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "gdb_close",
  {
    title: "Close gdb",
    description:
      "Terminate and remove a gdb session. If session_id is unknown, returns the current gdb session list.",
    inputSchema: {
      session_id: z.string(),
    },
    outputSchema: {
      closed: z.boolean(),
      existed: z.boolean(),
      sessions: z.array(sessionInfoSchema).optional(),
      requested_session_id: z.string().optional(),
    },
  },
  async ({ session_id }) => {
    const existed = controller.close(session_id);
    if (!existed) {
      const sessions = controller.listSessions();
      const text = formatSessionList(sessions, session_id);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        structuredContent: {
          closed: false,
          existed: false,
          sessions,
          requested_session_id: session_id,
        },
      };
    }

    return {
      content: [
        {
          type: "text",
          text: "closed",
        },
      ],
      structuredContent: {
        closed: true,
        existed: true,
      },
    };
  },
);

const shutdown = () => {
  controller.closeAll();
};

process.once("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
process.once("exit", shutdown);

await server.connect(new StdioServerTransport());

function buildSessionListExecResult(
  sessions: SessionInfo[],
  requestedSessionId: string,
): GdbExecResult & { sessions: SessionInfo[]; requested_session_id?: string } {
  const output = formatSessionList(sessions, requestedSessionId);
  return {
    output,
    completion_reason: "completed",
    saw_prompt: false,
    timed_out: false,
    session_exited: false,
    at_prompt: false,
    command_pending: false,
    needs_interrupt: false,
    bytes: Buffer.byteLength(output, "utf8"),
    duration_ms: 0,
    truncated: false,
    omitted_bytes: 0,
    internal_buffer_bytes: 0,
    sessions,
    requested_session_id: requestedSessionId.trim() === "" ? undefined : requestedSessionId,
  };
}

function formatSessionList(sessions: SessionInfo[], requestedSessionId: string): string {
  const prefix = requestedSessionId.trim() === ""
    ? "Current gdb sessions"
    : `No gdb session found for ${JSON.stringify(requestedSessionId)}. Current gdb sessions`;

  if (sessions.length === 0) {
    return `${prefix}: none`;
  }

  const lines = sessions.map((session) =>
    `- session_id=${session.session_id} work_dir=${session.work_dir} program=${session.program ?? "(none)"}`,
  );
  return `${prefix}:\n${lines.join("\n")}`;
}
