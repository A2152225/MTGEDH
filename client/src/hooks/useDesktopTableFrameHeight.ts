// client/src/hooks/useDesktopTableFrameHeight.ts
// Desktop-only: size the TableLayout frame to exactly the viewport space left
// below whatever chrome sits above it (Join panel, header, GameStatusIndicator,
// resolution chips, SeatStrip...). A fixed `calc(100vh - N)` under-counts that
// chrome, so the frame ran past the bottom of the window and the zoom +/-
// controls (pinned to the frame's bottom) were only visible after page scroll.
// Mobile chrome uses the flex-shell fill instead and never enables this hook.
import { useLayoutEffect, useState, type RefObject } from 'react';

// Space below the frame inside the play shell: table wrapper padding (4) +
// border (1) + shell padding (8), plus a few px of slack against rounding.
const DESKTOP_FRAME_BOTTOM_GAP = 16;

export function useDesktopTableFrameHeight(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setHeight(null);
      return;
    }
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      // Document-relative top so the result does not change while the page scrolls.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = Math.floor(window.innerHeight - top - DESKTOP_FRAME_BOTTOM_GAP);
      setHeight(prev => (prev === next ? prev : next));
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    measure();

    // Re-measure when chrome above the frame grows/shrinks or appears/disappears.
    const wrapper = el.parentElement;
    const column = wrapper?.parentElement ?? null;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    const observeSiblings = () => {
      if (!ro || !column) return;
      ro.disconnect();
      for (const child of Array.from(column.children)) {
        if (child !== wrapper) ro.observe(child);
      }
    };
    observeSiblings();
    const mo = column && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => { observeSiblings(); schedule(); })
      : null;
    if (mo && column) mo.observe(column, { childList: true });
    window.addEventListener('resize', schedule);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [ref, enabled]);

  return enabled ? height : null;
}