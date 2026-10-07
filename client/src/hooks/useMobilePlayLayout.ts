/**
 * Orientation-aware layout profile for touch play sessions (phones / small tablets).
 * Portrait favors a compact Arena-like board; landscape uses a wider, taller viewport.
 */

import { useEffect, useMemo } from 'react';
import { breakpoints } from '../theme';
import { useIsTouch } from './useIsTouch';
import { getViewportOrientation, useViewport, type ViewportOrientation } from './useViewport';

export type { ViewportOrientation };

export type MobilePlayLayoutMode = 'desktop' | 'mobile-portrait' | 'mobile-landscape';

export interface MobilePlayLayoutProfile {
  orientation: ViewportOrientation;
  /** Touch device using compact mobile play sizing (not full desktop mat). */
  isMobilePlay: boolean;
  mode: MobilePlayLayoutMode;
  /** Bottom dock + mobile deck affordances instead of the utility rail. */
  showMobileChrome: boolean;
  battlefieldTileWidth: number;
  battlefieldViewportRows: number;
  battlefieldGridCols: number;
  zonesPanelWidth: number;
  handExtraPadding: number;
  boardHeightPadding: number;
  playAreaTopOffset: number;
  /** Vertical anchor for auto-center on your hand (fraction of container height). */
  centerHandViewportFraction: number;
  seatGapX: number;
  seatGapY: number;
  /** Thumb width for the fixed hand strip above the dock. */
  handStripThumbWidth: number;
  /** Bottom inset for play area (hand strip + dock + safe area). */
  playAreaBottomInset: number;
}

const DESKTOP_PROFILE: Omit<MobilePlayLayoutProfile, 'orientation' | 'isMobilePlay' | 'mode' | 'showMobileChrome'> = {
  battlefieldTileWidth: 135,
  battlefieldViewportRows: 5,
  battlefieldGridCols: 7,
  zonesPanelWidth: 175,
  handExtraPadding: 80,
  boardHeightPadding: 320,
  playAreaTopOffset: 140,
  centerHandViewportFraction: 0.92,
  seatGapX: 90,
  seatGapY: 90,
  handStripThumbWidth: 110,
  playAreaBottomInset: 0,
};

const PORTRAIT_PROFILE: Omit<MobilePlayLayoutProfile, 'orientation' | 'isMobilePlay' | 'mode' | 'showMobileChrome'> = {
  battlefieldTileWidth: 92,
  battlefieldViewportRows: 2,
  battlefieldGridCols: 4,
  zonesPanelWidth: 118,
  handExtraPadding: 36,
  boardHeightPadding: 120,
  playAreaTopOffset: 108,
  centerHandViewportFraction: 0.78,
  seatGapX: 56,
  seatGapY: 56,
  handStripThumbWidth: 76,
  // Dock (~56) + hand strip header/Expand (~48) + thumb row (~106) + strip pad (~8) + buffer.
  // Safe-area is subtracted separately in TableLayout via env(safe-area-inset-bottom).
  playAreaBottomInset: 236,
};

const LANDSCAPE_PROFILE: Omit<MobilePlayLayoutProfile, 'orientation' | 'isMobilePlay' | 'mode' | 'showMobileChrome'> = {
  battlefieldTileWidth: 108,
  battlefieldViewportRows: 3,
  battlefieldGridCols: 6,
  zonesPanelWidth: 148,
  handExtraPadding: 48,
  boardHeightPadding: 160,
  playAreaTopOffset: 88,
  centerHandViewportFraction: 0.82,
  seatGapX: 72,
  seatGapY: 72,
  handStripThumbWidth: 76,
  // Landscape dock (~52) + hand strip (~162) + buffer; safe-area via TableLayout env().
  playAreaBottomInset: 200,
};

export function getMobilePlayLayoutProfile(
  isTouch: boolean,
  width: number,
  height: number,
): MobilePlayLayoutProfile {
  const orientation = getViewportOrientation(width, height);
  const isMobilePlay = isTouch && width < breakpoints.desktop;

  if (!isMobilePlay) {
    return {
      orientation,
      isMobilePlay: false,
      mode: 'desktop',
      showMobileChrome: false,
      ...DESKTOP_PROFILE,
    };
  }

  const isPortrait = orientation === 'portrait';
  const sizing = isPortrait ? PORTRAIT_PROFILE : LANDSCAPE_PROFILE;

  return {
    orientation,
    isMobilePlay: true,
    mode: isPortrait ? 'mobile-portrait' : 'mobile-landscape',
    showMobileChrome: isPortrait || width < 900,
    ...sizing,
  };
}

export function useMobilePlayLayout(): MobilePlayLayoutProfile {
  const isTouch = useIsTouch();
  const { width, height } = useViewport();
  return useMemo(
    () => getMobilePlayLayoutProfile(isTouch, width, height),
    [isTouch, width, height],
  );
}

/** Toggles `orientation-portrait` / `orientation-landscape` on document.body. */
export function useOrientationBodyClass(): ViewportOrientation {
  const { orientation } = useViewport();
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('orientation-portrait', 'orientation-landscape');
    document.body.classList.add(`orientation-${orientation}`);
  }, [orientation]);
  return orientation;
}
