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
 * Resolution step type - integrates with rules-engine ChoiceEventType
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
  // Opening hand actions (Leylines, Chancellor effects)
  OPENING_HAND_ACTIONS = 'opening_hand_actions',
  BOTTOM_ORDER = 'bottom_order',
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

  // Mutate casting (choose target non-Human creature you own, then top/bottom)
  MUTATE_TARGET_SELECTION = 'mutate_target_selection',

  // Select cards from a graveyard (reanimation/return-to-hand style effects)
  GRAVEYARD_SELECTION = 'graveyard_selection',
  
  // Legacy pending* field types
  PONDER_EFFECT = 'ponder_effect',
  // Legacy interactive: Explore decision (put revealed card to graveyard or keep on top)
  EXPLORE_DECISION = 'explore_decision',
  // Legacy interactive: Batch explore (multiple explore decisions at once)
  BATCH_EXPLORE_DECISION = 'batch_explore_decision',
  // Legacy interactive: fight target selection
  FIGHT_TARGET = 'fight_target',
  // Legacy interactive: tap/untap target selection
  TAP_UNTAP_TARGET = 'tap_untap_target',
  // Legacy interactive: move a counter between permanents
  COUNTER_MOVEMENT = 'counter_movement',
  // Legacy interactive: choose a target to receive counters
  COUNTER_TARGET = 'counter_target',
  // Legacy interactive: Station creature selection (Spacecraft)
  STATION_CREATURE_SELECTION = 'station_creature_selection',
  // Legacy interactive: Forbidden Orchard opponent selection
  FORBIDDEN_ORCHARD_TARGET = 'forbidden_orchard_target',
  // Legacy interactive: MDFC face selection (play land as chosen face)
  MDFC_FACE_SELECTION = 'mdfc_face_selection',
  // Legacy interactive: pay X life as part of casting a spell (Toxic Deluge, Hatred, etc.)
  LIFE_PAYMENT = 'life_payment',
  // Legacy interactive: discard/sacrifice as an additional cost to cast
  ADDITIONAL_COST_PAYMENT = 'additional_cost_payment',
  // Legacy interactive: choose how many times to pay squad cost
  SQUAD_COST_PAYMENT = 'squad_cost_payment',
  SACRIFICE_ABILITY = 'sacrifice_ability',
  ENTRAPMENT_MANEUVER = 'entrapment_maneuver',
  MODAL_CHOICE = 'modal_choice',
  MANA_COLOR_SELECTION = 'mana_color_selection',
  LIBRARY_SEARCH = 'library_search',
  BOUNCE_LAND_CHOICE = 'bounce_land_choice',
  HIDEAWAY_CHOICE = 'hideaway_choice',
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

  // Two-pile split (Fact or Fiction style)
  TWO_PILE_SPLIT = 'two_pile_split',
  
  // Upkeep sacrifice triggers (Eldrazi Monument, Smokestack, etc.)
  UPKEEP_SACRIFICE = 'upkeep_sacrifice',
  
  // Activated ability resolution (for non-mana abilities)
  ACTIVATED_ABILITY = 'activated_ability',
  
  // Keyword ability choices
  KEYWORD_CHOICE = 'keyword_choice',       // Generic keyword choice
  RIOT_CHOICE = 'riot_choice',             // Choose counter or haste
  UNLEASH_CHOICE = 'unleash_choice',       // Choose to enter with counter
  FABRICATE_CHOICE = 'fabricate_choice',   // Choose counters or tokens
  TRIBUTE_CHOICE = 'tribute_choice',       // Opponent choice for tribute
  EXPLOIT_CHOICE = 'exploit_choice',       // Choose creature to sacrifice
  BACKUP_CHOICE = 'backup_choice',         // Choose target for backup
  MODULAR_CHOICE = 'modular_choice',       // Choose artifact creature for counters
  MYRIAD_TOKENS = 'myriad_tokens',         // Configure myriad token targets
  MENTOR_TARGET = 'mentor_target',         // Choose mentor target
  ENLIST_CHOICE = 'enlist_choice',         // Choose creature to tap for enlist
  EXTORT_PAYMENT = 'extort_payment',       // Choose to pay for extort
  SOULSHIFT_TARGET = 'soulshift_target',   // Choose spirit from graveyard
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
  /** Response from player (populated when completed) */
  response?: ResolutionStepResponse;
}

/**
 * Context for spell casting target selection
 * Used to track spell info for payment request after targets are selected
 */
export interface SpellCastContext {
  readonly cardId: string;
  readonly cardName: string;
  readonly manaCost: string;
  readonly playerId: string;
  readonly effectId: string;
  readonly oracleText?: string;
  readonly imageUrl?: string;
  readonly faceIndex?: number;
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
  /**
   * If true, the selected targets for this step must be different from targets chosen
   * in earlier TARGET_SELECTION steps for the same sourceId (spell/ability).
   *
   * Server may also infer this from text like "another target" / "different target".
   */
  readonly disallowPreviouslyChosenTargets?: boolean;
  /** Optional selected mode context (for modal spells/abilities) */
  readonly selectedMode?: ChoiceOption;
  /** Optional context for spell casting target selection */
  readonly spellCastContext?: SpellCastContext;
}

/**
 * Mutate target selection step
 * Used when casting a creature for its mutate cost (Rule 702.140).
 */
export interface MutateTargetSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.MUTATE_TARGET_SELECTION;
  readonly effectId: string;
  readonly cardId: string;
  readonly cardName: string;
  readonly mutateCost: string;
  readonly imageUrl?: string;
  readonly validTargets: readonly {
    id: string;
    name: string;
    typeLine: string;
    power?: string;
    toughness?: string;
    imageUrl?: string;
    controller: string;
    owner: string;
    isAlreadyMutated?: boolean;
    mutationCount?: number;
  }[];
}

/**
 * Graveyard selection step
 * Used when an effect requires selecting one or more cards from a graveyard.
 */
export interface GraveyardSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.GRAVEYARD_SELECTION;
  readonly effectId: string;
  readonly cardName: string;
  readonly title: string;
  readonly targetPlayerId: string; // whose graveyard is searched
  readonly filter?: { types?: string[]; subtypes?: string[]; excludeTypes?: string[] };
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly destination: 'hand' | 'battlefield' | 'library_top' | 'library_bottom' | 'exile';

  /** Optional semantic purpose used for server-side validation/continuation. */
  readonly purpose?: 'collectEvidence' | string;

  /** For collect-evidence prompts: required total mana value to exile. */
  readonly collectEvidenceMinManaValue?: number;

  /** Optional continuation context so the server can resume castSpellFromHand. */
  readonly castSpellFromHandArgs?: {
    cardId: string;
    payment?: any;
    targets?: any;
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
  };

  readonly validTargets: readonly {
    id: string;
    name: string;
    typeLine?: string;
    manaCost?: string;
    imageUrl?: string;
  }[];
  readonly imageUrl?: string;
}

/**
 * Fight target selection resolution step
 * Used for activated abilities that say "fights target creature ..."
 */
export interface FightTargetStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.FIGHT_TARGET;
  readonly targetFilter: {
    types?: readonly string[];
    controller?: 'you' | 'opponent' | 'any';
    excludeSource?: boolean;
  };
  readonly title?: string;
}

/**
 * Tap/Untap target selection resolution step
 * Used for activated abilities like "Untap two target lands" / "Tap or untap target permanent".
 */
export interface TapUntapTargetStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.TAP_UNTAP_TARGET;
  readonly action: 'tap' | 'untap' | 'both';
  readonly targetFilter: {
    types?: readonly string[];
    controller?: 'you' | 'opponent' | 'any';
    tapStatus?: 'tapped' | 'untapped' | 'any';
    excludeSource?: boolean;
  };
  readonly targetCount: number;
  readonly title?: string;
}

/**
 * Counter Movement resolution step
 * Used for abilities like Nesting Grounds: "Move a counter from target permanent you control onto another target permanent"
 */
export interface CounterMovementStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.COUNTER_MOVEMENT;
  readonly sourceFilter?: {
    controller?: 'you' | 'any';
  };
  readonly targetFilter?: {
    controller?: 'you' | 'any';
    excludeSource?: boolean;
  };
  readonly title?: string;
}

/**
 * Counter target selection resolution step
 * Used for activated abilities like "Put a +1/+1 counter on target creature".
 */
export interface CounterTargetStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.COUNTER_TARGET;
  readonly counterType: string;
  readonly targetController: 'opponent' | 'any' | 'you';
  readonly oracleText?: string;
  readonly scalingText?: string | null;
  readonly validTargets: readonly ChoiceOption[];
  readonly targetTypes: readonly string[];
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly targetDescription: string;
  readonly title?: string;
}

/**
 * Station creature selection resolution step
 * Used for Spacecraft Station abilities (Rule 702.184a).
 */
export interface StationCreatureSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.STATION_CREATURE_SELECTION;
  readonly station: {
    id: string;
    name: string;
    imageUrl?: string;
    threshold: number;
    currentCounters: number;
  };
  readonly creatures: readonly {
    id: string;
    name: string;
    power: number;
    toughness: number;
    imageUrl?: string;
  }[];
  readonly title?: string;
}

/**
 * Forbidden Orchard target selection step
 * "When you tap Forbidden Orchard for mana, target opponent creates a 1/1 colorless Spirit creature token."
 */
export interface ForbiddenOrchardTargetStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.FORBIDDEN_ORCHARD_TARGET;
  readonly opponents: readonly { id: string; name: string }[];
  readonly permanentId: string;
  readonly cardName: 'Forbidden Orchard' | string;
}

/**
 * MDFC face selection step
 * Used when a player needs to choose which face of a modal_dfc card to play as a land.
 */
export interface MdfcFaceSelectionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.MDFC_FACE_SELECTION;
  readonly cardId: string;
  readonly cardName: string;
  readonly fromZone: 'hand' | 'graveyard';
  readonly title?: string;
  readonly faces: readonly {
    index: number;
    name: string;
    typeLine?: string;
    oracleText?: string;
    manaCost?: string;
    imageUrl?: string;
  }[];
}

/**
 * Life payment step
 * Used when a spell requires choosing X life to pay as an additional casting cost.
 */
export interface LifePaymentStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.LIFE_PAYMENT;
  readonly cardId: string;
  readonly cardName: string;
  readonly currentLife: number;
  readonly minPayment: number;
  readonly maxPayment: number;
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

  /**
   * Optional context for spell-casting mode prompts.
   * These fields are intended for server-side continuation logic and are not required for most UI uses.
   */
  readonly modeSelectionPurpose?: 'overload' | 'abundantChoice' | string;
  readonly castSpellFromHandArgs?: {
    cardId: string;
    payment?: any;
    targets?: any;
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
  };
}

/**
 * Additional cost payment step
 * Used when a spell requires discarding/sacrificing as an additional cost to cast.
 */
export interface AdditionalCostPaymentStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.ADDITIONAL_COST_PAYMENT;
  readonly cardId: string;
  readonly cardName: string;
  readonly costType: 'discard' | 'sacrifice';
  readonly amount: number;
  readonly filter?: string;
  /** Optional keyword identifier for additional-cost-like prompts (e.g. 'bargain'). */
  readonly additionalCostKeyword?: string;
  readonly title: string;
  readonly imageUrl?: string;
  readonly availableCards?: readonly { id: string; name: string; imageUrl?: string; typeLine?: string }[];
  readonly availableTargets?: readonly { id: string; name: string; imageUrl?: string; typeLine?: string }[];

  /** Optional continuation context so the server can resume castSpellFromHand. */
  readonly castSpellFromHandArgs?: {
    cardId: string;
    payment?: any;
    targets?: any;
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
  };
}

/**
 * Squad cost payment step
 * Used when a spell with Squad asks how many times to pay the squad cost.
 */
export interface SquadCostPaymentStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.SQUAD_COST_PAYMENT;
  readonly cardId: string;
  readonly cardName: string;
  readonly squadCost: string;
  readonly imageUrl?: string;

  /** Optional continuation context so the server can resume castSpellFromHand. */
  readonly castSpellFromHandArgs?: {
    cardId: string;
    payment?: any;
    targets?: any;
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
  };
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
  readonly reason: 'cleanup' | 'effect' | 'activation_cost';
}

/**
 * Opening hand actions (Leylines, Chancellor effects)
 * Player may put some cards from their opening hand onto the battlefield before the game starts.
 */
export interface OpeningHandActionsStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.OPENING_HAND_ACTIONS;
  readonly leylineCount?: number;
}

/**
 * Commander zone choice resolution step
 */
export interface CommanderZoneChoiceStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.COMMANDER_ZONE_CHOICE;
  readonly commanderId: string;
  readonly commanderName: string;
  readonly fromZone: 'graveyard' | 'exile' | 'library' | 'hand';
  /** For library destination: where the commander would go if not sent to command zone */
  readonly libraryPosition?: 'top' | 'bottom' | 'shuffle';
  /** Extra metadata for exile moves (e.g., linked exile) */
  readonly exileTag?: {
    exiledWithSourceId?: string;
    exiledWithOracleId?: string;
    exiledWithSourceName?: string;
  };
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
 * Explore decision resolution step
 * Reveal top card; if not a land, choose whether to put it into graveyard or keep it on top.
 */
export interface ExploreDecisionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.EXPLORE_DECISION;
  readonly permanentId: string;
  readonly permanentName: string;
  readonly revealedCard: KnownCardRef;
  readonly isLand: boolean;
}

/**
 * Batch explore decision resolution step
 * Represents multiple explore decisions (e.g. "each creature explores").
 */
export interface BatchExploreDecisionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.BATCH_EXPLORE_DECISION;
  readonly explores: readonly {
    permanentId: string;
    permanentName: string;
    revealedCard: KnownCardRef;
    isLand: boolean;
  }[];
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
  | MutateTargetSelectionStep
  | GraveyardSelectionStep
  | FightTargetStep
  | TapUntapTargetStep
  | CounterMovementStep
  | CounterTargetStep
  | StationCreatureSelectionStep
  | ForbiddenOrchardTargetStep
  | MdfcFaceSelectionStep
  | LifePaymentStep
  | AdditionalCostPaymentStep
  | SquadCostPaymentStep
  | ModeSelectionStep
  | DiscardSelectionStep
  | OpeningHandActionsStep
  | CommanderZoneChoiceStep
  | TriggerOrderStep
  | LibrarySearchStep
  | OptionChoiceStep
  | PonderEffectStep
  | ExploreDecisionStep
  | BatchExploreDecisionStep
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
  /** Split destination assignments for Cultivate/Kodama's Reach effects */
  readonly splitAssignments?: { toBattlefield: string[]; toHand: string[] };
  /** Move destination for library search */
  readonly moveTo?: string;
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
  choiceEvent?: ChoiceEvent;
  // Type-specific fields
  [key: string]: any;
}

export default {
  ResolutionStepStatus,
  ResolutionStepType,
  STEP_TO_CHOICE_EVENT_TYPE,
};
