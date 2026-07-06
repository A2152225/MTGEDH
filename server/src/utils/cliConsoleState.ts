/** Shared flag so stdout debug logs do not collide with the stderr CLI prompt. */

let interactiveCliActive = false;
let redrawCliPrompt: (() => void) | null = null;

export function setInteractiveCliActive(active: boolean): void {
  interactiveCliActive = active;
}

export function isInteractiveCliActive(): boolean {
  return interactiveCliActive;
}

export function registerCliPromptRedraw(fn: () => void): void {
  redrawCliPrompt = fn;
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
