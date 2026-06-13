import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

type CompletionReason = "prompt" | "sentinel" | "token" | "timeout" | "exited";

type WaitResult = {
  reason: CompletionReason;
};

type Waiter = {
  fromOffset: number;
  sentinel?: string;
  token?: number;
  resolve: (result: WaitResult) => void;
  settleTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
};

type ActiveCommand = {
  token: number;
  sentinel: string;
  scriptPath: string;
};

type GdbSession = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
  bufferStart: number;
  readOffset: number;
  pendingSentinels: Set<string>;
  waiters: Set<Waiter>;
  queue: Promise<void>;
  atPrompt: boolean;
  commandPending: boolean;
  targetRunning: boolean;
  exited: boolean;
  exitSummary?: string;
  miBuffer: string;
  nextToken: number;
  tokenResults: Map<number, string>;
  activeCommand?: ActiveCommand;
  tempFiles: Set<string>;
};

const DONE_PREFIX = "__GDB_LITE_DONE_";
const PROMPT_SETTLE_MS = 20;
const MAX_INTERNAL_BUFFER_CHARS = 4 * 1024 * 1024;
const MAX_TIMEOUT_SECONDS = 600;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TERMINAL_TOKEN_RESULTS = new Set(["done", "connected", "error", "exit"]);

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
    const child = spawn(this.gdbPath, buildGdbArgs({
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
      child,
      output: "",
      bufferStart: 0,
      readOffset: 0,
      pendingSentinels: new Set(),
      waiters: new Set(),
      queue: Promise.resolve(),
      atPrompt: false,
      commandPending: false,
      targetRunning: false,
      exited: false,
      miBuffer: "",
      nextToken: 1,
      tokenResults: new Map(),
      tempFiles: new Set(),
    };

    child.stdout.on("data", (chunk: Buffer) => {
      this.appendMiData(session, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.appendOutput(session, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      this.appendOutput(session, `[gdb process error] ${error.message}\n`);
      session.exited = true;
      session.atPrompt = false;
      session.commandPending = false;
      session.targetRunning = false;
      session.exitSummary = `gdb process error: ${error.message}`;
      this.resolveAllWaiters(session, { reason: "exited" });
    });
    child.on("exit", (code, signal) => {
      session.exited = true;
      session.atPrompt = false;
      session.commandPending = false;
      session.targetRunning = false;
      session.exitSummary = `gdb exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
      this.appendOutput(session, `[${session.exitSummary}]\n`);
      this.resolveAllWaiters(session, { reason: "exited" });
      this.cleanupAllTempFiles(session);
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
    session.targetRunning = false;
    session.exitSummary ??= "gdb session closed";
    this.resolveAllWaiters(session, { reason: "exited" });
    this.cleanupAllTempFiles(session);

    if (!isChildAlive(session.child)) {
      return true;
    }

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

    const line = stripTrailingNewlines(command);
    let waitSentinel = session.activeCommand?.sentinel;
    let waitToken = session.activeCommand?.token;

    if (line !== "") {
      if (session.commandPending || session.targetRunning) {
        throw new Error(
          "gdb session has a pending command or running target; poll with an empty command or call gdb_interrupt before sending another command",
        );
      }

      const activeCommand = await this.startConsoleScript(session, line);
      waitSentinel = activeCommand.sentinel;
      waitToken = activeCommand.token;
    }

    const waitResult = await this.waitForCompletion(session, startOffset, timeoutSeconds, waitSentinel, waitToken);
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

    if (session.atPrompt && !session.commandPending && !session.targetRunning) {
      return {
        ...this.finishExec(session, startOffset, { reason: "prompt" }, startedAt, maxOutputBytes),
        interrupted: false,
      };
    }

    const waitSentinel = session.activeCommand?.sentinel;
    const waitToken = session.activeCommand?.token;
    session.atPrompt = false;
    session.commandPending = true;
    const interrupted = this.sendInterrupt(session);

    const waitResult = await this.waitForCompletion(session, startOffset, timeoutSeconds, waitSentinel, waitToken);
    return {
      ...this.finishExec(session, startOffset, waitResult, startedAt, maxOutputBytes),
      interrupted,
    };
  }

  private async startConsoleScript(session: GdbSession, command: string): Promise<ActiveCommand> {
    const token = session.nextToken++;
    const sentinel = `${DONE_PREFIX}${randomUUID().replaceAll("-", "")}__`;
    const scriptPath = await this.writeCommandScript(session, `${command}\nprintf "\\n${sentinel}\\n"\n`);
    const sourceCommand = buildExecuteScriptCommand(scriptPath);

    session.activeCommand = { token, sentinel, scriptPath };
    session.pendingSentinels.add(sentinel);
    session.tokenResults.delete(token);
    session.atPrompt = false;
    session.commandPending = true;
    session.targetRunning = false;
    session.child.stdin.write(`${token}-interpreter-exec console ${quoteMiString(sourceCommand)}\n`);
    return session.activeCommand;
  }

  private async writeCommandScript(session: GdbSession, contents: string): Promise<string> {
    const dir = await mkdtemp(path.join(commandScriptTempRoot(), "gdb-lite-mcp-"));
    const filePath = path.join(dir, `${session.id}-${randomUUID()}.gdb`);
    await writeFile(filePath, contents, { mode: 0o600 });
    session.tempFiles.add(filePath);
    return filePath;
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

    const reason = waitResult.reason;
    if (reason === "sentinel" || reason === "token" || reason === "prompt") {
      if (reason === "sentinel" || reason === "token") {
        this.finishActiveCommand(session);
      }
      session.commandPending = false;
      session.atPrompt = !session.exited && !session.targetRunning;
    } else if (reason === "exited") {
      session.atPrompt = false;
      session.commandPending = false;
      session.targetRunning = false;
      this.finishActiveCommand(session);
    }

    const output = limitedOutput.output;
    const omittedBytes = rawSlice.omittedBytes + limitedOutput.omittedBytes;
    const completionReason: GdbExecResult["completion_reason"] =
      reason === "timeout" ? "timeout" : reason === "exited" ? "exited" : "completed";

    return {
      output,
      completion_reason: completionReason,
      saw_prompt: reason === "prompt" || reason === "sentinel" || reason === "token",
      timed_out: reason === "timeout",
      session_exited: session.exited,
      at_prompt: !session.exited && session.atPrompt,
      command_pending: !session.exited && session.commandPending,
      needs_interrupt: !session.exited && (session.commandPending || session.targetRunning) && !session.atPrompt,
      bytes: Buffer.byteLength(output, "utf8"),
      duration_ms: Date.now() - startedAt,
      truncated: omittedBytes > 0,
      omitted_bytes: omittedBytes,
      internal_buffer_bytes: Buffer.byteLength(session.output, "utf8"),
    };
  }

  private waitForCompletion(
    session: GdbSession,
    fromOffset: number,
    timeoutSeconds: number,
    sentinel?: string,
    token?: number,
  ): Promise<WaitResult> {
    const immediate = getCompletionResult(session, fromOffset, sentinel, token);
    if (immediate) {
      return Promise.resolve(immediate);
    }

    const timeoutMs = timeoutSeconds * 1000;
    return new Promise((resolve) => {
      const waiter: Waiter = {
        fromOffset,
        sentinel,
        token,
        resolve: (result) => {
          if (waiter.settleTimer) {
            clearTimeout(waiter.settleTimer);
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
      this.maybeResolveWaiter(session, waiter);
    });
  }

  private resolveWaiters(session: GdbSession): void {
    for (const waiter of Array.from(session.waiters)) {
      this.maybeResolveWaiter(session, waiter);
    }
  }

  private resolveAllWaiters(session: GdbSession, result: WaitResult): void {
    for (const waiter of Array.from(session.waiters)) {
      waiter.resolve(result);
    }
  }

  private maybeResolveWaiter(session: GdbSession, waiter: Waiter): void {
    if (waiter.settleTimer) {
      clearTimeout(waiter.settleTimer);
      waiter.settleTimer = undefined;
    }

    const result = getCompletionResult(session, waiter.fromOffset, waiter.sentinel, waiter.token);
    if (!result) {
      return;
    }

    if (result.reason === "exited") {
      waiter.resolve(result);
      return;
    }

    waiter.settleTimer = setTimeout(() => {
      waiter.settleTimer = undefined;
      const settledResult = getCompletionResult(session, waiter.fromOffset, waiter.sentinel, waiter.token);
      if (settledResult) {
        waiter.resolve(settledResult);
      }
    }, PROMPT_SETTLE_MS);
  }

  private appendMiData(session: GdbSession, text: string): void {
    session.miBuffer += text;
    while (true) {
      const newline = session.miBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = session.miBuffer.slice(0, newline).replace(/\r$/u, "");
      session.miBuffer = session.miBuffer.slice(newline + 1);
      this.processMiLine(session, line);
    }
  }

  private processMiLine(session: GdbSession, line: string): void {
    if (line === "(gdb) " || line === "(gdb)") {
      if (!session.commandPending && !session.targetRunning && !session.exited) {
        session.atPrompt = true;
      }
      this.resolveWaiters(session);
      return;
    }

    if (line === "") {
      this.appendOutput(session, "\n");
      return;
    }

    const streamPrefix = line[0];
    if ((streamPrefix === "~" || streamPrefix === "@" || streamPrefix === "&") && line[1] === "\"") {
      this.appendOutput(session, decodeMiCString(line.slice(1)));
      return;
    }

    const resultMatch = line.match(/^(\d+)\^([A-Za-z-]+)(.*)$/u);
    if (resultMatch) {
      this.handleMiResult(session, Number(resultMatch[1]), resultMatch[2]);
      return;
    }

    if (line.startsWith("*running")) {
      session.targetRunning = true;
      session.atPrompt = false;
      this.resolveWaiters(session);
      return;
    }

    if (line.startsWith("*stopped")) {
      session.targetRunning = false;
      if (!session.activeCommand) {
        session.commandPending = false;
        session.atPrompt = true;
      }
      this.resolveWaiters(session);
      return;
    }

    if (line.startsWith("=thread-group-exited")) {
      session.targetRunning = false;
      this.resolveWaiters(session);
      return;
    }

    if (line.startsWith("=") || line.startsWith("+") || line.startsWith("^")) {
      return;
    }

    this.appendOutput(session, `${line}\n`);
  }

  private handleMiResult(session: GdbSession, token: number, resultClass: string): void {
    session.tokenResults.set(token, resultClass);

    if (resultClass === "running") {
      session.targetRunning = true;
      session.commandPending = true;
      session.atPrompt = false;
    } else if (resultClass === "exit") {
      session.exited = true;
      session.targetRunning = false;
      session.commandPending = false;
      session.atPrompt = false;
      session.exitSummary = "gdb exited";
    } else if (TERMINAL_TOKEN_RESULTS.has(resultClass)) {
      session.commandPending = false;
      session.atPrompt = !session.exited && !session.targetRunning;
    }

    this.resolveWaiters(session);
  }

  private appendOutput(session: GdbSession, text: string): void {
    session.output += text;
    if (session.output.length > MAX_INTERNAL_BUFFER_CHARS) {
      const dropChars = session.output.length - MAX_INTERNAL_BUFFER_CHARS;
      session.output = session.output.slice(dropChars);
      session.bufferStart += dropChars;
    }
    this.resolveWaiters(session);
  }

  private compactConsumedOutput(session: GdbSession): void {
    if (session.waiters.size > 0 || session.readOffset <= session.bufferStart) {
      return;
    }

    const dropChars = Math.min(session.readOffset - session.bufferStart, session.output.length);
    session.output = session.output.slice(dropChars);
    session.bufferStart += dropChars;
  }

  private finishActiveCommand(session: GdbSession): void {
    const active = session.activeCommand;
    if (!active) {
      return;
    }
    session.activeCommand = undefined;
    session.pendingSentinels.delete(active.sentinel);
    session.tokenResults.delete(active.token);
    this.cleanupTempFile(session, active.scriptPath);
  }

  private cleanupTempFile(session: GdbSession, filePath: string): void {
    session.tempFiles.delete(filePath);
    void rm(path.dirname(filePath), { force: true, recursive: true }).catch(() => undefined);
  }

  private cleanupAllTempFiles(session: GdbSession): void {
    const dirs = new Set(Array.from(session.tempFiles, (filePath) => path.dirname(filePath)));
    session.tempFiles.clear();
    for (const dir of dirs) {
      void rm(dir, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  private sendInterrupt(session: GdbSession): boolean {
    const { child } = session;
    if (session.targetRunning && session.activeCommand === undefined && child.stdin.writable && !child.stdin.destroyed) {
      const token = session.nextToken++;
      child.stdin.write(`${token}-exec-interrupt --all\n`);
      return true;
    }
    return signalProcessGroup(child, "SIGINT");
  }

  private terminateProcess(session: GdbSession): void {
    const { child } = session;

    signalProcessGroup(child, "SIGINT");
    if (child.stdin.writable && !child.stdin.destroyed) {
      const token = session.nextToken++;
      child.stdin.write(`${token}-gdb-exit\n`);
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
    if (
      arg === "-i" ||
      arg.startsWith("-i=") ||
      arg === "--interpreter" ||
      arg.startsWith("--interpreter=") ||
      arg === "--interp" ||
      arg.startsWith("--interp=")
    ) {
      throw new Error(`gdb_args[${index}] must not override the MI interpreter`);
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
    "--interpreter=mi3",
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
  token?: number,
): WaitResult | undefined {
  if (session.exited) {
    return { reason: "exited" };
  }

  if (sentinel && hasTextSince(session, sentinel, fromOffset)) {
    return { reason: "sentinel" };
  }

  if (token !== undefined && isTerminalTokenResult(session.tokenResults.get(token))) {
    return { reason: "token" };
  }

  if (!sentinel && !token && session.atPrompt && !session.commandPending && !session.targetRunning) {
    return { reason: "prompt" };
  }

  return undefined;
}

function isTerminalTokenResult(result: string | undefined): boolean {
  return result !== undefined && TERMINAL_TOKEN_RESULTS.has(result);
}

function hasTextSince(session: GdbSession, text: string, fromOffset: number): boolean {
  const index = session.output.lastIndexOf(text);
  return index >= 0 && session.bufferStart + index >= fromOffset;
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
  let stripped = output;
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

function quoteMiString(value: string): string {
  return JSON.stringify(value);
}

function buildExecuteScriptCommand(scriptPath: string): string {
  return `python import gdb; gdb.execute(open(${quoteMiString(scriptPath)}, encoding="utf-8").read())`;
}

function commandScriptTempRoot(): string {
  return tmpdir();
}

function decodeMiCString(value: string): string {
  if (!value.startsWith("\"")) {
    return value;
  }

  let end = value.length - 1;
  while (end > 0 && value[end] !== "\"") {
    end--;
  }
  const body = value.slice(1, end);
  let result = "";
  let utf8Bytes: number[] = [];

  const flushUtf8Bytes = () => {
    if (utf8Bytes.length === 0) {
      return;
    }
    result += Buffer.from(utf8Bytes).toString("utf8");
    utf8Bytes = [];
  };

  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char !== "\\") {
      flushUtf8Bytes();
      result += char;
      continue;
    }

    const escaped = body[++index];
    if (escaped === undefined) {
      flushUtf8Bytes();
      result += "\\";
      break;
    }

    if (escaped >= "0" && escaped <= "7") {
      let octal = escaped;
      for (let count = 0; count < 2 && index + 1 < body.length; count++) {
        const next = body[index + 1];
        if (next < "0" || next > "7") {
          break;
        }
        octal += next;
        index++;
      }
      utf8Bytes.push(Number.parseInt(octal, 8));
      continue;
    }

    flushUtf8Bytes();
    switch (escaped) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case "b":
        result += "\b";
        break;
      case "f":
        result += "\f";
        break;
      case "\"":
      case "\\":
        result += escaped;
        break;
      default:
        result += escaped;
        break;
    }
  }

  flushUtf8Bytes();
  return result;
}
