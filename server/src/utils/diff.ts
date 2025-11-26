import type { StateDiff } from '../../../shared/src/index.js';

export function computeDiff<T>(prev: T | undefined, next: T, seq: number): StateDiff<T> {
  // Minimal: send full payload to keep it simple; implement structural diff later
  return { full: next, seq };
}