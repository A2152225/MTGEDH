/**
 * client/src/hooks/useViewport.ts
 *
 * Reactive viewport size + a `<` breakpoint helper that uses `matchMedia`
 * when available (cheaper than re-rendering on every resize event for many
 * subscribers). Exposes `useBreakpoint('mobile' | 'tablet' | 'desktop')`
 * which returns true when the viewport is at-or-below that breakpoint.
 */

import { useEffect, useMemo, useState } from 'react';
import { breakpoints } from '../theme';

type BreakpointKey = 'mobile' | 'tablet' | 'desktop';

export type ViewportOrientation = 'portrait' | 'landscape';

export function getViewportOrientation(width: number, height: number): ViewportOrientation {
  return width >= height ? 'landscape' : 'portrait';
}

function readWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return window.innerWidth;
}

function readHeight(): number {
  if (typeof window === 'undefined') return 800;
  return window.innerHeight;
}

export function useViewport(): { width: number; height: number; orientation: ViewportOrientation } {
  const [size, setSize] = useState<{ width: number; height: number }>(() => ({
    width: readWidth(),
    height: readHeight(),
  }));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const handler = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSize({ width: readWidth(), height: readHeight() });
      });
    };
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handler);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handler);
      }
    };
  }, []);
  const orientation = useMemo(
    () => getViewportOrientation(size.width, size.height),
    [size.width, size.height],
  );
  return { ...size, orientation };
}

/**
 * Returns true when the viewport is narrower than the named breakpoint.
 * Uses matchMedia for efficient subscription rather than a resize listener.
 */
export function useBreakpoint(name: BreakpointKey): boolean {
  const max =
    name === 'mobile'
      ? breakpoints.tablet - 1
      : name === 'tablet'
        ? breakpoints.desktop - 1
        : breakpoints.wide - 1;
  const query = `(max-width: ${max}px)`;
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Legacy Safari API path.
    (mql as any).addListener(onChange);
    return () => {
      (mql as any).removeListener(onChange);
    };
  }, [query]);
  return matches;
}
