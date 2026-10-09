/**
 * Tiny store so the Manual Mode toggle is shared across rail / settings /
 * mobile tools / card context menus without threading App.tsx props.
 */

let enabled = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function isManualModeEnabled(): boolean {
  return enabled;
}

export function setManualModeEnabled(next: boolean): void {
  const value = !!next;
  if (value === enabled) return;
  enabled = value;
  emit();
}

export function toggleManualModeEnabled(): boolean {
  setManualModeEnabled(!enabled);
  return enabled;
}

export function subscribeManualMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
