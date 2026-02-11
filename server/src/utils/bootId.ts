import { randomUUID } from 'node:crypto';

// Unique per-process identifier to make restarts obvious in logs.
// Generated once at module load time.
export const BOOT_ID: string = (() => {
  try {
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
})();
