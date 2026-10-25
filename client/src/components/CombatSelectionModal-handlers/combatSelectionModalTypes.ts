// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: DefenderAttackInfo, CombatSelectionModalProps, AttackerSelection, BlockerSelection.
// Public entry symbols: DefenderAttackInfo, CombatSelectionModalProps, AttackerSelection, BlockerSelection.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import type { BattlefieldPermanent, PlayerRef } from '../../../../shared/src';

export interface DefenderAttackInfo {
  untappedCreatureCount: number;
  attackTaxPerCreature: number;
  /** Norn's Annex `{W/P}` (and stacked copies): color mana or 2 life per item per attacker. */
  attackTaxPhyrexianPerCreature?: Array<{ symbol: string; life: number }>;
  /** Nils: `{X}` = counters on that attacking creature. */
  attackTaxCountersOnAttacker?: boolean;
}

export interface CombatSelectionModalProps {
  open: boolean;
  mode: 'attackers' | 'blockers';
  availableCreatures: BattlefieldPermanent[];
  attackingCreatures?: BattlefieldPermanent[]; // For blocker mode: which creatures are attacking
  /** Full battlefield (includes lands) for landwalk and evasion checks during blocking */
  battlefield?: BattlefieldPermanent[];
  /** All players in the game (for resolving attack targets in read-only views) */
  players?: PlayerRef[];
  defenders?: PlayerRef[]; // For attacker mode: which players/planeswalkers can be attacked
  /** Per-opponent untapped blockers and attack tax (Propaganda, Ghostly Prison, etc.) */
  defenderInfoMap?: Record<string, DefenderAttackInfo>;
  /** Pre-fill attacker selections (primarily for read-only viewers) */
  initialAttackTargets?: Record<string, string>;
  /** Called when attacker targets change (interactive attackers mode only) */
  onAttackTargetsChange?: (targets: Record<string, string>) => void;
  onConfirm: (selections: AttackerSelection[] | BlockerSelection[]) => void;
  onSkip: () => void;
  onCancel?: () => void;
  /** Collapse to a floating chip (modal stays open for this combat step) */
  minimized?: boolean;
  onMinimize?: () => void;
  onRestore?: () => void;
  errorMessage?: string | null;
  /** If true, the modal is view-only (for spectators or non-active players) */
  readOnly?: boolean;
  /** Per-player zones from the game view (graveyard-gated attackers such as Deep-Sea Terror). */
  zones?: Record<string, any>;
  /** Whether it's the current player's turn (for attackers mode) */
  isYourTurn?: boolean;
}

export interface AttackerSelection {
  creatureId?: string;
  groupId?: string;
  count?: number;
  targetPlayerId?: string;
  targetPermanentId?: string;
}

export interface BlockerSelection {
  blockerId: string;
  attackerId: string;
}
