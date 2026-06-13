import { MAX_TIMEOUT_SECONDS } from "./config.js";

export function normalizeTimeout(timeoutSeconds: number): number {
  if (!Number.isFinite(timeoutSeconds)) {
    throw new Error(`timeout must be finite: ${timeoutSeconds}`);
  }
  if (timeoutSeconds < 0 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`timeout must be between 0 and ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return timeoutSeconds;
}
