import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { GdbSession } from "../../src/gdb-session.js";

class CaptureStdin extends Writable {
  readonly writes: string[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(chunk.toString());
    callback();
  }
}

type FakeChild = ChildProcessWithoutNullStreams & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: CaptureStdin;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new CaptureStdin();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = process.pid;
  child.kill = () => true;
  return child;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

const promptChild = createFakeChild();
const promptSession = new GdbSession({
  id: "prompt-session",
  child: promptChild,
  workDir: "/tmp",
  program: null,
  maxInternalBufferChars: 1024,
});
promptChild.stdout.write("(gdb) \n");
await new Promise((resolve) => setTimeout(resolve, 0));
const promptPollStartedAt = Date.now();
const promptPoll = await promptSession.exec("", 5);
assert.equal(promptPoll.completion_reason, "completed");
assert.ok(Date.now() - promptPollStartedAt < 250);

const timeoutChild = createFakeChild();
const timeoutSession = new GdbSession({
  id: "timeout-session",
  child: timeoutChild,
  workDir: "/tmp",
  program: null,
  maxInternalBufferChars: 1024,
});
const zeroTimeout = await timeoutSession.exec("", 0);
assert.equal(zeroTimeout.completion_reason, "timeout");
assert.equal(zeroTimeout.timed_out, true);

const concurrentChild = createFakeChild();
const concurrentSession = new GdbSession({
  id: "concurrent-session",
  child: concurrentChild,
  workDir: "/tmp",
  program: "/tmp/prog",
  maxInternalBufferChars: 1024,
});
const first = concurrentSession.exec("print 1", 5);
await waitFor(() => concurrentChild.stdin.writes.length === 1, "first command was not written");
await assert.rejects(
  () => concurrentSession.exec("print 2", 5),
  /already has an exec or interrupt in progress/,
);
assert.equal(concurrentChild.stdin.writes.length, 1);
concurrentChild.stdout.write("1^done\n");
await first;

const oldTmpDir = process.env.TMPDIR;
const tempRoot = await mkdtemp(path.join(tmpdir(), "gdb-session-unit-"));
process.env.TMPDIR = tempRoot;
try {
  let exited = false;
  const exitChild = createFakeChild();
  const exitSession = new GdbSession({
    id: "exit-session",
    child: exitChild,
    workDir: "/tmp",
    program: "/tmp/prog",
    maxInternalBufferChars: 1024,
    onExit: () => {
      exited = true;
    },
  });

  const pending = exitSession.exec("shell sleep 10", 5);
  await waitFor(() => exitChild.stdin.writes.length === 1, "pending command was not written");
  await waitFor(async () => (await readdir(tempRoot)).length > 0, "temp command script was not created");
  exitChild.exitCode = 1;
  exitChild.emit("exit", 1, null);
  const exitedResult = await pending;
  assert.equal(exitedResult.completion_reason, "exited");
  assert.equal(exitedResult.session_exited, true);
  assert.equal(exited, true);
  await waitFor(async () => (await readdir(tempRoot)).length === 0, "temp command script was not cleaned up");
  await assert.rejects(() => exitSession.exec("", 1), /gdb exited/);
} finally {
  if (oldTmpDir === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = oldTmpDir;
  }
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("gdb session unit test passed");
