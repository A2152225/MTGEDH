// Origin parent: rules-engine/src/actions/triggersHandler.ts
// Cluster moved: TriggerResult and trigger-processing option/assignment types.
// Public entry symbols: TriggerResult, TriggerProcessingOptions, StepTriggerProcessingOptions,
//   ETBTriggerProcessingOptions, LandfallTriggerProcessingOptions, DiesTriggerProcessingOptions,
//   SpellCastTriggerProcessingOptions, DrawTriggerProcessingOptions, CombatDamageTriggerProcessingOptions,
//   BecomesBlockedTriggerProcessingOptions, DelayedTriggerEventCheck, DelayedEventTriggerProcessingOptions,
//   CombatDamageTriggerAssignment, AttackTriggerAssignment, BecomesBlockedTriggerAssignment.
// Leaf must not import actions/triggersHandler.ts or triggersHandler-handlers/index.ts.

import type { GameState } from '../../../../shared/src';
import type { TriggerEventData } from '../../triggeredAbilities';
import type { DelayedTriggerRegistry } from '../../delayedTriggeredAbilities';

export interface TriggerResult {
  state: GameState;
  triggersAdded: number;
  oracleStepsApplied?: number;
  oracleStepsSkipped?: number;
  oracleExecutions?: number;
  oracleAutomationGaps?: number;
  logs: string[];
}

export interface TriggerProcessingOptions {
  /**
   * When true, triggered ability effect text is executed immediately via Oracle IR
   * (deterministic subset only) in addition to queueing stack trigger objects.
   */
  autoExecuteOracle?: boolean;
  /** Forwarded to Oracle IR execution when autoExecuteOracle is enabled. */
  allowOptional?: boolean;
  /**
   * Optional resolution-time trigger context used for intervening-if rechecks
   * during auto Oracle execution.
   */
  resolutionEventData?: TriggerEventData;
}

export interface StepTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional delayed trigger registry to consume for this step. Defaults to state.delayedTriggerRegistry. */
  delayedTriggerRegistry?: DelayedTriggerRegistry;
  /** Current turn number for delayed-trigger timing checks. Defaults to state.turnNumber/state.turn. */
  turnNumber?: number;
}

export interface ETBTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the entering permanent context. */
  eventData?: TriggerEventData;
}

export interface LandfallTriggerProcessingOptions extends Omit<TriggerProcessingOptions, 'autoExecuteOracle'> {
  /** Optional explicit event data to merge into the landfall trigger context. */
  eventData?: TriggerEventData;
}

export interface DiesTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data for the dying object when current state cannot fully infer it. */
  eventData?: TriggerEventData;
  /** Include battlefield abilities that watch a controlled creature dying. Defaults to true. */
  includeControlledCreatureDeath?: boolean;
}

export interface SpellCastTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the cast-spell context. */
  eventData?: TriggerEventData;
}

export interface DrawTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the draw trigger context. */
  eventData?: TriggerEventData;
}

export interface CombatDamageTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into each combat-damage assignment context. */
  eventData?: TriggerEventData;
}

export interface BecomesBlockedTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional explicit event data to merge into the blocked-attacker context. */
  eventData?: TriggerEventData;
}

export interface DelayedTriggerEventCheck {
  readonly type:
    | 'end_step'
    | 'upkeep'
    | 'combat_end'
    | 'combat_begin'
    | 'cleanup'
    | 'permanent_left'
    | 'dies'
    | 'dies_or_exiled'
    | 'control_lost'
    | 'turn_start';
  readonly playerId?: string;
  readonly activePlayerId?: string;
  readonly permanentId?: string;
  readonly currentTurn?: number;
  readonly eligibleTriggerIds?: ReadonlySet<string>;
}

export interface DelayedEventTriggerProcessingOptions extends TriggerProcessingOptions {
  /** Optional delayed trigger registry to process. Defaults to state.delayedTriggerRegistry. */
  delayedTriggerRegistry?: DelayedTriggerRegistry;
}

export interface CombatDamageTriggerAssignment {
  readonly attackerId?: string;
  readonly damage?: number;
  readonly defendingPlayerId?: string;
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
}

export interface AttackTriggerAssignment {
  readonly attackerId?: string;
  readonly defendingPlayerId?: string;
  readonly targetPlayerId?: string;
  readonly targetOpponentId?: string;
  readonly eventData?: TriggerEventData;
}

export interface BecomesBlockedTriggerAssignment {
  readonly attackerId?: string;
  readonly defendingPlayerId?: string;
}
