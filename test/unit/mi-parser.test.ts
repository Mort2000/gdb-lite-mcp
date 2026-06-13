import assert from "node:assert/strict";
import { decodeMiCString, parseMiLine } from "../../src/mi-parser.js";

assert.deepEqual(parseMiLine("(gdb) "), { type: "prompt" });
assert.deepEqual(parseMiLine("12^done,bkpt={}"), {
  type: "result",
  token: 12,
  resultClass: "done",
});
assert.deepEqual(parseMiLine("13^running"), {
  type: "result",
  token: 13,
  resultClass: "running",
});
assert.deepEqual(parseMiLine("*running,thread-id=\"all\""), { type: "running" });
assert.deepEqual(parseMiLine("*stopped,reason=\"breakpoint-hit\""), { type: "stopped" });
assert.deepEqual(parseMiLine("=thread-group-exited,id=\"i1\""), { type: "thread-group-exited" });
assert.deepEqual(parseMiLine("=cmd-param-changed,param=\"confirm\",value=\"off\""), { type: "ignored" });
assert.deepEqual(parseMiLine("plain text"), { type: "output", text: "plain text\n" });
assert.deepEqual(parseMiLine(""), { type: "output", text: "\n" });

assert.equal(decodeMiCString("\"hello\\nworld\\t\\\\\\\"\""), "hello\nworld\t\\\"");
assert.equal(decodeMiCString("\"\\303\\251\\342\\234\\223\""), "\u00e9\u2713");
assert.deepEqual(parseMiLine("~\"value=42\\n\""), { type: "stream", text: "value=42\n" });
assert.deepEqual(parseMiLine("@\"target out\\n\""), { type: "stream", text: "target out\n" });
assert.deepEqual(parseMiLine("&\"log out\\n\""), { type: "stream", text: "log out\n" });

console.log("mi parser unit test passed");
