/**
 * client/src/hooks/useLongPress.ts
 *
 * Returns a set of pointer/touch handlers that fire `onLongPress(x, y, target)`
 * after the user holds (no movement above slop threshold) for `delayMs`
 * milliseconds. Designed to be a drop-in alternative to `onContextMenu` on
 * touch devices — desktop right-click is unaffected because callers should
 * spread these handlers ALONGSIDE `onContextMenu`, not replace it.
 *
 * Cancels on:
 *  - pointer move beyond `moveSlop` pixels
 *  - pointer up before `delayMs`
 *  - pointer cancel / leave
 */

import { useCallback, useEffect, useRef } from 'react';
import { touch as touchTokens } from '../theme';

type LongPressCallback = (x: number, y: number, target: EventTarget | null) => void;

export interface LongPressOptions {
  delayMs?: number;
  moveSlop?: number;
  /** When true, calls preventDefault() on the synthetic event when the long press fires. */
  preventDefaultOnFire?: boolean;
  /** When false, the hook returns no-op handlers (useful to disable on desktop). */
  enabled?: boolean;
}

export function useLongPress(onLongPress: LongPressCallback, options: LongPressOptions = {}) {
  const {
    delayMs = touchTokens.longPressMs,
    moveSlop = 8,
    preventDefaultOnFire = true,
    enabled = true,
  } = options;

  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => {
    return cancel;
  }, [cancel]);

  if (!enabled) {
    return {
      onPointerDown: undefined,
      onPointerMove: undefined,
      onPointerUp: undefined,
      onPointerCancel: undefined,
      onPointerLeave: undefined,
    };
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    firedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    const target = e.target;
    const x = e.clientX;
    const y = e.clientY;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!startRef.current || startRef.current.pointerId !== e.pointerId) return;
      firedRef.current = true;
      if (preventDefaultOnFire && typeof (e as any).preventDefault === 'function') {
        try { (e as any).preventDefault(); } catch { /* noop */ }
      }
      onLongPress(x, y, target);
      cancel();
    }, delayMs);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || startRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > moveSlop) {
      cancel();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (startRef.current && startRef.current.pointerId === e.pointerId) {
      cancel();
    }
  };

  const onPointerCancel = (_e: React.PointerEvent) => cancel();
  const onPointerLeave = (_e: React.PointerEvent) => cancel();

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave };
}
