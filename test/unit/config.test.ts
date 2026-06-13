import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_INIT_COMMANDS,
  resolveAutoInitEnabled,
  resolveMaxInternalBufferChars,
  resolveMaxSessions,
} from "../../src/config.js";
import { buildGdbArgs } from "../../src/gdb-process.js";

const savedMaxSessions = process.env.GDB_LITE_MAX_SESSIONS;
const savedMaxBuffer = process.env.GDB_LITE_MAX_INTERNAL_BUFFER_CHARS;
const savedAutoInit = process.env.GDB_LITE_AUTO_INIT;

try {
  process.env.GDB_LITE_MAX_SESSIONS = "3";
  assert.equal(resolveMaxSessions(), 3);
  assert.equal(resolveMaxSessions(2), 2);
  process.env.GDB_LITE_MAX_SESSIONS = "0";
  assert.throws(() => resolveMaxSessions(), /positive integer/);

  process.env.GDB_LITE_MAX_INTERNAL_BUFFER_CHARS = "128";
  assert.equal(resolveMaxInternalBufferChars(), 128);
  process.env.GDB_LITE_MAX_INTERNAL_BUFFER_CHARS = "abc";
  assert.throws(() => resolveMaxInternalBufferChars(), /positive integer/);

  process.env.GDB_LITE_AUTO_INIT = "off";
  assert.equal(resolveAutoInitEnabled(), false);
  process.env.GDB_LITE_AUTO_INIT = "yes";
  assert.equal(resolveAutoInitEnabled(), true);
  process.env.GDB_LITE_AUTO_INIT = "maybe";
  assert.throws(() => resolveAutoInitEnabled(), /GDB_LITE_AUTO_INIT/);

  const defaultArgs = buildGdbArgs({
    progPath: "/tmp/prog",
    extraArgs: [],
    autoInitCommands: true,
  });
  for (const command of DEFAULT_AUTO_INIT_COMMANDS) {
    assert.ok(defaultArgs.includes(command), `missing ${command}`);
  }

  const disabledArgs = buildGdbArgs({
    progPath: "/tmp/prog",
    extraArgs: [],
    autoInitCommands: false,
  });
  for (const command of DEFAULT_AUTO_INIT_COMMANDS) {
    assert.equal(disabledArgs.includes(command), false, `unexpected ${command}`);
  }
} finally {
  restoreEnv("GDB_LITE_MAX_SESSIONS", savedMaxSessions);
  restoreEnv("GDB_LITE_MAX_INTERNAL_BUFFER_CHARS", savedMaxBuffer);
  restoreEnv("GDB_LITE_AUTO_INIT", savedAutoInit);
}

console.log("config unit test passed");

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
