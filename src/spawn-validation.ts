import type { EnvironmentMap, SpawnArgs } from "./types.js";

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function validateEnvironment(environments: EnvironmentMap): void {
  for (const [name, value] of Object.entries(environments)) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`invalid environment variable name: ${name}`);
    }
    if (typeof value !== "string") {
      throw new Error(`environment variable value must be a string: ${name}`);
    }
  }
}

export function validateAttachPid(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`attach_pid must be a positive integer: ${pid}`);
  }
}

export function validateSpawnMode(args: SpawnArgs): void {
  const modes = [args.core_path !== undefined, args.attach_pid !== undefined, args.remote_target !== undefined]
    .filter(Boolean).length;
  if (modes > 1) {
    throw new Error("gdb_spawn supports only one of core_path, attach_pid, or remote_target at a time");
  }
}

export function normalizeRemoteTarget(remoteTarget: string | undefined): string | undefined {
  if (remoteTarget === undefined) {
    return undefined;
  }
  const trimmed = remoteTarget.trim();
  if (trimmed === "") {
    throw new Error("remote_target must not be empty");
  }
  if (/[\0\r\n]/u.test(trimmed)) {
    throw new Error("remote_target must not contain control characters");
  }
  return trimmed;
}
