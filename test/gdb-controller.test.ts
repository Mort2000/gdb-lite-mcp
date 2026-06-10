import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn as spawnChild, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { GdbController } from "../src/gdb-controller.js";

const execFileAsync = promisify(execFile);

const source = `
#include <stdio.h>

static int fib(int n) {
  if (n <= 1) {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

static int weighted_sum(int limit) {
  int total = 0;
  for (int i = 0; i < limit; i++) {
    total += fib(i) * (i + 1);
  }
  return total;
}

int main(void) {
  int result = weighted_sum(7);
  printf("(gdb) from inferior output\\n");
  printf("result=%d\\n", result);
  return 0;
}
`;

const sleeperSource = `
#include <stdio.h>
#include <unistd.h>

#ifdef __linux__
#include <sys/prctl.h>
#ifndef PR_SET_PTRACER
#define PR_SET_PTRACER 0x59616d61
#endif
#ifndef PR_SET_PTRACER_ANY
#define PR_SET_PTRACER_ANY ((unsigned long)-1)
#endif
#endif

int main(int argc, char **argv) {
#ifdef __linux__
  prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0);
#endif
  if (argc > 1) {
    FILE *ready = fopen(argv[1], "w");
    if (ready != NULL) {
      fputs("ready\\n", ready);
      fclose(ready);
    }
  }

  volatile unsigned long ticks = 0;
  while (1) {
    ticks++;
    usleep(10000);
  }
  return 0;
}
`;

const workDir = await mkdtemp(path.join(tmpdir(), "gdb-lite-mcp-test-"));
const sourcePath = path.join(workDir, "sample.c");
const programPath = path.join(workDir, "sample");
const sleeperSourcePath = path.join(workDir, "sleeper.c");
const sleeperPath = path.join(workDir, "sleeper");

await writeFile(sourcePath, source);
await writeFile(sleeperSourcePath, sleeperSource);
await execFileAsync("gcc", ["-g", "-O0", sourcePath, "-o", programPath], {
  cwd: workDir,
});
await execFileAsync("gcc", ["-g", "-O0", sleeperSourcePath, "-o", sleeperPath], {
  cwd: workDir,
});

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPath(filePath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath);
      return;
    } catch {
      await delay(25);
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

const controller = new GdbController();
const sessionId = await controller.spawn({
  prog_path: programPath,
  work_dir: workDir,
});

try {
  const initial = await controller.exec(sessionId, "", 2);
  assert.equal(initial.completion_reason, "prompt");
  assert.equal(initial.saw_prompt, true);
  assert.equal(initial.at_prompt, true);
  assert.equal(initial.command_pending, false);
  assert.equal(initial.needs_interrupt, false);
  assert.equal(initial.output.includes("__GDB_LITE_PROMPT_"), false);

  const multiCommand = await controller.exec(sessionId, "print 1\nprint 2\n", 2);
  assert.equal(multiCommand.completion_reason, "sentinel");
  assert.match(multiCommand.output, /= 1/);
  assert.match(multiCommand.output, /= 2/);
  assert.equal(multiCommand.output.includes("__GDB_LITE_DONE_"), false);

  const timeoutCommand = await controller.exec(sessionId, "shell sleep 0.2", 0.01);
  assert.equal(timeoutCommand.timed_out, true);
  assert.equal(timeoutCommand.at_prompt, false);
  assert.equal(timeoutCommand.command_pending, true);
  assert.equal(timeoutCommand.needs_interrupt, true);
  await delay(300);
  const delayedPoll = await controller.exec(sessionId, "", 1);
  assert.equal(delayedPoll.at_prompt, true);
  assert.equal(delayedPoll.command_pending, false);
  assert.equal(delayedPoll.needs_interrupt, false);
  assert.equal(delayedPoll.output.includes("__GDB_LITE_DONE_"), false);

  const customPrompt = await controller.exec(sessionId, "set prompt CUSTOM_PROMPT> ", 2);
  assert.equal(customPrompt.completion_reason, "sentinel");

  const afterCustomPrompt = await controller.exec(sessionId, "print 3", 2);
  assert.equal(afterCustomPrompt.completion_reason, "sentinel");
  assert.match(afterCustomPrompt.output, /= 3/);

  const emptyStartedAt = Date.now();
  const emptyPoll = await controller.exec(sessionId, "", 1);
  assert.equal(emptyPoll.output, "");
  assert.ok(Date.now() - emptyStartedAt < 250, "empty poll should return immediately at the gdb prompt");

  const breakpoint = await controller.exec(sessionId, "break weighted_sum\n", 2);
  assert.match(breakpoint.output, /Breakpoint 1/);

  const run = await controller.exec(sessionId, "run", 5);
  assert.match(run.output, /Breakpoint 1, weighted_sum/);

  const args = await controller.exec(sessionId, "print limit", 2);
  assert.match(args.output, /= 7/);

  const trace = await controller.exec(
    sessionId,
    "commands 1\nsilent\nprintf \"hit weighted_sum limit=%d\\n\", limit\ncontinue\nend",
    2,
  );
  assert.equal(trace.completion_reason, "sentinel");

  const rerun = await controller.exec(sessionId, "run", 5);
  assert.match(rerun.output, /hit weighted_sum limit=7/);
  assert.match(rerun.output, /\(gdb\) from inferior output/);
  assert.match(rerun.output, /result=114/);
  assert.match(rerun.output, /exited normally/);

  const truncated = await controller.exec(
    sessionId,
    'python\nprint("x" * 20000)\nend',
    2,
    256,
  );
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.omitted_bytes > 0);
  assert.ok(truncated.bytes > 256);
  assert.match(truncated.output, /bytes omitted from start/);
} finally {
  controller.close(sessionId);
  controller.close(sessionId);
}

const interruptSessionId = await controller.spawn({
  prog_path: sleeperPath,
  work_dir: workDir,
  gdb_args: ["-iex", "set debuginfod enabled off"],
});

try {
  await controller.exec(interruptSessionId, "", 2);
  const running = await controller.exec(interruptSessionId, "run", 0.1);
  assert.equal(running.timed_out, true);
  assert.equal(running.at_prompt, false);
  assert.equal(running.command_pending, true);
  assert.equal(running.needs_interrupt, true);

  const interrupted = await controller.interrupt(interruptSessionId, 10);
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.at_prompt, true);
  assert.equal(interrupted.command_pending, false);
  assert.equal(interrupted.needs_interrupt, false);

  const backtrace = await controller.exec(interruptSessionId, "bt", 2);
  assert.match(backtrace.output, /main/);
} finally {
  controller.close(interruptSessionId);
}

const corePath = path.join(workDir, "sample.core");
const coreMakerSessionId = await controller.spawn({
  prog_path: programPath,
  work_dir: workDir,
});

try {
  await controller.exec(coreMakerSessionId, "", 2);
  const stopped = await controller.exec(coreMakerSessionId, "break weighted_sum\nrun", 5);
  assert.match(stopped.output, /Breakpoint .*weighted_sum/);
  const generatedCore = await controller.exec(coreMakerSessionId, `generate-core-file ${corePath}`, 5);
  assert.match(generatedCore.output, /Saved corefile|Saved core file|core file/);
} finally {
  controller.close(coreMakerSessionId);
}

const coreSessionId = await controller.spawn({
  prog_path: programPath,
  core_path: corePath,
  work_dir: workDir,
  gdb_args: ["-ex", "set print frame-arguments all"],
});

try {
  const coreInitial = await controller.exec(coreSessionId, "", 5);
  assert.equal(coreInitial.at_prompt, true);
  const coreBacktrace = await controller.exec(coreSessionId, "bt", 2);
  assert.match(coreBacktrace.output, /weighted_sum/);
} finally {
  controller.close(coreSessionId);
}

const readyPath = path.join(workDir, "sleeper.ready");
const attachedChild = spawnChild(sleeperPath, [readyPath], {
  cwd: workDir,
  stdio: "ignore",
});
assert.ok(attachedChild.pid);

try {
  await waitForPath(readyPath, 3000);
  const attachSessionId = await controller.spawn({
    prog_path: sleeperPath,
    work_dir: workDir,
    attach_pid: attachedChild.pid,
  });

  try {
    const attached = await controller.exec(attachSessionId, "", 5);
    assert.equal(attached.at_prompt, true);
    assert.doesNotMatch(attached.output, /Operation not permitted|ptrace/);
    const attachBacktrace = await controller.exec(attachSessionId, "bt", 2);
    assert.match(attachBacktrace.output, /main/);
  } finally {
    controller.close(attachSessionId);
  }
} finally {
  await stopProcess(attachedChild);
}

const remoteSessionId = await controller.spawn({
  work_dir: workDir,
  remote_target: "127.0.0.1:1",
  gdb_args: ["-ex", "set tcp connect-timeout 1"],
});

try {
  const remoteInitial = await controller.exec(remoteSessionId, "", 5);
  assert.equal(remoteInitial.at_prompt, true);
  assert.equal(remoteInitial.command_pending, false);
} finally {
  controller.close(remoteSessionId);
}

const concurrentSessionId = await controller.spawn({
  prog_path: programPath,
  work_dir: workDir,
});

try {
  await controller.exec(concurrentSessionId, "", 2);
  const [first, second, third] = await Promise.all([
    controller.exec(concurrentSessionId, "python\nimport time\ntime.sleep(0.05)\nprint('first done')\nend", 2),
    controller.exec(concurrentSessionId, "print 22", 2),
    controller.exec(concurrentSessionId, "print 33", 2),
  ]);
  assert.match(first.output, /first done/);
  assert.doesNotMatch(first.output, /= 22/);
  assert.match(second.output, /= 22/);
  assert.doesNotMatch(second.output, /= 33/);
  assert.match(third.output, /= 33/);
} finally {
  controller.close(concurrentSessionId);
}

const exitSessionId = await controller.spawn({
  prog_path: programPath,
  work_dir: workDir,
});

await controller.exec(exitSessionId, "", 2);
const quit = await controller.exec(exitSessionId, "quit", 2);
assert.equal(quit.session_exited, true);
assert.equal(quit.completion_reason, "exited");
await assert.rejects(
  () => controller.exec(exitSessionId, "", 1),
  /gdb exited|gdb session closed|gdb session has exited/,
);
controller.close(exitSessionId);

console.log("gdb controller integration test passed");
