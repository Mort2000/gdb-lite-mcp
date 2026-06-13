import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class TempFileRegistry {
  private readonly tempFiles = new Set<string>();

  constructor(private readonly sessionId: string) {}

  async writeCommandScript(contents: string): Promise<string> {
    const dir = await mkdtemp(path.join(commandScriptTempRoot(), "gdb-lite-mcp-"));
    const filePath = path.join(dir, `${this.sessionId}-${randomUUID()}.gdb`);
    await writeFile(filePath, contents, { mode: 0o600 });
    this.tempFiles.add(filePath);
    return filePath;
  }

  cleanupFile(filePath: string): void {
    this.tempFiles.delete(filePath);
    void rm(path.dirname(filePath), { force: true, recursive: true }).catch(() => undefined);
  }

  cleanupAll(): void {
    const dirs = new Set(Array.from(this.tempFiles, (filePath) => path.dirname(filePath)));
    this.tempFiles.clear();
    for (const dir of dirs) {
      void rm(dir, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

export function commandScriptTempRoot(): string {
  return tmpdir();
}
