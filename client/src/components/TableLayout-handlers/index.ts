// client/src/components/TableLayout-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/components/TableLayout.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/components/TableLayout.tsx.
// Never create TableLayout/ beside TableLayout.tsx.
// Leaves must not import TableLayout.tsx or this index.

// Mana-rock / mana-dork classification used when splitting the battlefield rows.
export { isManaSource } from './tableLayoutManaSource';

// Seat geometry, camera math, and shared board/hand types.
export {
  clamp,
  isLandTypeLine,
  rotatePoint,
  getTotalFloatingMana,
  MIN_INITIAL_ZOOM,
  sidePlan,
  buildPositions,
  computeExtents,
} from './tableLayoutGeometry';
export type { Side, PlayerBoard, HandCard } from './tableLayoutGeometry';

// Pan/zoom camera, pointer gestures, fit/focus, and related board UI state.
export { useTableLayoutViewport } from './useTableLayoutViewport';
export type { UseTableLayoutViewportArgs, TableLayoutSeatPosition } from './useTableLayoutViewport';

// Player-seat header row (name, counters, designations, decks button).
export { TableLayoutPlayerSeatHeader } from './tableLayoutPlayerSeatHeader';
export type { TableLayoutPlayerSeatHeaderProps } from './tableLayoutPlayerSeatHeader';

// Remaining player-seat locals + board/hand/zones JSX.
export { renderTableLayoutPlayerSeat } from './tableLayoutPlayerSeat';
export type { RenderTableLayoutPlayerSeatArgs } from './tableLayoutPlayerSeat';
