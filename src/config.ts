export const DEFAULT_MAX_INTERNAL_BUFFER_CHARS = 4 * 1024 * 1024;
export const DEFAULT_MAX_SESSIONS = 8;
export const MAX_TIMEOUT_SECONDS = 600;

export const DEFAULT_AUTO_INIT_COMMANDS = [
  "set pagination off",
  "set confirm off",
  "set print pretty on",
  "set print elements 200",
];

export function resolveMaxSessions(override?: number): number {
  return resolvePositiveInteger(
    "GDB_LITE_MAX_SESSIONS",
    DEFAULT_MAX_SESSIONS,
    override,
  );
}

export function resolveMaxInternalBufferChars(override?: number): number {
  return resolvePositiveInteger(
    "GDB_LITE_MAX_INTERNAL_BUFFER_CHARS",
    DEFAULT_MAX_INTERNAL_BUFFER_CHARS,
    override,
  );
}

export function resolveAutoInitEnabled(override?: boolean): boolean {
  if (override !== undefined) {
    return override;
  }

  const rawValue = process.env.GDB_LITE_AUTO_INIT;
  if (rawValue === undefined || rawValue.trim() === "") {
    return true;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized)) {
    return true;
  }

  throw new Error(
    `GDB_LITE_AUTO_INIT must be one of true/false, 1/0, yes/no, on/off: ${rawValue}`,
  );
}

function resolvePositiveInteger(
  environmentName: string,
  defaultValue: number,
  override?: number,
): number {
  const rawValue = override ?? process.env[environmentName] ?? defaultValue;
  const parsed = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${environmentName} must be a positive integer: ${rawValue}`);
  }
  return parsed;
}
