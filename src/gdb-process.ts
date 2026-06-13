import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { DEFAULT_AUTO_INIT_COMMANDS } from "./config.js";

export function buildGdbArgs(options: {
  progPath?: string;
  corePath?: string;
  attachPid?: number;
  remoteTarget?: string;
  extraArgs: string[];
  autoInitCommands: boolean;
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

  if (options.autoInitCommands) {
    for (const command of DEFAULT_AUTO_INIT_COMMANDS) {
      args.push("-ex", command);
    }
  }

  if (options.remoteTarget) {
    args.push("-ex", `target remote ${options.remoteTarget}`);
  }

  return args;
}

export function validateGdbArgs(args: string[]): void {
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

export function isChildAlive(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

export function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): boolean {
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
