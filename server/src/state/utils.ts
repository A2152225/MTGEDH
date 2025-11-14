export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parsePT(raw?: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return undefined;
}