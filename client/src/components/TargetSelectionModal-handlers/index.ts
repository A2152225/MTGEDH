// client/src/components/TargetSelectionModal-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/components/TargetSelectionModal.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/components/TargetSelectionModal.tsx.
// Never create TargetSelectionModal/ beside TargetSelectionModal.tsx.
// Leaves must not import TargetSelectionModal.tsx or this index.

// Target types, grouped-complete check, and ownership badge/caption helpers.
export type {
  TargetType,
  TargetOption,
  TargetSelectionGroup,
  TargetSelectionModalProps,
} from './targetSelectionModalSupport';
export {
  isGroupedTargetSelectionComplete,
  formatControllerGroupLabel,
  ownershipStyle,
  PermanentOwnershipBadge,
  PermanentTargetCaption,
} from './targetSelectionModalSupport';
// Player target tile (life, commander art, damage preview) and the reuse-for-identical-triggers toggle.
export { PlayerTargetTile, RepeatForIdenticalTriggersToggle } from './targetSelectionPlayerTile';
