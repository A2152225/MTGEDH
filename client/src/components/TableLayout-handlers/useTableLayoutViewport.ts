// Origin parent: client/src/components/TableLayout.tsx
// Cluster moved: pan/zoom camera, pointer gestures, fit/focus helpers, and
// battlefield-expand / ability-badge / zone-menu state they sit beside.
// Public entry symbols: useTableLayoutViewport.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { KnownCardRef, PlayerID } from '../../../../shared/src';
import type { MobilePlayLayoutProfile } from '../../hooks/useMobilePlayLayout';
import type { ZoneType } from '../ZoneCardContextMenu';
import {
  clamp,
  MIN_INITIAL_ZOOM,
  rotatePoint,
  type PlayerBoard,
  type Side,
} from './tableLayoutGeometry';

const BATTLEFIELD_EXPAND_STORAGE_KEY = 'mtgedh:battlefieldExpanded';
const ABILITY_BADGES_STORAGE_KEY = 'mtgedh:showAbilityBadges';

export type TableLayoutSeatPosition = {
  x: number;
  y: number;
  rotateDeg: number;
  side: Side;
};

export type UseTableLayoutViewportArgs = {
  enablePanZoom: boolean;
  viewRotationDeg: number;
  you?: PlayerID;
  ordered: PlayerBoard[];
  seatPositions: TableLayoutSeatPosition[];
  halfW: number;
  halfH: number;
  focusedPlayerId?: PlayerID | null;
  mobilePlayLayout: Pick<MobilePlayLayoutProfile, 'orientation' | 'centerHandViewportFraction'>;
  BOARD_W: number;
  BOARD_H: number;
  propsIgnoredCardIds?: Set<string>;
};

export function useTableLayoutViewport({
  enablePanZoom,
  viewRotationDeg,
  you,
  ordered,
  seatPositions,
  halfW,
  halfH,
  focusedPlayerId,
  mobilePlayLayout,
  BOARD_W,
  BOARD_H,
  propsIgnoredCardIds,
}: UseTableLayoutViewportArgs) {
  // Pan/Zoom and camera
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (cr) setContainer({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setContainer({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, []);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  useEffect(() => { camRef.current = cam; }, [cam]);
  const viewRotationRef = useRef(viewRotationDeg);
  useEffect(() => { viewRotationRef.current = viewRotationDeg; }, [viewRotationDeg]);
  const dragRef = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; active: boolean } | null>(null);
  // Two-finger pinch-zoom + pan gesture state. Populated only when 2+ touch
  // pointers are active on the board container; cleared on pointer up/cancel.
  // Desktop mouse pointers are ignored entirely so existing right-click /
  // middle-click / Space+drag pan behavior is unaffected.
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    startDist: number;
    startMidX: number;
    startMidY: number;
    startCamX: number;
    startCamY: number;
    startCamZ: number;
  } | null>(null);
  const [panKey, setPanKey] = useState(false);
  const [yourBattlefieldExpanded, setYourBattlefieldExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(BATTLEFIELD_EXPAND_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const handleToggleYourBattlefieldExpanded = useCallback(() => {
    setYourBattlefieldExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(BATTLEFIELD_EXPAND_STORAGE_KEY, String(next));
      } catch { /* noop */ }
      return next;
    });
  }, []);
  // Ability badges default OFF (hide clutter); toggle persists like battlefield expand.
  const [showAbilityBadges, setShowAbilityBadges] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(ABILITY_BADGES_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const handleToggleAbilityBadges = useCallback(() => {
    setShowAbilityBadges((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(ABILITY_BADGES_STORAGE_KEY, String(next));
      } catch { /* noop */ }
      return next;
    });
  }, []);
  const [pendingTextSwapSource, setPendingTextSwapSource] = useState<string | null>(null);
  const [pendingXActivation, setPendingXActivation] = useState<{
    permanentId: string;
    abilityId: string;
    cardName: string;
    abilityText?: string;
    xCount: number;
    affordableXHint?: number;
    /** Set when the X prompt is for cycling a card in hand (emits activateCycling). */
    cyclingCardId?: string;
  } | null>(null);
  // State for zone card context menu (works for hand, graveyard, exile, commander, library)
  const [zoneContextMenu, setZoneContextMenu] = useState<{ card: KnownCardRef; zone: ZoneType; x: number; y: number } | null>(null);
  // Keep track of which cards are ignored for playability checks
  // Use props if provided, otherwise maintain local state for backward compatibility
  const [localIgnoredCardsSet, setLocalIgnoredCardsSet] = useState<Set<string>>(new Set());
  const ignoredCardsSet = propsIgnoredCardIds || localIgnoredCardsSet;
  const setIgnoredCardsSet = propsIgnoredCardIds ? () => {} : setLocalIgnoredCardsSet;
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space') setPanKey(true); };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') setPanKey(false); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!enablePanZoom) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-no-zoom]')) return;
      e.preventDefault();
      const { x, y, z } = camRef.current;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const cx = container.w / 2, cy = container.h / 2;
      const worldOffset = rotatePoint((sx - cx) / z, (sy - cy) / z, -viewRotationRef.current);
      const wx = x + worldOffset.x;
      const wy = y + worldOffset.y;
      const factor = Math.exp(-(e.deltaY) * 0.00125);
      const newZ = clamp(z * factor, 0.15, 2.5);
      const newWorldOffset = rotatePoint((sx - cx) / newZ, (sy - cy) / newZ, -viewRotationRef.current);
      const newCamX = wx - newWorldOffset.x;
      const newCamY = wy - newWorldOffset.y;
      setCam({ x: newCamX, y: newCamY, z: newZ });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [enablePanZoom, container.w, container.h]);

  const beginPan = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, active: true };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enablePanZoom) return;
    if (e.pointerType === 'touch') {
      // Track every touch contact so we can detect 2-finger gestures. Single
      // touch is intentionally NOT used to start a pan — that interaction is
      // reserved for card drag. Two fingers on the board start pinch+pan.
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size === 2) {
        const pts = Array.from(touchPointersRef.current.values());
        const [a, b] = pts;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        gestureRef.current = {
          startDist: dist,
          startMidX: (a.x + b.x) / 2,
          startMidY: (a.y + b.y) / 2,
          startCamX: camRef.current.x,
          startCamY: camRef.current.y,
          startCamZ: camRef.current.z,
        };
        // Cancel any in-progress single-pointer pan when entering gesture mode.
        if (dragRef.current) {
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(dragRef.current.id);
          } catch { /* noop */ }
          dragRef.current = null;
        }
        e.preventDefault();
      }
      return;
    }
    const isPan = e.button === 1 || e.button === 2 || panKey;
    if (isPan) { e.preventDefault(); beginPan(e); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      if (g && touchPointersRef.current.size >= 2) {
        const pts = Array.from(touchPointersRef.current.values()).slice(0, 2);
        const [a, b] = pts;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cxScreen = midX - rect.left;
        const cyScreen = midY - rect.top;
        const newZ = clamp(g.startCamZ * (dist / g.startDist), 0.15, 2.5);
        // Convert the gesture's start midpoint (screen) into world coords using
        // the start cam, then re-anchor that world point at the current
        // midpoint with the new zoom — same math as wheel zoom.
        const cx = container.w / 2;
        const cy = container.h / 2;
        const startMidScreenX = g.startMidX - rect.left;
        const startMidScreenY = g.startMidY - rect.top;
        const worldOffset = rotatePoint(
          (startMidScreenX - cx) / g.startCamZ,
          (startMidScreenY - cy) / g.startCamZ,
          -viewRotationRef.current,
        );
        const worldX = g.startCamX + worldOffset.x;
        const worldY = g.startCamY + worldOffset.y;
        const newOffset = rotatePoint(
          (cxScreen - cx) / newZ,
          (cyScreen - cy) / newZ,
          -viewRotationRef.current,
        );
        setCam({ x: worldX - newOffset.x, y: worldY - newOffset.y, z: newZ });
        e.preventDefault();
        return;
      }
    }
    const d = dragRef.current;
    if (!d || !d.active || d.id !== e.pointerId) return;
    const screenDx = (e.clientX - d.sx) / camRef.current.z;
    const screenDy = (e.clientY - d.sy) / camRef.current.z;
    const worldDelta = rotatePoint(screenDx, screenDy, -viewRotationRef.current);
    setCam(prev => ({ ...prev, x: d.cx - worldDelta.x, y: d.cy - worldDelta.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.delete(e.pointerId);
      if (touchPointersRef.current.size < 2) {
        gestureRef.current = null;
      }
    }
    if (dragRef.current && dragRef.current.id === e.pointerId) {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId))
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  function getBoardWorldCenter(pos: { x: number; y: number }) {
    return {
      x: container.w / 2 + pos.x,
      y: container.h / 2 + pos.y,
    };
  }

  function centerOnBoardIndex(idx: number, preserveZoom = true) {
    const pos = seatPositions[idx];
    if (!pos) return;
    const worldCenter = getBoardWorldCenter(pos);
    setCam(c => ({ x: worldCenter.x, y: worldCenter.y, z: preserveZoom ? c.z : c.z }));
  }

  function getFocusedBoardFrame() {
    const isDesktopFocus = container.w >= 1200;
    const horizontalMargin = isDesktopFocus ? 20 : 36;
    const topMargin = isDesktopFocus ? 6 : 20;
    const bottomMargin = isDesktopFocus ? 40 : 64;
    const desiredScreenShiftPx = isDesktopFocus
      ? Math.min(Math.max(container.h * 0.18, 84), 156)
      : Math.min(Math.max(container.h * 0.13, 56), 110);
    const focusWidth = BOARD_W + (isDesktopFocus ? 8 : 36);
    const focusHeight = BOARD_H + (isDesktopFocus ? 16 : 40);
    const usableWidth = Math.max(container.w - horizontalMargin * 2, 280);
    const topAvailable = Math.max(container.h / 2 - desiredScreenShiftPx - topMargin, 120);
    const bottomAvailable = Math.max(container.h / 2 + desiredScreenShiftPx - bottomMargin, 120);
    const zx = usableWidth / focusWidth;
    const zy = (2 * Math.min(topAvailable, bottomAvailable)) / focusHeight;

    return {
      zoom: clamp(Math.min(zx, zy), 0.32, isDesktopFocus ? 1.16 : 1.04),
      desiredScreenShiftPx,
    };
  }

  function focusOnBoardIndex(idx: number) {
    const pos = seatPositions[idx];
    if (!pos) return;
    const worldCenter = getBoardWorldCenter(pos);
    const { zoom, desiredScreenShiftPx } = getFocusedBoardFrame();
    const worldOffset = rotatePoint(0, desiredScreenShiftPx / zoom, pos.rotateDeg);
    setCam({
      x: worldCenter.x + worldOffset.x,
      y: worldCenter.y + worldOffset.y,
      z: zoom,
    });
  }

  function centerOnNearestWorldPoint(wx: number, wy: number, preserveZoom = true) {
    if (seatPositions.length === 0) return;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < seatPositions.length; i++) {
      const worldCenter = getBoardWorldCenter(seatPositions[i]);
      const dx = worldCenter.x - wx;
      const dy = worldCenter.y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    centerOnBoardIndex(best, preserveZoom);
  }

  function centerOnYou(preserveZoom = true) {
    try {
      if (you && containerRef.current) {
        const el = document.getElementById(`hand-area-${you}`);
        const containerEl = containerRef.current;
        if (el && containerEl) {
          const containerRect = containerEl.getBoundingClientRect();
          const elemRect = el.getBoundingClientRect();
          const z = camRef.current.z || 1;
          const sx = (elemRect.left - containerRect.left) + elemRect.width / 2;
          const sy = (elemRect.bottom - containerRect.top);
          const worldX = camRef.current.x + (sx - container.w / 2) / z;
          const worldY = camRef.current.y + (sy - container.h / 2) / z;
          const targetSX = container.w / 2;
          const targetSY = Math.round(container.h * mobilePlayLayout.centerHandViewportFraction);
          const newCamX = worldX - (targetSX - container.w / 2) / z;
          const newCamY = worldY - (targetSY - container.h / 2) / z;
          setCam(c => ({ x: newCamX, y: newCamY, z: preserveZoom ? c.z : c.z }));
          return;
        }
      }
    } catch (err) {
      console.warn('centerOnYou DOM centering failed', err);
    }

    if (!you || ordered.length === 0 || seatPositions.length === 0) {
      const cx = camRef.current.x, cy = camRef.current.y;
      centerOnNearestWorldPoint(cx, cy, preserveZoom);
      return;
    }
    let idx = -1;
    for (let i = 0; i < ordered.length; i++) {
      const o = ordered[i];
      if (o.player.id === you) { idx = i; break; }
    }
    if (idx === -1) {
      const cx = camRef.current.x, cy = camRef.current.y;
      centerOnNearestWorldPoint(cx, cy, preserveZoom);
      return;
    }
    const pos = seatPositions[idx];
    if (!pos) { centerOnBoardIndex(idx, preserveZoom); return; }
    const dirX = -pos.x;
    const dirY = -pos.y;
    const mag = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / mag;
    const ny = dirY / mag;
    const shift = Math.min(Math.max(halfH * 0.18, 120), 600);
    const cx2 = pos.x + nx * shift;
    // Add a vertical offset to push view down 20% of screen height
    // This prevents the mulligan bar from overlapping the deck import button on join
    const mulliganBarOffset = Math.round(container.h * 0.20);
    const cy2 = pos.y + ny * shift + mulliganBarOffset;
    setCam(c => ({ x: cx2, y: cy2, z: preserveZoom ? c.z : c.z }));
  }

  const didFit = useRef(false);
  useEffect(() => {
    if (!container.w || !container.h) return;
    const margin = 24;
    const zx = (container.w / 2 - margin) / (halfW + 40);
    const zy = (container.h / 2 - margin) / (halfH + 40);
    const fitZ = clamp(Math.min(zx, zy), MIN_INITIAL_ZOOM, 2.0);
    if (!didFit.current || ordered.length !== (didFit as any).lastN) {
      centerOnYou(true);
      setCam(prev => ({ x: prev.x, y: prev.y, z: fitZ }));
      didFit.current = true;
      (didFit as any).lastN = ordered.length;
    }
  }, [container.w, container.h, ordered.length, halfW, halfH]);

  // Auto-center on player's playfield when `you` prop changes (player joins the game)
  // Note: centerOnYou is intentionally not in deps - it uses refs/state that don't cause stale closures
  // and including it would cause unnecessary re-runs since it's not wrapped in useCallback
  const prevYou = useRef<PlayerID | undefined>(undefined);
  useEffect(() => {
    if (you && you !== prevYou.current && container.w && container.h) {
      // Small delay to allow the DOM to update with player's hand area
      const timer = setTimeout(() => {
        centerOnYou(true);
      }, 100);
      prevYou.current = you;
      return () => clearTimeout(timer);
    }
    prevYou.current = you;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you, container.w, container.h]);

  const prevOrientationRef = useRef(mobilePlayLayout.orientation);
  useEffect(() => {
    if (prevOrientationRef.current === mobilePlayLayout.orientation) return;
    prevOrientationRef.current = mobilePlayLayout.orientation;
    if (!container.w || !container.h) return;
    if (!focusedPlayerId) return;
    const timer = setTimeout(() => {
      const idx = ordered.findIndex((entry) => entry.player.id === focusedPlayerId);
      if (idx >= 0) {
        focusOnBoardIndex(idx);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [mobilePlayLayout.orientation, container.w, container.h, focusedPlayerId, ordered, seatPositions]);

  useEffect(() => {
    if (!focusedPlayerId) return;
    const idx = ordered.findIndex((entry) => entry.player.id === focusedPlayerId);
    if (idx >= 0) {
      focusOnBoardIndex(idx);
    }
  }, [focusedPlayerId, ordered, seatPositions, container.w, container.h]);

  return {
    containerRef,
    container,
    cam,
    setCam,
    dragRef,
    panKey,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    yourBattlefieldExpanded,
    handleToggleYourBattlefieldExpanded,
    showAbilityBadges,
    handleToggleAbilityBadges,
    pendingTextSwapSource,
    setPendingTextSwapSource,
    pendingXActivation,
    setPendingXActivation,
    zoneContextMenu,
    setZoneContextMenu,
    ignoredCardsSet,
    setIgnoredCardsSet,
    centerOnYou,
  };
}
