import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseMiLine } from "./mi-parser.js";
import { isChildAlive, signalProcessGroup } from "./gdb-process.js";
import { limitOutput, SessionBuffer } from "./session-buffer.js";
import { TempFileRegistry } from "./temp-files.js";
import { normalizeTimeout } from "./timeouts.js";
import type { GdbExecResult, GdbInterruptResult, SessionInfo } from "./types.js";

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

export type GdbSessionOptions = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  workDir: string;
  program: string | null;
  maxInternalBufferChars: number;
  onExit?: (session: GdbSession) => void;
};

const DONE_PREFIX = "__GDB_LITE_DONE_";
const PROMPT_SETTLE_MS = 20;
const TERMINAL_TOKEN_RESULTS = new Set(["done", "connected", "error", "exit"]);

export class GdbSession {
  readonly id: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly workDir: string;
  private readonly program: string | null;
  private readonly buffer: SessionBuffer;
  private readonly tempFiles: TempFileRegistry;
  private readonly onExit?: (session: GdbSession) => void;
  private readonly pendingSentinels = new Set<string>();
  private readonly waiters = new Set<Waiter>();
  private readonly tokenResults = new Map<number, string>();
  private miBuffer = "";
  private nextToken = 1;
  private activeCommand?: ActiveCommand;
  private operationInFlight = false;
  private atPrompt = false;
  private commandPending = false;
  private targetRunning = false;
  private exited = false;
  private exitSummary?: string;

  constructor(options: GdbSessionOptions) {
    this.id = options.id;
    this.child = options.child;
    this.workDir = options.workDir;
    this.program = options.program;
    this.buffer = new SessionBuffer(options.maxInternalBufferChars);
    this.tempFiles = new TempFileRegistry(options.id);
    this.onExit = options.onExit;

    this.child.stdin.setDefaultEncoding("utf8");
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.appendMiData(chunk.toString("utf8"));
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.appendOutput(chunk.toString("utf8"));
    });
    this.child.on("error", (error) => {
      this.markExited(`gdb process error: ${error.message}`);
      this.appendOutput(`[gdb process error] ${error.message}\n`);
      this.resolveAllWaiters({ reason: "exited" });
      this.tempFiles.cleanupAll();
      this.onExit?.(this);
    });
    this.child.on("exit", (code, signal) => {
      const summary = `gdb exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
      this.markExited(summary);
      this.appendOutput(`[${summary}]\n`);
      this.resolveAllWaiters({ reason: "exited" });
      this.tempFiles.cleanupAll();
      this.onExit?.(this);
    });
  }

  info(): SessionInfo {
    return {
      session_id: this.id,
      work_dir: this.workDir,
      program: this.program,
    };
  }

  async exec(
    command = "",
    timeout = 5.0,
    maxOutputBytes?: number,
  ): Promise<GdbExecResult> {
    return this.runExclusive(() =>
      this.execUnlocked(command, normalizeTimeout(timeout), maxOutputBytes),
    );
  }

  async interrupt(timeout = 5.0, maxOutputBytes?: number): Promise<GdbInterruptResult> {
    return this.runExclusive(() =>
      this.interruptUnlocked(normalizeTimeout(timeout), maxOutputBytes),
    );
  }

  close(): void {
    this.markExited(this.exitSummary ?? "gdb session closed");
    this.resolveAllWaiters({ reason: "exited" });
    this.tempFiles.cleanupAll();

    if (!isChildAlive(this.child)) {
      return;
    }

    this.terminateProcess();
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.operationInFlight) {
      throw new Error("gdb session already has an exec or interrupt in progress");
    }

    this.operationInFlight = true;
    try {
      return await operation();
    } finally {
      this.operationInFlight = false;
    }
  }

  private markExited(summary: string): void {
    this.exited = true;
    this.atPrompt = false;
    this.commandPending = false;
    this.targetRunning = false;
    this.exitSummary = summary;
    this.finishActiveCommand();
  }

  private async execUnlocked(
    command: string,
    timeoutSeconds: number,
    maxOutputBytes: number | undefined,
  ): Promise<GdbExecResult> {
    const startedAt = Date.now();
    const startOffset = this.buffer.readOffset;

    if (this.exited) {
      if (startOffset >= this.buffer.endOffset) {
        throw new Error(this.exitSummary ?? "gdb session has exited");
      }
      return this.finishExec(startOffset, { reason: "exited" }, startedAt, maxOutputBytes);
    }

    const line = stripTrailingNewlines(command);
    let waitSentinel = this.activeCommand?.sentinel;
    let waitToken = this.activeCommand?.token;

    if (line !== "") {
      if (this.commandPending || this.targetRunning) {
        throw new Error(
          "gdb session has a pending command or running target; poll with an empty command or call gdb_interrupt before sending another command",
        );
      }

      const activeCommand = await this.startConsoleScript(line);
      waitSentinel = activeCommand.sentinel;
      waitToken = activeCommand.token;
    }

    const waitResult = await this.waitForCompletion(startOffset, timeoutSeconds, waitSentinel, waitToken);
    return this.finishExec(startOffset, waitResult, startedAt, maxOutputBytes);
  }

  private async interruptUnlocked(
    timeoutSeconds: number,
    maxOutputBytes: number | undefined,
  ): Promise<GdbInterruptResult> {
    const startedAt = Date.now();
    const startOffset = this.buffer.readOffset;

    if (this.exited) {
      if (startOffset >= this.buffer.endOffset) {
        throw new Error(this.exitSummary ?? "gdb session has exited");
      }
      return {
        ...this.finishExec(startOffset, { reason: "exited" }, startedAt, maxOutputBytes),
        interrupted: false,
      };
    }

    if (this.atPrompt && !this.commandPending && !this.targetRunning) {
      return {
        ...this.finishExec(startOffset, { reason: "prompt" }, startedAt, maxOutputBytes),
        interrupted: false,
      };
    }

    const waitSentinel = this.activeCommand?.sentinel;
    const waitToken = this.activeCommand?.token;
    this.atPrompt = false;
    this.commandPending = true;
    const interrupted = this.sendInterrupt();

    const waitResult = await this.waitForCompletion(startOffset, timeoutSeconds, waitSentinel, waitToken);
    return {
      ...this.finishExec(startOffset, waitResult, startedAt, maxOutputBytes),
      interrupted,
    };
  }

  private async startConsoleScript(command: string): Promise<ActiveCommand> {
    const token = this.nextToken++;
    const sentinel = `${DONE_PREFIX}${randomUUID().replaceAll("-", "")}__`;
    const scriptPath = await this.tempFiles.writeCommandScript(`${command}\nprintf "\\n${sentinel}\\n"\n`);
    const sourceCommand = buildExecuteScriptCommand(scriptPath);

    this.activeCommand = { token, sentinel, scriptPath };
    this.pendingSentinels.add(sentinel);
    this.tokenResults.delete(token);
    this.atPrompt = false;
    this.commandPending = true;
    this.targetRunning = false;
    this.child.stdin.write(`${token}-interpreter-exec console ${quoteMiString(sourceCommand)}\n`);
    return this.activeCommand;
  }

  private finishExec(
    startOffset: number,
    waitResult: WaitResult,
    startedAt: number,
    maxOutputBytes: number | undefined,
  ): GdbExecResult {
    const rawSlice = this.buffer.sliceFrom(startOffset);
    const cleanedOutput = this.stripInfrastructure(rawSlice.output);
    const limitedOutput = limitOutput(cleanedOutput, maxOutputBytes);
    const endOffset = this.buffer.endOffset;
    this.buffer.readOffset = endOffset;
    this.buffer.compactConsumed(this.waiters.size > 0);

    const reason = waitResult.reason;
    if (reason === "sentinel" || reason === "token" || reason === "prompt") {
      if (reason === "sentinel" || reason === "token") {
        this.finishActiveCommand();
      }
      this.commandPending = false;
      this.atPrompt = !this.exited && !this.targetRunning;
    } else if (reason === "exited") {
      this.atPrompt = false;
      this.commandPending = false;
      this.targetRunning = false;
      this.finishActiveCommand();
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
      session_exited: this.exited,
      at_prompt: !this.exited && this.atPrompt,
      command_pending: !this.exited && this.commandPending,
      needs_interrupt: !this.exited && (this.commandPending || this.targetRunning) && !this.atPrompt,
      bytes: Buffer.byteLength(output, "utf8"),
      duration_ms: Date.now() - startedAt,
      truncated: omittedBytes > 0,
      omitted_bytes: omittedBytes,
      internal_buffer_bytes: this.buffer.byteLength,
    };
  }

  private waitForCompletion(
    fromOffset: number,
    timeoutSeconds: number,
    sentinel?: string,
    token?: number,
  ): Promise<WaitResult> {
    const immediate = this.getCompletionResult(fromOffset, sentinel, token);
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
          this.waiters.delete(waiter);
          resolve(result);
        },
      };
      waiter.timeoutTimer = setTimeout(() => waiter.resolve({ reason: "timeout" }), timeoutMs);
      this.waiters.add(waiter);
      this.maybeResolveWaiter(waiter);
    });
  }

  private resolveWaiters(): void {
    for (const waiter of Array.from(this.waiters)) {
      this.maybeResolveWaiter(waiter);
    }
  }

  private resolveAllWaiters(result: WaitResult): void {
    for (const waiter of Array.from(this.waiters)) {
      waiter.resolve(result);
    }
  }

  private maybeResolveWaiter(waiter: Waiter): void {
    if (waiter.settleTimer) {
      clearTimeout(waiter.settleTimer);
      waiter.settleTimer = undefined;
    }

    const result = this.getCompletionResult(waiter.fromOffset, waiter.sentinel, waiter.token);
    if (!result) {
      return;
    }

    if (result.reason === "exited") {
      waiter.resolve(result);
      return;
    }

    waiter.settleTimer = setTimeout(() => {
      waiter.settleTimer = undefined;
      const settledResult = this.getCompletionResult(waiter.fromOffset, waiter.sentinel, waiter.token);
      if (settledResult) {
        waiter.resolve(settledResult);
      }
    }, PROMPT_SETTLE_MS);
  }

  private appendMiData(text: string): void {
    this.miBuffer += text;
    while (true) {
      const newline = this.miBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.miBuffer.slice(0, newline).replace(/\r$/u, "");
      this.miBuffer = this.miBuffer.slice(newline + 1);
      this.processMiLine(line);
    }
  }

  private processMiLine(line: string): void {
    const parsed = parseMiLine(line);
    switch (parsed.type) {
      case "prompt":
        if (!this.commandPending && !this.targetRunning && !this.exited) {
          this.atPrompt = true;
        }
        this.resolveWaiters();
        break;
      case "stream":
        this.appendOutput(parsed.text);
        break;
      case "result":
        this.handleMiResult(parsed.token, parsed.resultClass);
        break;
      case "running":
        this.targetRunning = true;
        this.atPrompt = false;
        this.resolveWaiters();
        break;
      case "stopped":
        this.targetRunning = false;
        if (!this.activeCommand) {
          this.commandPending = false;
          this.atPrompt = true;
        }
        this.resolveWaiters();
        break;
      case "thread-group-exited":
        this.targetRunning = false;
        this.resolveWaiters();
        break;
      case "ignored":
        break;
      case "output":
        this.appendOutput(parsed.text);
        break;
    }
  }

  private handleMiResult(token: number, resultClass: string): void {
    this.tokenResults.set(token, resultClass);

    if (resultClass === "running") {
      this.targetRunning = true;
      this.commandPending = true;
      this.atPrompt = false;
    } else if (resultClass === "exit") {
      this.markExited("gdb exited");
    } else if (isTerminalTokenResult(resultClass)) {
      this.commandPending = false;
      this.atPrompt = !this.exited && !this.targetRunning;
    }

    this.resolveWaiters();
  }

  private appendOutput(text: string): void {
    this.buffer.append(text);
    this.resolveWaiters();
  }

  private finishActiveCommand(): void {
    const active = this.activeCommand;
    if (!active) {
      return;
    }
    this.activeCommand = undefined;
    this.pendingSentinels.delete(active.sentinel);
    this.tokenResults.delete(active.token);
    this.tempFiles.cleanupFile(active.scriptPath);
  }

  private sendInterrupt(): boolean {
    if (this.targetRunning && this.activeCommand === undefined && this.child.stdin.writable && !this.child.stdin.destroyed) {
      const token = this.nextToken++;
      this.child.stdin.write(`${token}-exec-interrupt --all\n`);
      return true;
    }
    return signalProcessGroup(this.child, "SIGINT");
  }

  private terminateProcess(): void {
    signalProcessGroup(this.child, "SIGINT");
    if (this.child.stdin.writable && !this.child.stdin.destroyed) {
      const token = this.nextToken++;
      this.child.stdin.write(`${token}-gdb-exit\n`);
      this.child.stdin.end();
    }

    const termTimer = setTimeout(() => {
      if (isChildAlive(this.child)) {
        signalProcessGroup(this.child, "SIGTERM");
      }
    }, 100);
    const killTimer = setTimeout(() => {
      if (isChildAlive(this.child)) {
        signalProcessGroup(this.child, "SIGKILL");
      }
    }, 1000);
    termTimer.unref();
    killTimer.unref();
    this.child.once("exit", () => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
    });
  }

  private getCompletionResult(
    fromOffset: number,
    sentinel?: string,
    token?: number,
  ): WaitResult | undefined {
    if (this.exited) {
      return { reason: "exited" };
    }

    if (sentinel && this.buffer.hasTextSince(sentinel, fromOffset)) {
      return { reason: "sentinel" };
    }

    if (token !== undefined && isTerminalTokenResult(this.tokenResults.get(token))) {
      return { reason: "token" };
    }

    if (!sentinel && !token && this.atPrompt && !this.commandPending && !this.targetRunning) {
      return { reason: "prompt" };
    }

    return undefined;
  }

  private stripInfrastructure(output: string): string {
    let stripped = output;
    for (const sentinel of Array.from(this.pendingSentinels)) {
      if (stripped.includes(sentinel)) {
        stripped = stripped.split(sentinel).join("");
        this.pendingSentinels.delete(sentinel);
      }
    }
    return stripped;
  }
}

function isTerminalTokenResult(result: string | undefined): boolean {
  return result !== undefined && TERMINAL_TOKEN_RESULTS.has(result);
}

function stripTrailingNewlines(command: string): string {
  return command.replace(/(?:\r?\n)+$/u, "");
}

function quoteMiString(value: string): string {
  return JSON.stringify(value);
}

function buildExecuteScriptCommand(scriptPath: string): string {
  return `python import gdb; gdb.execute(open(${quoteMiString(scriptPath)}, encoding="utf-8").read())`;
}
