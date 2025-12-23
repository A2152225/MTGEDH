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
  DAMAGE_DIVISION = 'damage_division',
  DISCARD_SELECTION = 'discard_selection',
  HAND_TO_BOTTOM = 'hand_to_bottom',
  TOKEN_CEASES_TO_EXIST = 'token_ceases_to_exist',
  COPY_CEASES_TO_EXIST = 'copy_ceases_to_exist',
  COMMANDER_ZONE_CHOICE = 'commander_zone_choice',
  TRIGGER_ORDER = 'trigger_order',
  TRIGGER_TARGET = 'trigger_target',
  REPLACEMENT_EFFECT_CHOICE = 'replacement_effect_choice',
  WIN_EFFECT_TRIGGERED = 'win_effect_triggered',
  CANT_LOSE_PREVENTED = 'cant_lose_prevented',
  COLOR_CHOICE = 'color_choice',
  CREATURE_TYPE_CHOICE = 'creature_type_choice',
  CARD_NAME_CHOICE = 'card_name_choice',
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
  BOUNCE_LAND_CHOICE = 'bounce_land_choice',
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
  DEVOUR_SELECTION = 'devour_selection',
  SUSPEND_CAST = 'suspend_cast',
  MORPH_TURN_FACE_UP = 'morph_turn_face_up',
  FATESEAL = 'fateseal',
  CLASH = 'clash',
  VOTE = 'vote',
  
  // Activated ability resolution (for non-mana abilities)
  ACTIVATED_ABILITY = 'activated_ability',
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
  [ResolutionStepType.DAMAGE_DIVISION]: ChoiceEventType.DAMAGE_DIVISION,
  [ResolutionStepType.DISCARD_SELECTION]: ChoiceEventType.DISCARD_SELECTION,
  [ResolutionStepType.HAND_TO_BOTTOM]: ChoiceEventType.HAND_TO_BOTTOM,
  [ResolutionStepType.TOKEN_CEASES_TO_EXIST]: ChoiceEventType.TOKEN_CEASES_TO_EXIST,
  [ResolutionStepType.COPY_CEASES_TO_EXIST]: ChoiceEventType.COPY_CEASES_TO_EXIST,
  [ResolutionStepType.COMMANDER_ZONE_CHOICE]: ChoiceEventType.COMMANDER_ZONE_CHOICE,
  [ResolutionStepType.TRIGGER_ORDER]: ChoiceEventType.TRIGGER_ORDER,
  [ResolutionStepType.TRIGGER_TARGET]: ChoiceEventType.TRIGGER_TARGET,
  [ResolutionStepType.REPLACEMENT_EFFECT_CHOICE]: ChoiceEventType.REPLACEMENT_EFFECT_CHOICE,
  [ResolutionStepType.WIN_EFFECT_TRIGGERED]: ChoiceEventType.WIN_EFFECT_TRIGGERED,
  [ResolutionStepType.CANT_LOSE_PREVENTED]: ChoiceEventType.CANT_LOSE_PREVENTED,
  [ResolutionStepType.COLOR_CHOICE]: ChoiceEventType.COLOR_CHOICE,
  [ResolutionStepType.CREATURE_TYPE_CHOICE]: ChoiceEventType.CREATURE_TYPE_CHOICE,
  [ResolutionStepType.CARD_NAME_CHOICE]: ChoiceEventType.CARD_NAME_CHOICE,
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
  pendingBounceLandChoice: ResolutionStepType.BOUNCE_LAND_CHOICE,
  pendingCreatureTypeSelection: ResolutionStepType.CREATURE_TYPE_CHOICE,
  pendingFlickerReturns: ResolutionStepType.FLICKER_RETURNS,
  pendingLinkedExileReturns: ResolutionStepType.LINKED_EXILE_RETURNS,
  pendingJoinForces: ResolutionStepType.JOIN_FORCES,
  pendingTemptingOffer: ResolutionStepType.TEMPTING_OFFER,
  pendingProliferate: ResolutionStepType.PROLIFERATE,
  pendingKynaiosChoice: ResolutionStepType.KYNAIOS_CHOICE,
  pendingCascade: ResolutionStepType.CASCADE,
  pendingScry: ResolutionStepType.SCRY,
  pendingSurveil: ResolutionStepType.SURVEIL,
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
 * Generic step for revealing/searching library and selecting cards
 * Can be used for: Genesis Wave, library tutors, Impulse, etc.
 */
export interface LibrarySearchStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.LIBRARY_SEARCH;
  readonly searchCriteria: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly mandatory: boolean;
  readonly destination: 'hand' | 'battlefield' | 'top' | 'bottom' | 'graveyard' | 'exile';
  readonly reveal: boolean;
  readonly shuffleAfter: boolean;
  /** What to do with cards that weren't selected */
  readonly remainderDestination?: 'graveyard' | 'bottom' | 'top' | 'shuffle' | 'hand';
  /** Whether remainder should be in random order */
  readonly remainderRandomOrder?: boolean;
  /** The actual cards available to choose from (for reveal effects) */
  readonly availableCards?: readonly KnownCardRef[];
  /** Cards that were revealed but aren't selectable (shown for info) */
  readonly nonSelectableCards?: readonly KnownCardRef[];
  /** Additional context like X value for Genesis Wave */
  readonly contextValue?: number;
  /** Whether selected cards enter tapped (for battlefield destination) */
  readonly entersTapped?: boolean;
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
 * Surveil resolution step
 * 
 * Similar to scry but cards can go to graveyard instead of bottom of library.
 * Reference: Rule 701.25 - Surveil
 */
export interface SurveilStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.SURVEIL;
  readonly cards: readonly KnownCardRef[];
  readonly surveilCount: number;
}

/**
 * Proliferate resolution step
 * 
 * Player chooses any number of permanents and/or players with counters
 * and adds one counter of each kind already there.
 * 
 * Reference: Rule 701.28 - Proliferate
 */
export interface ProliferateStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.PROLIFERATE;
  readonly proliferateId: string; // Unique ID for this proliferate effect
  readonly availableTargets: readonly {
    id: string;
    name: string;
    counters: Record<string, number>;
    isPlayer: boolean;
  }[];
}

/**
 * Fateseal resolution step
 * 
 * Like scry but player looks at opponent's library instead of their own.
 * Reference: Rule 701.29 - Fateseal
 */
export interface FatesealStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.FATESEAL;
  readonly opponentId: string; // Whose library is being fatesealed
  readonly cards: readonly KnownCardRef[];
  readonly fatesealCount: number;
}

/**
 * Clash resolution step
 * 
 * Player reveals top card and chooses whether to put it on bottom.
 * Reference: Rule 701.30 - Clash
 */
export interface ClashStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.CLASH;
  readonly revealedCard: KnownCardRef;
  readonly opponentId?: string; // For "clash with an opponent"
}

/**
 * Vote resolution step
 * 
 * Players vote in APNAP order for one of the available choices.
 * Reference: Rule 701.38 - Vote
 */
export interface VoteStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.VOTE;
  readonly voteId: string; // Unique ID for this vote
  readonly choices: readonly string[]; // Available vote options
  readonly votesSubmitted: readonly {
    playerId: string;
    choice: string;
    voteCount: number;
  }[]; // Votes already cast
}

/**
 * Kynaios and Tiro style choice resolution step
 * Player may put a land onto the battlefield, or (for opponents) draw a card
 */
export interface KynaiosChoiceStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.KYNAIOS_CHOICE;
  readonly isController: boolean;
  readonly sourceController: string;
  readonly canPlayLand: boolean;
  readonly landsInHand: readonly { id: string; name: string; imageUrl?: string }[];
  readonly options: readonly ('play_land' | 'draw_card' | 'decline')[];
}

/**
 * Join Forces resolution step
 * "Join forces — Starting with you, each player may pay any amount of mana."
 * Each player may contribute mana to increase the effect.
 */
export interface JoinForcesStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.JOIN_FORCES;
  readonly cardName: string;
  readonly effectDescription: string;
  readonly cardImageUrl?: string;
  readonly initiator: string;
  readonly availableMana: number;
  readonly isInitiator: boolean;
}

/**
 * Tempting Offer resolution step
 * "Tempting offer — [effect]. Each opponent may [accept]. For each opponent who does, [bonus]"
 * Each opponent may accept or decline the offer.
 */
export interface TemptingOfferStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.TEMPTING_OFFER;
  readonly cardName: string;
  readonly effectDescription: string;
  readonly cardImageUrl?: string;
  readonly initiator: string;
  readonly isOpponent: boolean;  // Should be true for opponents making the choice
}

/**
 * Bounce Land Choice resolution step
 * When a bounce land enters the battlefield, the controller must return a land to hand.
 * Player selects which land to return (including the bounce land itself).
 */
export interface BounceLandChoiceStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.BOUNCE_LAND_CHOICE;
  readonly bounceLandId: string;
  readonly bounceLandName: string;
  readonly landsToChoose: readonly { 
    permanentId: string; 
    cardName: string; 
    imageUrl?: string; 
  }[];
  readonly stackItemId?: string;
}

/**
 * Cascade resolution step
 * When a cascade spell is cast, exile cards until hitting a nonland card with lower mana value
 */
export interface CascadeStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.CASCADE;
  readonly cascadeNumber: number;
  readonly totalCascades: number;
  readonly manaValue: number;
  readonly hitCard?: KnownCardRef;
  readonly exiledCards: readonly KnownCardRef[];
  readonly effectId: string;
}

/**
 * Devour Selection resolution step
 * When a creature with Devour X enters, player chooses creatures to sacrifice
 */
export interface DevourSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.DEVOUR_SELECTION;
  readonly devourValue: number; // X in "Devour X"
  readonly creatureId: string; // The devouring creature
  readonly creatureName: string;
  readonly availableCreatures: readonly {
    permanentId: string;
    cardName: string;
    imageUrl?: string;
  }[];
}

/**
 * Suspend Cast resolution step
 * Handles casting a spell with suspend (exile with time counters)
 */
export interface SuspendCastStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.SUSPEND_CAST;
  readonly card: KnownCardRef;
  readonly suspendCost: string;
  readonly timeCounters: number;
}

/**
 * Morph Turn Face-Up resolution step  
 * When a player wants to turn a face-down creature face-up
 */
export interface MorphTurnFaceUpStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.MORPH_TURN_FACE_UP;
  readonly permanentId: string;
  readonly morphCost?: string;
  readonly actualCard: KnownCardRef;
  readonly canAfford: boolean;
}

/**
 * Activated Ability resolution step
 * For non-mana activated abilities that are being resolved from the stack.
 * This includes Crystal abilities, group draw effects, X-activated abilities, etc.
 */
export interface ActivatedAbilityStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.ACTIVATED_ABILITY;
  readonly permanentId: string;
  readonly permanentName: string;
  readonly abilityType: 'crystal' | 'group_draw' | 'x_activated' | 'generic';
  readonly abilityDescription: string;
  readonly targets?: readonly string[];
  readonly xValue?: number;
  readonly abilityData?: Record<string, any>;
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
  | SurveilStep
  | ProliferateStep
  | FatesealStep
  | ClashStep
  | VoteStep
  | KynaiosChoiceStep
  | JoinForcesStep
  | TemptingOfferStep
  | BounceLandChoiceStep
  | CascadeStep
  | DevourSelectionStep
  | SuspendCastStep
  | MorphTurnFaceUpStep
  | ActivatedAbilityStep
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
