/**
 * client/src/hooks/useIsTouch.ts
 *
 * Detects coarse-pointer (touch) devices using `matchMedia('(pointer: coarse)')`
 * with a graceful SSR fallback. Updates reactively if the user attaches a
 * mouse / detaches a touchscreen mid-session.
 *
 * Pure read-only hook. Does NOT mutate body classes or DOM — see
 * `useTouchBodyClass()` for the optional `body.touch` toggle.
 */

import { useEffect, useState } from 'react';

function detectInitial(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(detectInitial);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(pointer: coarse)');
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    // Older Safari only exposes addListener / removeListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Legacy Safari API path.
    (mql as any).addListener(onChange);
    return () => {
      (mql as any).removeListener(onChange);
    };
  }, []);

  return isTouch;
}

/**
 * Toggles a `touch` class on `document.body` whenever coarse-pointer state
 * changes. Useful for CSS-side gating (e.g. `body.touch .my-component { ... }`).
 * Call once near the app root.
 */
export function useTouchBodyClass(): boolean {
  const isTouch = useIsTouch();
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return;
    if (isTouch) {
      document.body.classList.add('touch');
    } else {
      document.body.classList.remove('touch');
    }
  }, [isTouch]);
  return isTouch;
}
