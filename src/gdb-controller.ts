import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import {
  resolveAutoInitEnabled,
  resolveMaxInternalBufferChars,
  resolveMaxSessions,
} from "./config.js";
import { buildGdbArgs, validateGdbArgs } from "./gdb-process.js";
import { GdbSession } from "./gdb-session.js";
import {
  normalizeRemoteTarget,
  validateAttachPid,
  validateEnvironment,
  validateSpawnMode,
} from "./spawn-validation.js";
import type {
  GdbExecResult,
  GdbInterruptResult,
  SessionInfo,
  SpawnArgs,
} from "./types.js";

export type {
  EnvironmentMap,
  GdbExecResult,
  GdbInterruptResult,
  SessionInfo,
  SpawnArgs,
} from "./types.js";

export type GdbControllerOptions = {
  gdbPath?: string;
  maxSessions?: number;
  maxInternalBufferChars?: number;
  autoInitCommands?: boolean;
};

export class GdbController {
  private readonly sessions = new Map<string, GdbSession>();
  private pendingSpawns = 0;
  private readonly gdbPath: string;
  private readonly maxSessions: number;
  private readonly maxInternalBufferChars: number;
  private readonly autoInitCommands: boolean;

  constructor(optionsOrGdbPath: GdbControllerOptions | string = {}) {
    const options = typeof optionsOrGdbPath === "string" ? { gdbPath: optionsOrGdbPath } : optionsOrGdbPath;
    this.gdbPath = options.gdbPath ?? process.env.GDB_LITE_GDB_PATH ?? "gdb";
    this.maxSessions = resolveMaxSessions(options.maxSessions);
    this.maxInternalBufferChars = resolveMaxInternalBufferChars(options.maxInternalBufferChars);
    this.autoInitCommands = resolveAutoInitEnabled(options.autoInitCommands);
  }

  async spawn(args: SpawnArgs): Promise<string> {
    if (this.sessions.size + this.pendingSpawns >= this.maxSessions) {
      throw new Error(
        `maximum gdb sessions reached: ${this.sessions.size + this.pendingSpawns}/${this.maxSessions}; close an existing session with gdb_close before spawning another`,
      );
    }
    this.pendingSpawns++;

    try {
      const workDir = path.resolve(args.work_dir);
      const progPath = args.prog_path ? path.resolve(workDir, args.prog_path) : undefined;
      const corePath = args.core_path ? path.resolve(workDir, args.core_path) : undefined;
      const environments = args.environments ?? {};
      const gdbArgs = args.gdb_args ?? [];
      const remoteTarget = normalizeRemoteTarget(args.remote_target);

      validateEnvironment(environments);
      validateGdbArgs(gdbArgs);
      validateAttachPid(args.attach_pid);
      validateSpawnMode(args);
      const workDirStat = await stat(workDir);
      if (!workDirStat.isDirectory()) {
        throw new Error(`work_dir is not a directory: ${workDir}`);
      }
      await access(workDir, constants.R_OK | constants.X_OK);
      if (progPath) {
        await access(progPath, constants.R_OK);
      }
      if (corePath) {
        await access(corePath, constants.R_OK);
      }

      const sessionId = randomUUID();
      const child = spawn(this.gdbPath, buildGdbArgs({
        progPath,
        corePath,
        attachPid: args.attach_pid,
        remoteTarget,
        extraArgs: gdbArgs,
        autoInitCommands: this.autoInitCommands,
      }), {
        cwd: workDir,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          ...environments,
        },
      });

      const session = new GdbSession({
        id: sessionId,
        child,
        workDir,
        program: progPath ?? null,
        maxInternalBufferChars: this.maxInternalBufferChars,
        onExit: (exitedSession) => {
          if (this.sessions.get(exitedSession.id) === exitedSession) {
            this.sessions.delete(exitedSession.id);
          }
        },
      });

      this.sessions.set(session.id, session);
      return session.id;
    } finally {
      this.pendingSpawns--;
    }
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values(), (session) => session.info());
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async exec(
    sessionId: string,
    command = "",
    timeout = 5.0,
    maxOutputBytes?: number,
  ): Promise<GdbExecResult> {
    return this.getSession(sessionId).exec(command, timeout, maxOutputBytes);
  }

  async interrupt(
    sessionId: string,
    timeout = 5.0,
    maxOutputBytes?: number,
  ): Promise<GdbInterruptResult> {
    return this.getSession(sessionId).interrupt(timeout, maxOutputBytes);
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    this.sessions.delete(sessionId);
    session.close();
    return true;
  }

  closeAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.close(id);
    }
  }

  private getSession(sessionId: string): GdbSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`unknown gdb session: ${sessionId}`);
    }
    return session;
  }
}
