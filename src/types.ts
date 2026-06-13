export type EnvironmentMap = Record<string, string>;

export type SpawnArgs = {
  prog_path?: string;
  work_dir: string;
  environments?: EnvironmentMap;
  core_path?: string;
  attach_pid?: number;
  remote_target?: string;
  gdb_args?: string[];
};

export type SessionInfo = {
  session_id: string;
  work_dir: string;
  program: string | null;
};

export type GdbExecResult = {
  output: string;
  completion_reason: "completed" | "timeout" | "exited";
  saw_prompt: boolean;
  timed_out: boolean;
  session_exited: boolean;
  at_prompt: boolean;
  command_pending: boolean;
  needs_interrupt: boolean;
  bytes: number;
  duration_ms: number;
  truncated: boolean;
  omitted_bytes: number;
  internal_buffer_bytes: number;
};

export type GdbInterruptResult = GdbExecResult & {
  interrupted: boolean;
};
