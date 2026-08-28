// client/src/components/FreeField-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/components/FreeField.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/components/FreeField.tsx.
// Never create FreeField/ beside FreeField.tsx.
// Leaves must not import FreeField.tsx or this index.

// P/T colors, loyalty colors, tooltips, ability-badge labels, grouped-token IDs.
export {
  permanentIdsForPositionUpdate,
  parsePT,
  computeDisplayPT,
  getPTColor,
  getLoyaltyColor,
  buildPTTooltip,
  getAbilityDisplay,
  readPermanentDamageMarked,
} from './freeFieldDisplayUtils';

// Battlefield-tile overlay badges (token/combat/P/T/loyalty/ability buttons).
export { FreeFieldPermanentOverlays } from './FreeFieldPermanentOverlays';
export type { FreeFieldPermanentOverlaysProps } from './FreeFieldPermanentOverlays';

// Grid placement + display-item useMemo for the playmat.
export { useFreeFieldBattlefieldLayout } from './useFreeFieldBattlefieldLayout';
export type { FreeFieldBattlefieldLayoutArgs } from './useFreeFieldBattlefieldLayout';
