/**
 * client/src/theme.ts
 *
 * Centralized design tokens for the MTGEDH client. This is a pure-additive
 * module: existing inline `style={{...}}` blocks continue to work unchanged.
 * New code (and incremental refactors) should prefer importing from `theme`
 * over re-inventing colors / spacing / radii / shadows.
 *
 * Mobile/touch-friendly numbers (e.g. min hit target) are exported here as
 * constants and consumed by individual components — they do NOT impose any
 * global side effects.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
} as const;

export const fontSize = {
  xxs: 10,
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 16,
  xxl: 20,
  display: 24,
} as const;

export const colors = {
  // Surfaces
  surface: 'rgba(30, 30, 40, 0.95)',
  surfaceRaised: 'rgba(40, 40, 52, 0.97)',
  surfaceOverlay: 'rgba(20, 20, 28, 0.92)',
  surfaceTransparent: 'rgba(255,255,255,0.04)',

  // Borders
  border: 'rgba(255,255,255,0.15)',
  borderStrong: 'rgba(255,255,255,0.28)',
  borderSubtle: 'rgba(255,255,255,0.08)',

  // Text
  textPrimary: '#e5e5e5',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  textInverse: '#0b0b10',

  // Accents
  accent: '#a78bfa',
  accentStrong: '#8b5cf6',
  accentSoft: 'rgba(167, 139, 250, 0.18)',

  // Semantic
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',

  // Highlights for in-game state
  playable: 'rgba(16, 185, 129, 0.45)',
  highlight: 'rgba(250, 204, 21, 0.55)',
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.18)',
  md: '0 2px 8px rgba(0,0,0,0.30)',
  lg: '0 8px 24px rgba(0,0,0,0.45)',
  xl: '0 18px 40px rgba(0,0,0,0.55)',
} as const;

/**
 * Z-index ladder — assign new floating UI here so we never regress to ad-hoc
 * z-index values that fight other layers (modals appearing under previews,
 * toasts under modals, etc.).
 */
export const z = {
  base: 1,
  card: 10,
  cardDrag: 50,
  drawer: 100,
  popover: 500,
  // Mobile bottom action dock — sits above floating in-game UI (which uses
  // 6000-9000 in App.tsx) but below modals so any open modal still wins.
  dock: 9500,
  // Modal range is intentionally aligned with the existing per-modal
  // zIndex values used across the app (8000-10004). New modals using these
  // tokens will slot at the top of that range without colliding.
  modalBackdrop: 10999,
  modal: 11000,
  // CardPreviewLayer historically uses 12000-12001; matched here.
  preview: 12000,
  // Toasts must float above every modal AND the preview layer.
  toast: 13000,
  shortcuts: 13100,
  commandPalette: 13200,
  // CardContextMenu historically uses 100000 — preserved as a sentinel.
  contextMenu: 100000,
} as const;

/**
 * Responsive breakpoints (matchMedia-friendly). Mobile-first widths.
 * Existing desktop layouts assume >= 1024 effectively.
 */
export const breakpoints = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

export const media = {
  touch: '(pointer: coarse)',
  hover: '(hover: hover)',
  mobile: `(max-width: ${breakpoints.tablet - 1}px)`,
  tablet: `(min-width: ${breakpoints.tablet}px) and (max-width: ${breakpoints.desktop - 1}px)`,
  desktop: `(min-width: ${breakpoints.desktop}px)`,
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

/**
 * Touch ergonomics — minimum hit target in pixels (Apple HIG = 44, MD = 48).
 * Components should opt-in via the `useIsTouch()` hook + this constant.
 */
export const touch = {
  minHitTarget: 44,
  longPressMs: 500,
} as const;

/**
 * Safe-area inset helpers for iOS notch / home indicator. These are CSS-side
 * `env()` strings so layout components can apply them as `paddingBottom` etc.
 */
export const safeArea = {
  top: 'env(safe-area-inset-top, 0px)',
  right: 'env(safe-area-inset-right, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
  left: 'env(safe-area-inset-left, 0px)',
} as const;

export type Theme = {
  spacing: typeof spacing;
  radii: typeof radii;
  fontSize: typeof fontSize;
  colors: typeof colors;
  shadows: typeof shadows;
  z: typeof z;
  breakpoints: typeof breakpoints;
  media: typeof media;
  touch: typeof touch;
  safeArea: typeof safeArea;
};

export const theme: Theme = {
  spacing,
  radii,
  fontSize,
  colors,
  shadows,
  z,
  breakpoints,
  media,
  touch,
  safeArea,
};
