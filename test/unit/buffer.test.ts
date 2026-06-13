import assert from "node:assert/strict";
import { limitOutput, SessionBuffer } from "../../src/session-buffer.js";

const pendingBuffer = new SessionBuffer(100);
pendingBuffer.append("abcdef");
pendingBuffer.readOffset = 3;
pendingBuffer.compactConsumed(true);
assert.equal(pendingBuffer.text, "abcdef");
pendingBuffer.compactConsumed(false);
assert.equal(pendingBuffer.text, "def");
assert.equal(pendingBuffer.startOffset, 3);

const recycled = new SessionBuffer(10);
recycled.append("0123456789abcdef");
assert.equal(recycled.text, "6789abcdef");
assert.equal(recycled.startOffset, 6);
const oldSlice = recycled.sliceFrom(0);
assert.match(oldSlice.output, /6 bytes omitted from start/);
assert.equal(oldSlice.omittedBytes, 6);

recycled.readOffset = recycled.endOffset;
recycled.compactConsumed(false);
assert.equal(recycled.text, "");
assert.equal(recycled.startOffset, recycled.endOffset);

const limited = limitOutput("0123456789", 4);
assert.equal(limited.omittedBytes, 6);
assert.match(limited.output, /6 bytes omitted from start/);
assert.ok(limited.output.endsWith("6789"));

assert.throws(() => new SessionBuffer(0), /positive integer/);
assert.throws(() => limitOutput("x", 0), /positive integer/);

console.log("buffer unit test passed");
