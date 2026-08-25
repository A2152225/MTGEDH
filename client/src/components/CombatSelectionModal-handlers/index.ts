// client/src/components/CombatSelectionModal-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/components/CombatSelectionModal.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/components/CombatSelectionModal.tsx.
// Never create CombatSelectionModal/ beside CombatSelectionModal.tsx.
// Leaves must not import CombatSelectionModal.tsx or this index.

// Public modal prop and selection types (re-exported from CombatSelectionModal.tsx).
export type {
  DefenderAttackInfo,
  CombatSelectionModalProps,
  AttackerSelection,
  BlockerSelection,
} from './combatSelectionModalTypes';

// Effective P/T plus combat danger flags for a battlefield permanent.
export { getCreatureInfo } from './combatSelectionModalCreatureInfo';
export type { DangerIndicators } from './combatSelectionModalCreatureInfo';

// Group identical creatures/tokens for bulk attacker and blocker assignment.
export { groupCreatures } from './combatSelectionModalGroupCreatures';
export type { CreatureGroup } from './combatSelectionModalGroupCreatures';

// Keyword/goad/lure danger badges shown on creature cards in the modal.
export { DangerIndicatorBadges } from './combatSelectionModalDangerBadges';

// Attacker-mode bulk/group/grid declaration UI.
export { CombatAttackerSelectionPanel } from './combatSelectionModalAttackerPanel';
export type { CombatAttackerSelectionPanelProps } from './combatSelectionModalAttackerPanel';

// Blocker-mode creature lists, lure banner, and +/- assignment UI.
export { CombatBlockerSelectionPanel } from './combatSelectionModalBlockerPanel';
export type { CombatBlockerSelectionPanelProps } from './combatSelectionModalBlockerPanel';

// Menace check, blocker-map helpers, group split, and attacker selection builder.
export {
  checkMenaceBlocking,
  cloneSelectedBlockers,
  getBlockerAssignments,
  countBlockingCreatures,
  countTotalBlockAssignments,
  splitCreatureGroups,
  buildAttackerSelections,
} from './combatSelectionModalSelectionSupport';

// Attack-target label, badge, and card-preview hover handlers.
export {
  resolveAttackTargetLabel,
  AttackTargetBadge,
  getCombatCardPreviewHandlers,
} from './combatSelectionModalAttackTarget';
