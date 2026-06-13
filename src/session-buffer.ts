export class SessionBuffer {
  private output = "";
  private bufferStart = 0;
  private consumedOffset = 0;

  constructor(private readonly maxChars: number) {
    if (!Number.isInteger(maxChars) || maxChars <= 0) {
      throw new Error(`max internal buffer chars must be a positive integer: ${maxChars}`);
    }
  }

  get readOffset(): number {
    return this.consumedOffset;
  }

  set readOffset(value: number) {
    this.consumedOffset = value;
  }

  get startOffset(): number {
    return this.bufferStart;
  }

  get endOffset(): number {
    return this.bufferStart + this.output.length;
  }

  get text(): string {
    return this.output;
  }

  get byteLength(): number {
    return Buffer.byteLength(this.output, "utf8");
  }

  append(text: string): void {
    this.output += text;
    if (this.output.length > this.maxChars) {
      const dropChars = this.output.length - this.maxChars;
      this.output = this.output.slice(dropChars);
      this.bufferStart += dropChars;
    }
  }

  hasTextSince(text: string, fromOffset: number): boolean {
    const index = this.output.lastIndexOf(text);
    return index >= 0 && this.bufferStart + index >= fromOffset;
  }

  sliceFrom(fromOffset: number): { output: string; omittedBytes: number } {
    if (fromOffset < this.bufferStart) {
      const omittedBytes = this.bufferStart - fromOffset;
      return {
        output: `[gdb-lite output truncated: ${omittedBytes} bytes omitted from start]\n${this.output}`,
        omittedBytes,
      };
    }

    return {
      output: this.output.slice(fromOffset - this.bufferStart),
      omittedBytes: 0,
    };
  }

  compactConsumed(hasWaiters: boolean): void {
    if (hasWaiters || this.consumedOffset <= this.bufferStart) {
      return;
    }

    const dropChars = Math.min(this.consumedOffset - this.bufferStart, this.output.length);
    this.output = this.output.slice(dropChars);
    this.bufferStart += dropChars;
  }
}

export function limitOutput(
  output: string,
  maxOutputBytes: number | undefined,
): { output: string; omittedBytes: number } {
  if (maxOutputBytes === undefined) {
    return { output, omittedBytes: 0 };
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("max_output_bytes must be a positive integer");
  }

  const buffer = Buffer.from(output, "utf8");
  if (buffer.byteLength <= maxOutputBytes) {
    return { output, omittedBytes: 0 };
  }

  const omittedBytes = buffer.byteLength - maxOutputBytes;
  return {
    output: `[gdb-lite output truncated: ${omittedBytes} bytes omitted from start]\n${buffer
      .subarray(omittedBytes)
      .toString("utf8")}`,
    omittedBytes,
  };
}
