export type MiParsedLine =
  | { type: "prompt" }
  | { type: "stream"; text: string }
  | { type: "result"; token: number; resultClass: string }
  | { type: "running" }
  | { type: "stopped" }
  | { type: "thread-group-exited" }
  | { type: "ignored" }
  | { type: "output"; text: string };

export function parseMiLine(line: string): MiParsedLine {
  if (line === "(gdb) " || line === "(gdb)") {
    return { type: "prompt" };
  }

  if (line === "") {
    return { type: "output", text: "\n" };
  }

  const streamPrefix = line[0];
  if ((streamPrefix === "~" || streamPrefix === "@" || streamPrefix === "&") && line[1] === "\"") {
    return { type: "stream", text: decodeMiCString(line.slice(1)) };
  }

  const resultMatch = line.match(/^(\d+)\^([A-Za-z-]+)(.*)$/u);
  if (resultMatch) {
    return {
      type: "result",
      token: Number(resultMatch[1]),
      resultClass: resultMatch[2],
    };
  }

  if (line.startsWith("*running")) {
    return { type: "running" };
  }

  if (line.startsWith("*stopped")) {
    return { type: "stopped" };
  }

  if (line.startsWith("=thread-group-exited")) {
    return { type: "thread-group-exited" };
  }

  if (line.startsWith("=") || line.startsWith("+") || line.startsWith("^")) {
    return { type: "ignored" };
  }

  return { type: "output", text: `${line}\n` };
}

export function decodeMiCString(value: string): string {
  if (!value.startsWith("\"")) {
    return value;
  }

  let end = value.length - 1;
  while (end > 0 && value[end] !== "\"") {
    end--;
  }
  const body = value.slice(1, end);
  let result = "";
  let utf8Bytes: number[] = [];

  const flushUtf8Bytes = () => {
    if (utf8Bytes.length === 0) {
      return;
    }
    result += Buffer.from(utf8Bytes).toString("utf8");
    utf8Bytes = [];
  };

  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char !== "\\") {
      flushUtf8Bytes();
      result += char;
      continue;
    }

    const escaped = body[++index];
    if (escaped === undefined) {
      flushUtf8Bytes();
      result += "\\";
      break;
    }

    if (escaped >= "0" && escaped <= "7") {
      let octal = escaped;
      for (let count = 0; count < 2 && index + 1 < body.length; count++) {
        const next = body[index + 1];
        if (next < "0" || next > "7") {
          break;
        }
        octal += next;
        index++;
      }
      utf8Bytes.push(Number.parseInt(octal, 8));
      continue;
    }

    flushUtf8Bytes();
    switch (escaped) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case "b":
        result += "\b";
        break;
      case "f":
        result += "\f";
        break;
      case "\"":
      case "\\":
        result += escaped;
        break;
      default:
        result += escaped;
        break;
    }
  }

  flushUtf8Bytes();
  return result;
}
