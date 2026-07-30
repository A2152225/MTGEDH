/** Shared flag so stdout debug logs do not collide with the stderr CLI prompt. */

let interactiveCliActive = false;
let clearCliPrompt: (() => void) | null = null;
let redrawCliPrompt: (() => void) | null = null;

export function setInteractiveCliActive(active: boolean): void {
  interactiveCliActive = active;
}

export function isInteractiveCliActive(): boolean {
  return interactiveCliActive;
}

export function registerCliPromptClear(fn: (() => void) | null): void {
  clearCliPrompt = fn;
}

export function registerCliPromptRedraw(fn: () => void): void {
  redrawCliPrompt = fn;
}

export function clearCliPromptIfNeeded(): void {
  if (!interactiveCliActive) return;
  try {
    clearCliPrompt?.();
  } catch {
    // ignore
  }
}

export function redrawCliPromptIfNeeded(): void {
  if (!interactiveCliActive) return;
  try {
    redrawCliPrompt?.();
  } catch {
    // ignore
  }
}

export function hasInteractiveConsoleTty(): boolean {
  return !!(process.stdout.isTTY || process.stderr.isTTY);
}
