/**
 * client/src/hooks/useDraggablePanel.ts
 *
 * Pointer-driven drag for a floating, non-modal panel. Position is clamped so
 * the panel cannot be dragged fully off-screen, and is remembered in
 * localStorage under `storageKey` while (and after) the panel is open.
 * Also tracks a minimized flag so the consumer can collapse to a chip/bar
 * without losing the rest of its React state.
 */
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export const DRAGGABLE_PANEL_MIN_VISIBLE_PX = 48;

export interface DraggablePanelPosition {
  x: number;
  y: number;
}

export interface UseDraggablePanelOptions {
  storageKey: string;
  /** Pixels of the panel that must remain inside the viewport. Default 48. */
  minVisiblePx?: number;
}

export interface UseDraggablePanelResult {
  panelRef: RefObject<HTMLDivElement | null>;
  position: DraggablePanelPosition | null;
  minimized: boolean;
  setMinimized: (next: boolean) => void;
  toggleMinimized: () => void;
  dragging: boolean;
  panelStyle: CSSProperties;
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
}

function loadPosition(storageKey: string): DraggablePanelPosition | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraggablePanelPosition>;
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number' && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // Private mode / blocked storage / bad JSON.
  }
  return null;
}

function savePosition(storageKey: string, position: DraggablePanelPosition): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(position));
  } catch {
    // Ignore quota / private mode.
  }
}

function clampNumber(value: number, min: number, max: number): number {
  const high = Math.max(min, max);
  return Math.min(Math.max(value, min), high);
}

export function clampPanelPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  minVisiblePx: number = DRAGGABLE_PANEL_MIN_VISIBLE_PX,
): DraggablePanelPosition {
  const visibleX = Math.max(1, Math.min(minVisiblePx, width));
  const visibleY = Math.max(1, Math.min(minVisiblePx, height));
  return {
    x: clampNumber(x, visibleX - width, viewportWidth - visibleX),
    // Keep the title bar on-screen at the top; keep at least `visibleY` at the bottom.
    y: clampNumber(y, 0, viewportHeight - visibleY),
  };
}

function measureAndClamp(
  el: HTMLElement,
  preferred: DraggablePanelPosition | null,
  minVisiblePx: number,
): DraggablePanelPosition {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fallback = {
    x: Math.round((vw - width) / 2),
    y: Math.round((vh - height) / 2),
  };
  const source = preferred ?? fallback;
  return clampPanelPosition(source.x, source.y, width, height, vw, vh, minVisiblePx);
}

export function useDraggablePanel(options: UseDraggablePanelOptions): UseDraggablePanelResult {
  const { storageKey, minVisiblePx = DRAGGABLE_PANEL_MIN_VISIBLE_PX } = options;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<DraggablePanelPosition | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const positionRef = useRef<DraggablePanelPosition | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  positionRef.current = position;

  const applyPosition = useCallback((next: DraggablePanelPosition, persist: boolean) => {
    positionRef.current = next;
    setPosition(next);
    if (persist) savePosition(storageKey, next);
  }, [storageKey]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || typeof window === 'undefined') return;

    const place = (persist: boolean) => {
      const next = measureAndClamp(el, positionRef.current ?? loadPosition(storageKey), minVisiblePx);
      const prev = positionRef.current;
      if (prev && prev.x === next.x && prev.y === next.y) return;
      applyPosition(next, persist);
    };

    // First layout (or size change from minimize/restore): clamp without
    // overwriting storage unless we already had a live position.
    place(positionRef.current !== null);

    const onResize = () => place(true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [applyPosition, minVisiblePx, minimized, storageKey]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (positionRef.current) savePosition(storageKey, positionRef.current);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore if capture was already released.
    }
  }, [storageKey]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, [data-no-drag]')) return;
    const current = positionRef.current;
    if (!current) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: current.x,
      origY: current.y,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; move/up still fire on this handle when possible.
    }
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const el = panelRef.current;
    if (!el) return;
    const next = clampPanelPosition(
      drag.origX + event.clientX - drag.startX,
      drag.origY + event.clientY - drag.startY,
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
      minVisiblePx,
    );
    applyPosition(next, false);
  }, [applyPosition, minVisiblePx]);

  const toggleMinimized = useCallback(() => {
    setMinimized((prev) => !prev);
  }, []);

  return {
    panelRef,
    position,
    minimized,
    setMinimized,
    toggleMinimized,
    dragging,
    panelStyle: {
      position: 'fixed',
      left: position?.x ?? 0,
      top: position?.y ?? 0,
      visibility: position ? 'visible' : 'hidden',
    },
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      style: {
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      },
    },
  };
}
