import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
  files?: string[];
};

assert.deepEqual(packageJson.files, ["dist", "GUIDE.md", "skills"]);
assert.equal(packageJson.files?.includes("scenarios"), false);
assert.equal(packageJson.files?.includes("eval"), false);

console.log("package files test passed");
