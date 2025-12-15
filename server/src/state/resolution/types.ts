/**
 * resolution/types.ts
 * 
 * Unified Resolution System types that integrate with the rules-engine ChoiceEvent system.
 * This provides a single queue for all pending player interactions instead of multiple
 * pending* state fields.
 * 
 * Key concepts:
 * - ResolutionStep: A single player choice/action that needs resolution
 * - ResolutionQueue: FIFO queue of ResolutionSteps for a game
 * - APNAP ordering: Steps are ordered by Active Player, Non-Active Player turn order
 */

import type { PlayerID, KnownCardRef } from '../../../../shared/src/types.js';
import { ChoiceEventType, type ChoiceEvent, type ChoiceOption } from '../../../../rules-engine/src/choiceEvents.js';

/**
 * Resolution step status
 */
export enum ResolutionStepStatus {
  /** Step is pending, waiting for player action */
  PENDING = 'pending',
  /** Step is currently being processed (player is choosing) */
  ACTIVE = 'active',
  /** Step has been completed */
  COMPLETED = 'completed',
  /** Step was cancelled/skipped */
  CANCELLED = 'cancelled',
  /** Step timed out */
  TIMED_OUT = 'timed_out',
}

/**
 * Resolution step type - maps to both legacy pending* fields and rules-engine ChoiceEventType
 */
export enum ResolutionStepType {
  // Direct mappings to ChoiceEventType
  TARGET_SELECTION = 'target_selection',
  MODE_SELECTION = 'mode_selection',
  X_VALUE_SELECTION = 'x_value_selection',
  ATTACKER_DECLARATION = 'attacker_declaration',
  BLOCKER_DECLARATION = 'blocker_declaration',
  MAY_ABILITY = 'may_ability',
  COMBAT_DAMAGE_ASSIGNMENT = 'combat_damage_assignment',
  BLOCKER_ORDER = 'blocker_order',
  DISCARD_SELECTION = 'discard_selection',
  COMMANDER_ZONE_CHOICE = 'commander_zone_choice',
  TRIGGER_ORDER = 'trigger_order',
  REPLACEMENT_EFFECT_CHOICE = 'replacement_effect_choice',
  COLOR_CHOICE = 'color_choice',
  CREATURE_TYPE_CHOICE = 'creature_type_choice',
  NUMBER_CHOICE = 'number_choice',
  PLAYER_CHOICE = 'player_choice',
  OPTION_CHOICE = 'option_choice',
  MANA_PAYMENT_CHOICE = 'mana_payment_choice',
  
  // Legacy pending* field types
  PONDER_EFFECT = 'ponder_effect',
  SACRIFICE_ABILITY = 'sacrifice_ability',
  ENTRAPMENT_MANEUVER = 'entrapment_maneuver',
  MODAL_CHOICE = 'modal_choice',
  MANA_COLOR_SELECTION = 'mana_color_selection',
  LIBRARY_SEARCH = 'library_search',
  FLICKER_RETURNS = 'flicker_returns',
  LINKED_EXILE_RETURNS = 'linked_exile_returns',
  JOIN_FORCES = 'join_forces',
  TEMPTING_OFFER = 'tempting_offer',
  PROLIFERATE = 'proliferate',
  KYNAIOS_CHOICE = 'kynaios_choice',
  CASCADE = 'cascade',
  SCRY = 'scry',
  SURVEIL = 'surveil',
  DISCARD_EFFECT = 'discard_effect',
  MILL = 'mill',
}

/**
 * Mapping from ResolutionStepType to ChoiceEventType
 */
export const STEP_TO_CHOICE_EVENT_TYPE: Partial<Record<ResolutionStepType, ChoiceEventType>> = {
  [ResolutionStepType.TARGET_SELECTION]: ChoiceEventType.TARGET_SELECTION,
  [ResolutionStepType.MODE_SELECTION]: ChoiceEventType.MODE_SELECTION,
  [ResolutionStepType.X_VALUE_SELECTION]: ChoiceEventType.X_VALUE_SELECTION,
  [ResolutionStepType.ATTACKER_DECLARATION]: ChoiceEventType.ATTACKER_DECLARATION,
  [ResolutionStepType.BLOCKER_DECLARATION]: ChoiceEventType.BLOCKER_DECLARATION,
  [ResolutionStepType.MAY_ABILITY]: ChoiceEventType.MAY_ABILITY,
  [ResolutionStepType.COMBAT_DAMAGE_ASSIGNMENT]: ChoiceEventType.COMBAT_DAMAGE_ASSIGNMENT,
  [ResolutionStepType.BLOCKER_ORDER]: ChoiceEventType.BLOCKER_ORDER,
  [ResolutionStepType.DISCARD_SELECTION]: ChoiceEventType.DISCARD_SELECTION,
  [ResolutionStepType.COMMANDER_ZONE_CHOICE]: ChoiceEventType.COMMANDER_ZONE_CHOICE,
  [ResolutionStepType.TRIGGER_ORDER]: ChoiceEventType.TRIGGER_ORDER,
  [ResolutionStepType.REPLACEMENT_EFFECT_CHOICE]: ChoiceEventType.REPLACEMENT_EFFECT_CHOICE,
  [ResolutionStepType.COLOR_CHOICE]: ChoiceEventType.COLOR_CHOICE,
  [ResolutionStepType.CREATURE_TYPE_CHOICE]: ChoiceEventType.CREATURE_TYPE_CHOICE,
  [ResolutionStepType.NUMBER_CHOICE]: ChoiceEventType.NUMBER_CHOICE,
  [ResolutionStepType.PLAYER_CHOICE]: ChoiceEventType.PLAYER_CHOICE,
  [ResolutionStepType.OPTION_CHOICE]: ChoiceEventType.OPTION_CHOICE,
  [ResolutionStepType.MANA_PAYMENT_CHOICE]: ChoiceEventType.MANA_PAYMENT_CHOICE,
};

/**
 * Mapping from legacy pending* field names to ResolutionStepType
 */
export const LEGACY_PENDING_TO_STEP_TYPE: Record<string, ResolutionStepType> = {
  pendingDiscardSelection: ResolutionStepType.DISCARD_SELECTION,
  pendingCommanderZoneChoice: ResolutionStepType.COMMANDER_ZONE_CHOICE,
  pendingTriggerOrdering: ResolutionStepType.TRIGGER_ORDER,
  pendingPonder: ResolutionStepType.PONDER_EFFECT,
  pendingSacrificeAbility: ResolutionStepType.SACRIFICE_ABILITY,
  pendingEntrapmentManeuver: ResolutionStepType.ENTRAPMENT_MANEUVER,
  pendingTargets: ResolutionStepType.TARGET_SELECTION,
  pendingModalChoice: ResolutionStepType.MODAL_CHOICE,
  pendingManaColorSelection: ResolutionStepType.MANA_COLOR_SELECTION,
  pendingLibrarySearch: ResolutionStepType.LIBRARY_SEARCH,
  pendingCreatureTypeSelection: ResolutionStepType.CREATURE_TYPE_CHOICE,
  pendingFlickerReturns: ResolutionStepType.FLICKER_RETURNS,
  pendingLinkedExileReturns: ResolutionStepType.LINKED_EXILE_RETURNS,
  pendingJoinForces: ResolutionStepType.JOIN_FORCES,
  pendingTemptingOffer: ResolutionStepType.TEMPTING_OFFER,
  pendingProliferate: ResolutionStepType.PROLIFERATE,
  pendingKynaiosChoice: ResolutionStepType.KYNAIOS_CHOICE,
  pendingCascade: ResolutionStepType.CASCADE,
  pendingScry: ResolutionStepType.SCRY,
  pendingDiscard: ResolutionStepType.DISCARD_EFFECT,
  pendingMill: ResolutionStepType.MILL,
};

/**
 * Base interface for a resolution step
 */
export interface BaseResolutionStep {
  /** Unique identifier for this step */
  readonly id: string;
  /** Type of resolution required */
  readonly type: ResolutionStepType;
  /** Player who needs to make the choice */
  readonly playerId: PlayerID;
  /** Current status */
  status: ResolutionStepStatus;
  /** Source permanent/spell ID that created this step */
  readonly sourceId?: string;
  /** Source name for display */
  readonly sourceName?: string;
  /** Source image URL */
  readonly sourceImage?: string;
  /** Human-readable description */
  readonly description: string;
  /** Whether this step is mandatory (cannot be skipped) */
  readonly mandatory: boolean;
  /** Creation timestamp */
  readonly createdAt: number;
  /** Timeout in milliseconds (optional) */
  readonly timeoutMs?: number;
  /** Priority order within the queue (lower = higher priority) */
  priority: number;
  /** APNAP order index (for multiplayer ordering) */
  apnapOrder?: number;
  /** Associated ChoiceEvent from rules-engine (if applicable) */
  choiceEvent?: ChoiceEvent;
  /** Legacy pending field data (for backward compatibility) */
  legacyData?: any;
  /** Response from player (populated when completed) */
  response?: ResolutionStepResponse;
}

/**
 * Target selection resolution step
 */
export interface TargetSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.TARGET_SELECTION;
  readonly validTargets: readonly ChoiceOption[];
  readonly targetTypes: readonly string[];
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly targetDescription: string;
}

/**
 * Mode selection resolution step
 */
export interface ModeSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.MODE_SELECTION;
  readonly modes: readonly ChoiceOption[];
  readonly minModes: number;
  readonly maxModes: number;
  readonly allowDuplicates: boolean;
}

/**
 * Discard selection resolution step
 */
export interface DiscardSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.DISCARD_SELECTION;
  readonly hand: readonly ChoiceOption[];
  readonly discardCount: number;
  readonly currentHandSize: number;
  readonly maxHandSize: number;
  readonly reason: 'cleanup' | 'effect';
}

/**
 * Commander zone choice resolution step
 */
export interface CommanderZoneChoiceStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.COMMANDER_ZONE_CHOICE;
  readonly commanderId: string;
  readonly commanderName: string;
  readonly fromZone: 'graveyard' | 'exile' | 'library' | 'hand';
  readonly card: KnownCardRef;
}

/**
 * Trigger ordering resolution step
 */
export interface TriggerOrderStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.TRIGGER_ORDER;
  readonly triggers: readonly ChoiceOption[];
  readonly requireAll: boolean;
}

/**
 * Library search resolution step
 */
export interface LibrarySearchStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.LIBRARY_SEARCH;
  readonly searchCriteria: string;
  readonly maxSelections: number;
  readonly mandatory: boolean;
  readonly destination: 'hand' | 'battlefield' | 'top' | 'bottom';
  readonly reveal: boolean;
  readonly shuffleAfter: boolean;
}

/**
 * Option choice resolution step (generic)
 */
export interface OptionChoiceStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.OPTION_CHOICE | ResolutionStepType.MODAL_CHOICE;
  readonly options: readonly ChoiceOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
}

/**
 * Ponder effect resolution step
 */
export interface PonderEffectStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.PONDER_EFFECT;
  readonly cards: readonly KnownCardRef[];
  readonly variant: 'ponder' | 'serum_visions' | 'preordain' | 'brainstorm' | 'portent' | 'impulse' | 'anticipate';
  readonly cardCount: number;
  readonly drawAfter: boolean;
  readonly mayShuffleAfter: boolean;
}

/**
 * Scry resolution step
 */
export interface ScryStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.SCRY;
  readonly cards: readonly KnownCardRef[];
  readonly scryCount: number;
}

/**
 * Union of all resolution step types
 */
export type ResolutionStep = 
  | TargetSelectionStep
  | ModeSelectionStep
  | DiscardSelectionStep
  | CommanderZoneChoiceStep
  | TriggerOrderStep
  | LibrarySearchStep
  | OptionChoiceStep
  | PonderEffectStep
  | ScryStep
  | BaseResolutionStep;

/**
 * Response from player for a resolution step
 */
export interface ResolutionStepResponse {
  /** Step ID this response is for */
  readonly stepId: string;
  /** Player who responded */
  readonly playerId: PlayerID;
  /** Selected option IDs, values, or other response data */
  readonly selections: readonly string[] | number | boolean | Record<string, any>;
  /** Whether the step was cancelled/declined */
  readonly cancelled: boolean;
  /** Response timestamp */
  readonly timestamp: number;
}

/**
 * Resolution queue for a game
 */
export interface ResolutionQueue {
  /** Game ID this queue belongs to */
  readonly gameId: string;
  /** Steps awaiting resolution (FIFO order) */
  steps: ResolutionStep[];
  /** History of completed steps (for debugging/logging) */
  completedSteps: ResolutionStep[];
  /** Current active step (if any) */
  activeStep?: ResolutionStep;
  /** Sequence number for ordering */
  seq: number;
}

/**
 * Configuration for creating a resolution step
 */
export interface CreateResolutionStepConfig {
  type: ResolutionStepType;
  playerId: PlayerID;
  description: string;
  mandatory?: boolean;
  sourceId?: string;
  sourceName?: string;
  sourceImage?: string;
  timeoutMs?: number;
  priority?: number;
  legacyData?: any;
  choiceEvent?: ChoiceEvent;
  // Type-specific fields
  [key: string]: any;
}

export default {
  ResolutionStepStatus,
  ResolutionStepType,
  STEP_TO_CHOICE_EVENT_TYPE,
  LEGACY_PENDING_TO_STEP_TYPE,
};
