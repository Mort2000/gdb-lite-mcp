import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export type EnvironmentMap = Record<string, string>;

export type SpawnArgs = {
  prog_path?: string;
  work_dir: string;
  environments?: EnvironmentMap;
  core_path?: string;
  attach_pid?: number;
  remote_target?: string;
  gdb_args?: string[];
};

export type GdbExecResult = {
  output: string;
  completion_reason: "completed" | "timeout" | "exited";
  saw_prompt: boolean;
  timed_out: boolean;
  session_exited: boolean;
  at_prompt: boolean;
  command_pending: boolean;
  needs_interrupt: boolean;
  bytes: number;
  duration_ms: number;
  truncated: boolean;
  omitted_bytes: number;
  internal_buffer_bytes: number;
};

export type GdbInterruptResult = GdbExecResult & {
  interrupted: boolean;
};

type Waiter = {
  fromOffset: number;
  sentinel?: string;
  resolve: (result: WaitResult) => void;
  promptTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
};

type WaitResult = {
  reason: "prompt" | "sentinel" | "timeout" | "exited";
};

type GdbSession = {
  id: string;
  prompt: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
  bufferStart: number;
  readOffset: number;
  pendingSentinels: Set<string>;
  waiters: Set<Waiter>;
  queue: Promise<void>;
  atPrompt: boolean;
  commandPending: boolean;
  exited: boolean;
  exitSummary?: string;
};

const PROMPT_PREFIX = "__GDB_LITE_PROMPT_";
const DONE_PREFIX = "__GDB_LITE_DONE_";
const PROMPT_SETTLE_MS = 20;
const MAX_INTERNAL_BUFFER_CHARS = 4 * 1024 * 1024;
const MAX_TIMEOUT_SECONDS = 600;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export class GdbController {
  private readonly sessions = new Map<string, GdbSession>();

  constructor(private readonly gdbPath = process.env.GDB_LITE_GDB_PATH ?? "gdb") {}

  async spawn(args: SpawnArgs): Promise<string> {
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
    const prompt = `${PROMPT_PREFIX}${sessionId.replaceAll("-", "")}__`;
    const child = spawn(this.gdbPath, buildGdbArgs({
      prompt,
      progPath,
      corePath,
      attachPid: args.attach_pid,
      remoteTarget,
      extraArgs: gdbArgs,
    }), {
      cwd: workDir,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...environments,
      },
    });

    child.stdin.setDefaultEncoding("utf8");

    const session: GdbSession = {
      id: sessionId,
      prompt,
      child,
      output: "",
      bufferStart: 0,
      readOffset: 0,
      pendingSentinels: new Set(),
      waiters: new Set(),
      queue: Promise.resolve(),
      atPrompt: false,
      commandPending: false,
      exited: false,
    };

    const append = (chunk: Buffer) => {
      this.appendOutput(session, chunk.toString("utf8"));
      this.refreshStateFromOutput(session);
      this.resolvePromptWaiters(session);
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      this.appendOutput(session, `[gdb process error] ${error.message}\n`);
      session.exited = true;
      session.atPrompt = false;
      session.commandPending = false;
      session.exitSummary = `gdb process error: ${error.message}`;
      this.resolveAllWaiters(session, { reason: "exited" });
    });
    child.on("exit", (code, signal) => {
      session.exited = true;
      session.atPrompt = false;
      session.commandPending = false;
      session.exitSummary = `gdb exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
      this.appendOutput(session, `[${session.exitSummary}]\n`);
      this.resolveAllWaiters(session, { reason: "exited" });
    });

    this.sessions.set(session.id, session);
    return session.id;
  }

  async exec(
    sessionId: string,
    command = "",
    timeout = 5.0,
    maxOutputBytes?: number,
  ): Promise<GdbExecResult> {
    const session = this.getSession(sessionId);
    const task = session.queue.then(() =>
      this.execUnlocked(session, command, normalizeTimeout(timeout), maxOutputBytes),
    );
    session.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async interrupt(
    sessionId: string,
    timeout = 5.0,
    maxOutputBytes?: number,
  ): Promise<GdbInterruptResult> {
    const session = this.getSession(sessionId);
    const task = session.queue.then(() =>
      this.interruptUnlocked(session, normalizeTimeout(timeout), maxOutputBytes),
    );
    session.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    this.sessions.delete(sessionId);
    session.exited = true;
    session.atPrompt = false;
    session.commandPending = false;
    session.exitSummary ??= "gdb session closed";
    this.resolveAllWaiters(session, { reason: "exited" });

    if (!isChildAlive(session.child)) {
      return true;
    }

    session.atPrompt = false;
    this.terminateProcess(session);
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

  private async execUnlocked(
    session: GdbSession,
    command: string,
    timeoutSeconds: number,
    maxOutputBytes: number | undefined,
  ): Promise<GdbExecResult> {
    const startedAt = Date.now();
    const startOffset = session.readOffset;

    if (session.exited) {
      if (startOffset >= bufferEnd(session)) {
        throw new Error(session.exitSummary ?? "gdb session has exited");
      }
      return this.finishExec(session, startOffset, { reason: "exited" }, startedAt, maxOutputBytes);
    }

    let sentinel: string | undefined;
    let waitFrom = startOffset;
    const line = stripTrailingNewlines(command);

    if (line !== "") {
      sentinel = `${DONE_PREFIX}${randomUUID().replaceAll("-", "")}__`;
      session.pendingSentinels.add(sentinel);
      waitFrom = bufferEnd(session);
      session.atPrompt = false;
      session.commandPending = true;
      session.child.stdin.write(`${line}\nprintf "\\n${sentinel}\\n"\n`);
    }

    const waitResult = await this.waitForPromptOrTimeout(session, waitFrom, timeoutSeconds, sentinel);
    return this.finishExec(session, startOffset, waitResult, startedAt, maxOutputBytes);
  }

  private async interruptUnlocked(
    session: GdbSession,
    timeoutSeconds: number,
    maxOutputBytes: number | undefined,
  ): Promise<GdbInterruptResult> {
    const startedAt = Date.now();
    const startOffset = session.readOffset;

    if (session.exited) {
      if (startOffset >= bufferEnd(session)) {
        throw new Error(session.exitSummary ?? "gdb session has exited");
      }
      return {
        ...this.finishExec(session, startOffset, { reason: "exited" }, startedAt, maxOutputBytes),
        interrupted: false,
      };
    }

    if (session.atPrompt && !session.commandPending) {
      return {
        ...this.finishExec(session, startOffset, { reason: "prompt" }, startedAt, maxOutputBytes),
        interrupted: false,
      };
    }

    const waitFrom = bufferEnd(session);
    session.atPrompt = false;
    session.commandPending = true;
    const interrupted = signalProcessGroup(session.child, "SIGINT");

    const waitResult = await this.waitForPromptOrTimeout(session, waitFrom, timeoutSeconds);
    return {
      ...this.finishExec(session, startOffset, waitResult, startedAt, maxOutputBytes),
      interrupted,
    };
  }

  private finishExec(
    session: GdbSession,
    startOffset: number,
    waitResult: WaitResult,
    startedAt: number,
    maxOutputBytes: number | undefined,
  ): GdbExecResult {
    const rawSlice = sliceFrom(session, startOffset);
    const cleanedOutput = stripInfrastructure(rawSlice.output, session);
    const limitedOutput = limitOutput(cleanedOutput, maxOutputBytes);
    const endOffset = bufferEnd(session);
    session.readOffset = endOffset;
    this.compactConsumedOutput(session);

    const output = limitedOutput.output;
    const omittedBytes = rawSlice.omittedBytes + limitedOutput.omittedBytes;
    const reason = waitResult.reason;
    const sawPrompt = reason === "prompt" || reason === "sentinel";
    const completionReason: GdbExecResult["completion_reason"] =
      reason === "timeout" ? "timeout" : reason === "exited" ? "exited" : "completed";
    if (reason === "prompt" || reason === "sentinel") {
      session.atPrompt = true;
      session.commandPending = false;
    } else if (reason === "exited") {
      session.atPrompt = false;
      session.commandPending = false;
    }

    return {
      output,
      completion_reason: completionReason,
      saw_prompt: sawPrompt,
      timed_out: reason === "timeout",
      session_exited: session.exited,
      at_prompt: !session.exited && session.atPrompt,
      command_pending: !session.exited && session.commandPending,
      needs_interrupt: !session.exited && session.commandPending && !session.atPrompt,
      bytes: Buffer.byteLength(output, "utf8"),
      duration_ms: Date.now() - startedAt,
      truncated: omittedBytes > 0,
      omitted_bytes: omittedBytes,
      internal_buffer_bytes: Buffer.byteLength(session.output, "utf8"),
    };
  }

  private waitForPromptOrTimeout(
    session: GdbSession,
    fromOffset: number,
    timeoutSeconds: number,
    sentinel?: string,
  ): Promise<WaitResult> {
    const immediate = getCompletionResult(session, fromOffset, sentinel);
    if (immediate) {
      return Promise.resolve(immediate);
    }

    const timeoutMs = timeoutSeconds * 1000;
    return new Promise((resolve) => {
      const waiter: Waiter = {
        fromOffset,
        sentinel,
        resolve: (result) => {
          if (waiter.promptTimer) {
            clearTimeout(waiter.promptTimer);
          }
          if (waiter.timeoutTimer) {
            clearTimeout(waiter.timeoutTimer);
          }
          session.waiters.delete(waiter);
          resolve(result);
        },
      };
      waiter.timeoutTimer = setTimeout(() => waiter.resolve({ reason: "timeout" }), timeoutMs);
      session.waiters.add(waiter);
      this.maybeResolvePromptWaiter(session, waiter);
    });
  }

  private resolvePromptWaiters(session: GdbSession): void {
    for (const waiter of Array.from(session.waiters)) {
      this.maybeResolvePromptWaiter(session, waiter);
    }
  }

  private resolveAllWaiters(session: GdbSession, result: WaitResult): void {
    for (const waiter of Array.from(session.waiters)) {
      waiter.resolve(result);
    }
  }

  private maybeResolvePromptWaiter(session: GdbSession, waiter: Waiter): void {
    if (waiter.promptTimer) {
      clearTimeout(waiter.promptTimer);
      waiter.promptTimer = undefined;
    }

    const result = getCompletionResult(session, waiter.fromOffset, waiter.sentinel);
    if (!result) {
      return;
    }

    if (result.reason === "exited") {
      waiter.resolve(result);
      return;
    }

    waiter.promptTimer = setTimeout(() => {
      waiter.promptTimer = undefined;
      const settledResult = getCompletionResult(session, waiter.fromOffset, waiter.sentinel);
      if (settledResult) {
        session.atPrompt = true;
        waiter.resolve(settledResult);
      }
    }, PROMPT_SETTLE_MS);
  }

  private refreshStateFromOutput(session: GdbSession): void {
    const ready = hasReadyPromptSince(session, session.bufferStart);
    session.atPrompt = ready;
    if (ready || hasAnyPendingSentinelSince(session, session.bufferStart)) {
      session.commandPending = false;
    }
  }

  private appendOutput(session: GdbSession, text: string): void {
    session.output += text;
    if (session.output.length <= MAX_INTERNAL_BUFFER_CHARS) {
      return;
    }

    const dropChars = session.output.length - MAX_INTERNAL_BUFFER_CHARS;
    session.output = session.output.slice(dropChars);
    session.bufferStart += dropChars;
  }

  private compactConsumedOutput(session: GdbSession): void {
    if (session.waiters.size > 0 || session.readOffset <= session.bufferStart) {
      return;
    }

    const dropChars = Math.min(session.readOffset - session.bufferStart, session.output.length);
    session.output = session.output.slice(dropChars);
    session.bufferStart += dropChars;
  }

  private terminateProcess(session: GdbSession): void {
    const { child } = session;

    signalProcessGroup(child, "SIGINT");
    if (child.stdin.writable && !child.stdin.destroyed) {
      child.stdin.write("quit\n");
      child.stdin.end();
    }

    const termTimer = setTimeout(() => {
      if (isChildAlive(child)) {
        signalProcessGroup(child, "SIGTERM");
      }
    }, 100);
    const killTimer = setTimeout(() => {
      if (isChildAlive(child)) {
        signalProcessGroup(child, "SIGKILL");
      }
    }, 1000);
    termTimer.unref();
    killTimer.unref();
    child.once("exit", () => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
    });
  }
}

function isChildAlive(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): boolean {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // Fall through to direct child signaling. This covers platforms or GDB
      // launch failures where a process group was not created.
    }
  }
  return child.kill(signal);
}

function stripTrailingNewlines(command: string): string {
  return command.replace(/(?:\r?\n)+$/u, "");
}

function validateEnvironment(environments: EnvironmentMap): void {
  for (const [name, value] of Object.entries(environments)) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`invalid environment variable name: ${name}`);
    }
    if (typeof value !== "string") {
      throw new Error(`environment variable value must be a string: ${name}`);
    }
  }
}

function validateGdbArgs(args: string[]): void {
  for (const [index, arg] of args.entries()) {
    if (typeof arg !== "string") {
      throw new Error(`gdb_args[${index}] must be a string`);
    }
    if (arg.includes("\0")) {
      throw new Error(`gdb_args[${index}] contains a NUL byte`);
    }
  }
}

function validateAttachPid(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`attach_pid must be a positive integer: ${pid}`);
  }
}

function validateSpawnMode(args: SpawnArgs): void {
  const modes = [args.core_path !== undefined, args.attach_pid !== undefined, args.remote_target !== undefined]
    .filter(Boolean).length;
  if (modes > 1) {
    throw new Error("gdb_spawn supports only one of core_path, attach_pid, or remote_target at a time");
  }
}

function normalizeRemoteTarget(remoteTarget: string | undefined): string | undefined {
  if (remoteTarget === undefined) {
    return undefined;
  }
  const trimmed = remoteTarget.trim();
  if (trimmed === "") {
    throw new Error("remote_target must not be empty");
  }
  if (/[\0\r\n]/u.test(trimmed)) {
    throw new Error("remote_target must not contain control characters");
  }
  return trimmed;
}

function normalizeTimeout(timeoutSeconds: number): number {
  if (!Number.isFinite(timeoutSeconds)) {
    throw new Error(`timeout must be finite: ${timeoutSeconds}`);
  }
  if (timeoutSeconds < 0 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`timeout must be between 0 and ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return timeoutSeconds;
}

function buildGdbArgs(options: {
  prompt: string;
  progPath?: string;
  corePath?: string;
  attachPid?: number;
  remoteTarget?: string;
  extraArgs: string[];
}): string[] {
  const args = [
    "--quiet",
    "--nx",
    "--nh",
    ...options.extraArgs,
  ];

  if (options.progPath) {
    args.push(`--se=${options.progPath}`);
  }
  if (options.corePath) {
    args.push(`--core=${options.corePath}`);
  }
  if (options.attachPid !== undefined) {
    args.push(`--pid=${options.attachPid}`);
  }

  args.push(
    "-ex",
    "set pagination off",
    "-ex",
    "set confirm off",
    "-ex",
    `set prompt ${options.prompt}`,
  );

  if (options.remoteTarget) {
    args.push("-ex", `target remote ${options.remoteTarget}`);
  }

  return args;
}

function getCompletionResult(
  session: GdbSession,
  fromOffset: number,
  sentinel?: string,
): WaitResult | undefined {
  if (session.exited) {
    return { reason: "exited" };
  }

  if (sentinel) {
    return hasTextSince(session, sentinel, fromOffset) ? { reason: "sentinel" } : undefined;
  }

  if (session.atPrompt || hasReadyPromptSince(session, fromOffset)) {
    return { reason: "prompt" };
  }

  return undefined;
}

function hasTextSince(session: GdbSession, text: string, fromOffset: number): boolean {
  const index = session.output.lastIndexOf(text);
  return index >= 0 && session.bufferStart + index >= fromOffset;
}

function hasReadyPromptSince(session: GdbSession, fromOffset: number): boolean {
  const promptIndex = session.output.lastIndexOf(session.prompt);
  if (promptIndex < 0 || session.bufferStart + promptIndex < fromOffset) {
    return false;
  }

  return session.output.slice(promptIndex + session.prompt.length).trim() === "";
}

function hasAnyPendingSentinelSince(session: GdbSession, fromOffset: number): boolean {
  for (const sentinel of session.pendingSentinels) {
    if (hasTextSince(session, sentinel, fromOffset)) {
      return true;
    }
  }
  return false;
}

function bufferEnd(session: GdbSession): number {
  return session.bufferStart + session.output.length;
}

function sliceFrom(session: GdbSession, fromOffset: number): { output: string; omittedBytes: number } {
  if (fromOffset < session.bufferStart) {
    const omittedBytes = session.bufferStart - fromOffset;
    return {
      output: `[gdb-lite output truncated: ${omittedBytes} bytes omitted from start]\n${session.output}`,
      omittedBytes,
    };
  }

  return {
    output: session.output.slice(fromOffset - session.bufferStart),
    omittedBytes: 0,
  };
}

function stripInfrastructure(output: string, session: GdbSession): string {
  let stripped = output.split(session.prompt).join("");
  for (const sentinel of Array.from(session.pendingSentinels)) {
    if (stripped.includes(sentinel)) {
      stripped = stripped.split(sentinel).join("");
      session.pendingSentinels.delete(sentinel);
    }
  }
  return stripped;
}

function limitOutput(
  output: string,
  maxOutputBytes: number | undefined,
): { output: string; omittedBytes: number } {
  if (maxOutputBytes === undefined) {
    return { output, omittedBytes: 0 };
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("max_output_bytes must be a positive integer");
  }

  const buffer = Buffer.from(output, "utf8");
  if (buffer.byteLength <= maxOutputBytes) {
    return { output, omittedBytes: 0 };
  }

  const omittedBytes = buffer.byteLength - maxOutputBytes;
  return {
    output: `[gdb-lite output truncated: ${omittedBytes} bytes omitted from start]\n${buffer
      .subarray(omittedBytes)
      .toString("utf8")}`,
    omittedBytes,
  };
}
