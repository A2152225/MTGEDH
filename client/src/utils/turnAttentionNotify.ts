/**
 * Background-tab attention when it becomes the local player's turn:
 * flash the document title and play a short chime. No-ops while focused.
 *
 * Public entry symbols: isPageUnfocused, notifyUnfocusedYourTurn,
 * stopTurnAttentionNotify, YOUR_TURN_ALERT_TITLE.
 */

export const YOUR_TURN_ALERT_TITLE = 'Your turn! — MTGEDH';
const DEFAULT_TITLE = 'MTGEDH';
const FLASH_MS = 900;
const FLASH_CYCLES = 16;

type PageFocusState = {
  hidden: boolean;
  focused: boolean;
};

export function isPageUnfocused(page: PageFocusState): boolean {
  return page.hidden || !page.focused;
}

function readPageFocusState(): PageFocusState | null {
  if (typeof document === 'undefined') return null;
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return { hidden: Boolean(document.hidden), focused };
}

let flashTimer: number | null = null;
let restoredTitle: string | null = null;
let stopListenersBound = false;
let audioCtx: AudioContext | null = null;

function restoreTitle(): void {
  if (restoredTitle != null && typeof document !== 'undefined') {
    document.title = restoredTitle;
  }
  restoredTitle = null;
}

export function stopTurnAttentionNotify(): void {
  if (flashTimer != null) {
    window.clearInterval(flashTimer);
    flashTimer = null;
  }
  restoreTitle();
  try {
    const badge = (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge;
    if (typeof badge === 'function') void badge.call(navigator);
  } catch {
    /* ignore */
  }
}

function ensureStopOnReturn(): void {
  if (stopListenersBound || typeof window === 'undefined' || typeof document === 'undefined') return;
  stopListenersBound = true;
  const stop = () => stopTurnAttentionNotify();
  window.addEventListener('focus', stop);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stop();
  });
}

function startTitleFlash(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (flashTimer != null) return;
  if (restoredTitle == null) {
    restoredTitle = document.title || DEFAULT_TITLE;
  }
  const reduceMotion = Boolean(
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  );
  if (reduceMotion) {
    document.title = YOUR_TURN_ALERT_TITLE;
    return;
  }
  let alertOn = false;
  let cycles = 0;
  const tick = () => {
    alertOn = !alertOn;
    document.title = alertOn ? YOUR_TURN_ALERT_TITLE : (restoredTitle || DEFAULT_TITLE);
    cycles += 1;
    if (cycles >= FLASH_CYCLES) {
      document.title = YOUR_TURN_ALERT_TITLE;
      if (flashTimer != null) {
        window.clearInterval(flashTimer);
        flashTimer = null;
      }
    }
  };
  tick();
  flashTimer = window.setInterval(tick, FLASH_MS);
}

function playTone(ctx: AudioContext, frequency: number, start: number, duration: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playTurnChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    playTone(audioCtx, 523.25, now, 0.14);
    playTone(audioCtx, 784, now + 0.16, 0.2);
  } catch {
    /* autoplay may be blocked; ignore */
  }
}

/**
 * Flash the tab title and play a chime if the page is in the background.
 * Returns whether a notification was started.
 */
export function notifyUnfocusedYourTurn(): boolean {
  const page = readPageFocusState();
  if (!page || !isPageUnfocused(page)) return false;
  ensureStopOnReturn();
  startTitleFlash();
  playTurnChime();
  try {
    const badge = (navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge;
    if (typeof badge === 'function') void badge.call(navigator, 1);
  } catch {
    /* ignore */
  }
  return true;
}
