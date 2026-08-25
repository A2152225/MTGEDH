/**
 * Extracted from loopShortcuts.ts: shared text/payload helpers.
 * Cluster moved: normalizeText, clonePayload.
 * Public: normalizeText, clonePayload
 *
 * Leaf must not import loopShortcuts.ts or loopShortcuts-handlers/index.ts.
 */

export function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function clonePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload ?? null));
}
