// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: AttackerDeclaration, BlockerDeclaration, DeclareAttackersAction,
// DeclareBlockersAction, CombatDamageAssignment, DealCombatDamageAction.
// Public entry symbols: AttackerDeclaration, BlockerDeclaration,
// DeclareAttackersAction, DeclareBlockersAction, CombatDamageAssignment,
// DealCombatDamageAction.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

import type { BaseAction } from '../../core/types';

export interface AttackerDeclaration {
  readonly creatureId: string;
  readonly defendingPlayerId: string;
}

export interface BlockerDeclaration {
  readonly blockerId: string;
  readonly attackerId: string;
  readonly damageOrder?: number;
}

export interface DeclareAttackersAction extends BaseAction {
  readonly type: 'declareAttackers';
  readonly attackers: AttackerDeclaration[];
}

export interface DeclareBlockersAction extends BaseAction {
  readonly type: 'declareBlockers';
  readonly blockers: BlockerDeclaration[];
}

export interface CombatDamageAssignment {
  readonly attackerId: string;
  readonly damage: number;
  readonly defendingPlayerId?: string;
  readonly blockedBy?: Array<{ blockerId: string; damageAssigned: number }>;
  readonly creature?: any;
}

export interface DealCombatDamageAction extends BaseAction {
  readonly type: 'dealCombatDamage';
  readonly attackers: CombatDamageAssignment[];
}
