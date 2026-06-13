import assert from "node:assert/strict";
import { MAX_TIMEOUT_SECONDS } from "../../src/config.js";
import { normalizeTimeout } from "../../src/timeouts.js";

assert.equal(normalizeTimeout(0), 0);
assert.equal(normalizeTimeout(0.01), 0.01);
assert.equal(normalizeTimeout(MAX_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS);

assert.throws(() => normalizeTimeout(-0.001), /between 0 and 600/);
assert.throws(() => normalizeTimeout(MAX_TIMEOUT_SECONDS + 0.001), /between 0 and 600/);
assert.throws(() => normalizeTimeout(Number.NaN), /finite/);
assert.throws(() => normalizeTimeout(Number.POSITIVE_INFINITY), /finite/);

console.log("timeout unit test passed");
