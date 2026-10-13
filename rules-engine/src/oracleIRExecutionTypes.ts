import type { GameState, PlayerID, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRServerExecutionBridge } from './oracleIRServerBridge';
import type { RuntimeObjectSnapshot } from './oracleIRTransitionTypes';
import type { OracleIRPendingTransition } from './oracleIRTransitionTypes';

/** Mutable halt carrier shared between server bridge and executor main loop. */
export interface OracleIRTransitionHaltState {
  halted: boolean;
  deferred: OracleIRPendingTransition[];
}

export interface OracleIRExecutionOptions {
  /**
   * If false (default), skips "may" steps because they require a player choice.
   * If true, applies optional steps as if the player chose "yes".
   */
  readonly allowOptional?: boolean;
  /**
   * When true with allowOptional=false, optional steps are declined deterministically
   * for audit/dry-run flows (no automation gap, not counted as player choice).
   */
  readonly declineOptionalSteps?: boolean;
  /**
   * Explicit selected mode ids for a choose_mode step when already chosen by a player.
   */
  readonly selectedModeIds?: readonly string[];
  /**
   * When true, stop executing further steps after a player-choice-required gap on
   * interactive step kinds so callers can queue UI and resume the tail later.
   */
  readonly haltOnPlayerChoiceRequired?: boolean;
}

export interface OracleIRSelectorContext {
  /** Bound target for selectors parsed as target player. */
  readonly targetPlayerId?: PlayerID;
  /** Owner of the bound targeted object (may differ from controller). */
  readonly targetOwnerId?: PlayerID;
  /** Bound target for selectors parsed as target opponent. */
  readonly targetOpponentId?: PlayerID;
  /** Bound target for selectors parsed as target creature. */
  readonly targetCreatureId?: string;
  /** Bound target for selectors parsed as target permanent. */
  readonly targetPermanentId?: string;
  /** Bound target for selectors parsed as target spell. */
  readonly targetSpellId?: string;
  /** Bound antecedent set for selectors parsed as "each of those opponents". */
  readonly eachOfThoseOpponents?: readonly PlayerID[];
  /** Bound chosen objects for multi-selection antecedents such as "the chosen creatures". */
  readonly chosenObjectIds?: readonly string[];
  /** Combat trigger subject for pronouns like "that creature" in block/become-blocked effects. */
  readonly combatOpponentCreatureId?: string;
  /** Explicit chosen dungeon id for venture selection. */
  readonly chosenDungeonId?: string;
  /** Explicit chosen room id for venture branch selection. */
  readonly chosenDungeonRoomId?: string;
  /** Bound mana choice for clauses like "Add {R} or {G}." */
  readonly chosenMana?: string;
  /** Bound chosen creature type for clauses like "choose a creature type." */
  readonly chosenCreatureType?: string;
  /** Bound chosen basic land type for clauses like "basic land type of your choice." */
  readonly chosenBasicLandType?: string;
  /** Bound chosen card name for clauses like "choose a card name." */
  readonly chosenCardName?: string;
  /** Bound chosen number for clauses like "choose a number greater than 0." */
  readonly chosenNumber?: number;
  /** Bound chosen color for clauses like "choose a color." */
  readonly chosenColor?: string;
  /** Mana cost paid when an opponent chose to pay only part of a modal cost. */
  readonly unlessPaysManaAmount?: string;
  /** Bound chosen letter for clauses like "choose a letter." */
  readonly chosenLetter?: string;
  /** Bound odd/even choice for clauses like "choose odd or even." */
  readonly chosenOddEven?: 'odd' | 'even';
  /** Bound pay/decline choice for unless-pays-life wrappers when already known. */
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
  /** Bound pay/decline choice for unless-pays-mana wrappers when already known. */
  readonly unlessPaysManaChoice?: 'pay' | 'decline';
  /** Bound discard/decline choice for unless-discards wrappers when already known. */
  readonly unlessDiscardsChoice?: 'discard' | 'decline';
  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';
  /** Bound pay/decline for any-player-may tax windows when already known. */
  readonly anyPlayerMayChoice?: 'pay' | 'decline';
  /** Player who is answering / paid the any-player-may window. */
  readonly anyPlayerMayPayerId?: PlayerID;
  /** Players who already declined an any-player-may window. */
  readonly anyPlayerMayDeclinedPlayerIds?: readonly PlayerID[];
  /** Chosen permanent id when any-player-may payment is sacrifice. */
  readonly anyPlayerMaySacrificePermanentId?: string;
  /** Counters removed by the most recent remove_counter step in this execution. */
  readonly countersRemovedThisWay?: number;
  /** Whether an optional spell additional cost was paid when casting. */
  readonly optionalAdditionalCostWasPaid?: boolean;
  /** Whether a waterbend additional cost was paid when casting. */
  readonly waterbendWasPaid?: boolean;
  /** Whether a permanent entered face down under the controller's control this turn. */
  readonly faceDownPermanentEnteredThisTurnUnderYourControl?: boolean;
  /** Whether the controller turned a permanent face up this turn. */
  readonly turnedPermanentFaceUpThisTurn?: boolean;
  /** Active player for upkeep-style conditions such as Doom Foretold. */
  readonly activePlayerId?: PlayerID;
  /** Bound explore resolution for nonland reveals (true = mill to graveyard). */
  readonly exploreToGraveyard?: boolean;
  /** Player-chosen counter split for distribute-among steps keyed by permanent id. */
  readonly counterDistributionByTargetId?: Readonly<Record<string, number>>;
  /** Split-destination library search assignments (battlefield vs hand). */
  readonly splitAssignments?: {
    readonly toBattlefield?: readonly string[];
    readonly toHand?: readonly string[];
  };
  /** Player-chosen destination for X-threshold alternate move_zone paths. */
  readonly moveZoneDestination?: string;
  /** Additional runtime selector bindings carried by generic Oracle IR clauses. */
  readonly activatedAbilityIsManaAbility?: boolean;
  readonly attackingPlayerId?: PlayerID;
  readonly beheldQuality?: string;
  readonly bottomOrder?: readonly string[];
  /** 903.9a mass-shuffle: per-permanent command zone vs library. */
  readonly commanderLibraryChoices?: Readonly<Record<string, 'command' | 'library'>>;
  /** Warp World enchantment-wave Aura attach announcements keyed by card id. */
  readonly auraAttachByCardId?: Readonly<Record<string, string>>;
  /** Warp World remainder: per-owner library-bottom order of revealed leftover cards. */
  readonly libraryBottomOrderByPlayer?: Readonly<Record<string, readonly string[]>>;
  /** Krark's Thumb family: which of each differing pair to keep (`first` / `second`). */
  readonly coinIgnoreOneKeepChoices?: readonly ('first' | 'second')[];
  /** Locked raw coin results so resume does not re-roll ignore-one pairs. */
  readonly coinIgnoreOneRawFlips?: readonly ('heads' | 'tails')[];
  readonly castFromExile?: boolean;
  readonly castFromZone?: string;
  readonly chosenColors?: readonly string[];
  readonly chosenName?: string;
  readonly chosenRingBearerId?: string;
  readonly chosenSpellId?: string;
  readonly chosenType?: string;
  readonly controlledDragonAsCast?: boolean;
  readonly controlledFaerieAsCast?: boolean;
  readonly convokeCreatureType?: string;
  readonly creatureDiedThisWay?: boolean;
  readonly creatureSpellCastThisWay?: boolean;
  readonly enteredFromZone?: string;
  readonly enchantedPermanentId?: string;
  readonly freerunningCostPaid?: boolean;
  readonly highBidderPlayerId?: PlayerID;
  readonly keepTopOrder?: readonly string[];
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  readonly lastCycledCardType?: string;
  readonly lastDiscardedCardId?: string;
  readonly lastReferencedPermanentId?: string;
  readonly libraryPlacement?: string;
  readonly lifeWasPaidToActivateIt?: boolean;
  readonly manaSpentOnCreatureSpell?: boolean;
  readonly manaSpentOnDragonCreatureSpell?: boolean;
  readonly manaSpentOnNonHumanCreatureSpell?: boolean;
  readonly manaSpentToCastCommander?: boolean;
  readonly noColoredManaSpentToCast?: boolean;
  readonly noManaSpentToCast?: boolean;
  readonly otherSpellType?: string;
  readonly referenceCardName?: string;
  readonly revealedDragonAsCast?: boolean;
  readonly scryResolutionComplete?: boolean;
  readonly spellCastThisWay?: boolean;
  readonly spellManaValue?: number;
  readonly surveilResolutionComplete?: boolean;
  readonly targetCreatureControllerId?: PlayerID;
  readonly targetLandId?: string;
  readonly thatPlayerId?: PlayerID;
  readonly thoseCreatureIds?: readonly string[];
  readonly toGraveyard?: boolean;
  readonly unlessDealDamageChoice?: 'pay' | 'decline';
  readonly unlessExiledHistoricFromGraveyard?: boolean;
  readonly unlessPaysEnergyChoice?: 'pay' | 'decline';
  readonly unlessPutCardOnTopOfLibraryChoice?: 'pay' | 'decline';
  readonly unlessReturnedLandToHand?: boolean;
  readonly wasCast?: boolean;
  readonly wouldLoseTheGame?: boolean;
  readonly youDoChoice?: 'accept' | 'decline' | boolean;
}

export interface OracleIRExecutionEventHint {
  /** Whether the resolving source is a spell or an ability. */
  readonly sourceObjectType?: 'spell' | 'ability';
  /** Best-effort source spell colors for counterspell-style source-sensitive legality checks. */
  readonly sourceColors?: readonly string[];
  /** Best-effort single target player from trigger/ability resolution context. */
  readonly targetPlayerId?: PlayerID;
  /** Best-effort single target opponent from trigger/ability resolution context. */
  readonly targetOpponentId?: PlayerID;
  /** Best-effort single target spell from trigger/ability resolution context. */
  readonly targetSpellId?: string;
  /** Best-effort single target permanent from trigger/ability resolution context. */
  readonly targetPermanentId?: string;
  /** Best-effort single target creature from trigger/ability resolution context. */
  readonly targetCreatureId?: string;
  /** Bound chosen objects for delayed/antecedent-based battlefield references. */
  readonly chosenObjectIds?: readonly string[];
  /** Player-chosen destination for X-threshold alternate move_zone paths. */
  readonly moveZoneDestination?: string;
  /** Explicit chosen dungeon id for venture selection. */
  readonly chosenDungeonId?: string;
  /** Explicit chosen room id for venture branch selection. */
  readonly chosenDungeonRoomId?: string;
  /** Explicit mana choice for "add {R} or {G}" style effects when already known. */
  readonly chosenMana?: string;
  /** Explicit creature type choice when already known. */
  readonly chosenCreatureType?: string;
  /** Explicit basic land type choice when already known. */
  readonly chosenBasicLandType?: string;
  /** Explicit card-name choice when already known. */
  readonly chosenCardName?: string;
  /** Explicit numeric choice when already known. */
  readonly chosenNumber?: number;
  /** Explicit color choice when already known. */
  readonly chosenColor?: string;
  /** Mana amount paid for partial unless/may-pay branches when already known. */
  readonly unlessPaysManaAmount?: string;
  /** Explicit letter choice when already known. */
  readonly chosenLetter?: string;
  /** Explicit odd/even choice when already known. */
  readonly chosenOddEven?: 'odd' | 'even';
  /** Explicit pay/decline choice for unless-pays-life wrappers when already known. */
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
  /** Explicit pay/decline choice for unless-pays-mana wrappers when already known. */
  readonly unlessPaysManaChoice?: 'pay' | 'decline';
  /** Explicit discard/decline choice for unless-discards wrappers when already known. */
  readonly unlessDiscardsChoice?: 'discard' | 'decline';
  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';
  /** Explicit choice for "tap or untap" style effects when known. */
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  /** Generic affected players for this event (may include non-opponents). */
  readonly affectedPlayerIds?: readonly PlayerID[];
  /** Affected opponents for this event (preferred for relational opponent selectors). */
  readonly affectedOpponentIds?: readonly PlayerID[];
  /** Opponents dealt damage by the triggering event/source (Breeches-style antecedent). */
  readonly opponentsDealtDamageIds?: readonly PlayerID[];
  /** Numeric amount referenced by text like "that much" when the triggering event defines it. */
  readonly referenceAmount?: number;
  /** Greatest per-player discard count from the immediately preceding discard-this-way step. */
  readonly lastGreatestDiscardedCardCount?: number;
  /** Spell type context used by some exile-until templates (for example, Possibility Storm). */
  readonly spellType?: string;
  /** Number of spells the triggering player has cast this turn when relevant. */
  readonly spellCastCountThisTurn?: number;
  /** Number of noncreature spells the triggering player has cast this turn when relevant. */
  readonly noncreatureSpellCastCountThisTurn?: number;
  /** Spell mana value context used by some exile-until templates (for example, Cascade). */
  readonly spellManaValue?: number;
  /** Source provenance for the resolving object when known. */
  readonly castFromZone?: string;
  /** Source provenance for the resolving object when known. */
  readonly enteredFromZone?: string;
  /** Result of a relevant coin flip when the wrapper condition depends on it. */
  readonly wonCoinFlip?: boolean;
  /** Wins from the immediately preceding multi-coin flip ("this way"). */
  readonly coinFlipWinsThisWay?: number;
  /** Losses from the immediately preceding multi-coin flip ("this way"). */
  readonly coinFlipLossesThisWay?: number;
  /** Winning choice text for vote-result wrappers such as "carnage gets more votes". */
  readonly winningVoteChoice?: string | null;
  /** Explicit vote tallies keyed by choice text when already known from runtime context. */
  readonly voteChoiceCounts?: Readonly<Record<string, number>>;
  /** Whether a gift cost was paid / promised for gift-conditional spell text. */
  readonly giftPromised?: boolean;
  /** Whether a Teamwork additional cost was paid when casting this spell. */
  readonly teamworkWasPaid?: boolean;
  /** Whether the resolving source was kicked (cast with kicker). */
  readonly wasKicked?: boolean;
  /** Whether the resolving spell was bargained (its bargain additional cost was paid). */
  readonly wasBargained?: boolean;
  /** Whether a library search step applied during this resolution. */
  readonly searchedLibraryThisWay?: boolean;
  readonly lastMilledCards?: readonly any[];
  /** How many times this ability has resolved this turn when known. */
  readonly abilityResolveCountThisTurn?: number;
}

export type OracleIRStepOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
};

export interface OracleIRExecutionContext extends OracleIRSelectorContext {
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  /** Explicit X value for resolving X/X or similar effects when already known. */
  readonly xValue?: number;
  /** Mana spent to cast the resolving source when the popped stack item is no longer findable. */
  readonly sourceManaSpentTotal?: number;
  /** Keywords granted to a resolving spell after it left the stack ("that spell gains deathtouch"). */
  readonly sourceGrantedAbilities?: readonly string[];
  /** Whether the resolving source is a spell or an ability. */
  readonly sourceObjectType?: 'spell' | 'ability';
  /** Colors of the resolving source spell when relevant to source-sensitive checks. */
  readonly sourceColors?: readonly string[];
  /** Deterministic die-roll override for tests or pre-resolved event context. */
  readonly dieRollResult?: number;
  /** Source provenance for the resolving object when known. */
  readonly castFromZone?: string;
  /** Source provenance for the resolving object when known. */
  readonly enteredFromZone?: string;
  /** Parent spell steps available for nested copy-this-spell instructions. */
  readonly copyReplaySteps?: readonly OracleEffectStep[];
  /** Internal runtime carry-over for nested conditional follow-up steps that modify exiled cards. */
  readonly lastExiledCards?: readonly any[];
  /** Internal runtime carry-over for nested follow-up steps that reference cards moved by prior steps. */
  readonly lastMovedCards?: readonly any[];
  /** Internal runtime carry-over for nested follow-up steps that reference cards discarded by prior steps. */
  readonly lastDiscardedCards?: readonly any[];
  readonly lastDiscardedCardId?: string;
  readonly lastRevealedCards?: readonly any[];
  readonly lastRevealedCardCount?: number;
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastGreatestDiscardedCardCount?: number;
  readonly lastCreatedTokenIds?: readonly string[];
  readonly movedBattlefieldPermanentIds?: readonly string[];
  readonly lastDamagePreventedThisWay?: number;
  readonly lastReferenceAmount?: number;
  /** Per-player reference amounts for multiplayer effects (e.g. Warp World's "that many" per player). */
  readonly lastMovedCountByPlayer?: Readonly<Record<string, number>>;
  readonly lastChosenCardName?: string;
  /** Internal runtime carry-over for nested follow-up steps that reference permanents tapped this way. */
  readonly lastTappedMatchingPermanentCount?: number;
  /** Internal runtime carry-over for clash follow-up conditionals like "If you win". */
  readonly lastClashWon?: boolean;
  /** Internal runtime carry-over for collect-evidence follow-up conditionals like "If evidence was collected". */
  readonly lastCollectedEvidence?: boolean;
  /** Internal runtime carry-over for nested follow-up steps that reference battlefield permanents moved by prior steps. */
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  /** Internal runtime carry-over for "creatures dealt damage this way" follow-ups. */
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
  /** Internal runtime carry-over for goad follow-ups that reference "those creatures". */
  readonly lastGoadedBattlefieldPermanentIds?: readonly string[];
  /** Battlefield permanents matched by the most recent "for each" / count antecedent (e.g. Inspiring Call draw). */
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  /** Internal runtime carry-over for top-of-library references like "it" after a look/reveal-top step. */
  readonly lastTopLibraryOwnerId?: PlayerID;
  /** Internal runtime carry-over for scheme effects that refer to "that scheme". */
  readonly lastSetInMotionScheme?: any;
  /** Optional direct target creature binding used by modify_pt where-X evaluation and legacy tests/callers. */
  readonly targetCreatureId?: string;
  /** Optional direct target permanent binding used by targeted effects like Merrow Reejerey. */
  readonly targetPermanentId?: string;
  /** Most recent non-source permanent referenced by gain-control style steps in this resolution. */
  readonly lastReferencedPermanentId?: string;
  /** Optional direct target spell binding used by stack-targeted effects like counterspells. */
  readonly targetSpellId?: string;
  /** Choice for effects worded as "tap or untap target permanent." */
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  /** Choice for unless-pays-life wrappers when already known. */
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
  /** Choice for unless-pays-mana wrappers when already known. */
  readonly unlessPaysManaChoice?: 'pay' | 'decline';
  /** Choice for unless-discards wrappers when already known. */
  readonly unlessDiscardsChoice?: 'discard' | 'decline';
  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';
  /** Normalized reference spell types used by some deterministic unknown-amount loops. */
  readonly referenceSpellTypes?: readonly string[];
  /** Reference spell mana value used by some deterministic unknown-amount loops. */
  readonly referenceSpellManaValue?: number;
  /** Result of a relevant coin flip when already known from runtime context. */
  readonly wonCoinFlip?: boolean;
  /** Wins from the immediately preceding multi-coin flip ("this way"). */
  readonly coinFlipWinsThisWay?: number;
  /** Losses from the immediately preceding multi-coin flip ("this way"). */
  readonly coinFlipLossesThisWay?: number;
  /** Winning vote choice when already known from runtime context. */
  readonly winningVoteChoice?: string | null;
  /** Numeric amount referenced by text like "that much" from trigger data or prior steps. */
  readonly referenceAmount?: number;
  readonly referenceCardName?: string;
  readonly referencedCardName?: string;
  readonly referencedPlayerId?: PlayerID;
  readonly targetCardName?: string;
  readonly otherSpellType?: string;
  readonly presentVoteCount?: number;
  readonly energyPaidThisWay?: number;
  readonly lifePaidThisWay?: number;
  readonly tributePaid?: boolean;
  /** Number of spells the triggering player has cast this turn when relevant. */
  readonly spellCastCountThisTurn?: number;
  /** Number of noncreature spells the triggering player has cast this turn when relevant. */
  readonly noncreatureSpellCastCountThisTurn?: number;
  /** Explicit vote tallies keyed by choice text when already known from runtime context. */
  readonly voteChoiceCounts?: Readonly<Record<string, number>>;
  /** Whether a gift cost was paid / promised for gift-conditional spell text. */
  readonly giftPromised?: boolean;
  /** Whether a Teamwork additional cost was paid when casting this spell. */
  readonly teamworkWasPaid?: boolean;
  /** Whether the resolving source was kicked (cast with kicker). */
  readonly wasKicked?: boolean;
  /** Whether the resolving spell was bargained (its bargain additional cost was paid). */
  readonly wasBargained?: boolean;
  /** Whether an optional spell additional cost (e.g. waterbend) was paid when casting. */
  readonly optionalAdditionalCostWasPaid?: boolean;
  /** Whether the activated ability being copied/triggered is a mana ability. */
  readonly activatedAbilityIsManaAbility?: boolean;
  /** Whether a spell was cast via an alternate "this way" permission in the same resolution. */
  readonly spellCastThisWay?: boolean;
  /** Whether a creature spell was cast via an alternate "this way" permission in the same resolution. */
  readonly creatureSpellCastThisWay?: boolean;
  /** Whether mana from the resolving ability was spent to cast a creature spell. */
  readonly manaSpentOnCreatureSpell?: boolean;
  /** Whether the referenced spell was cast without paying mana. */
  readonly noManaSpentToCast?: boolean;
  /** Whether the controller would lose the game from the current event (replacement check). */
  readonly wouldLoseTheGame?: boolean;
  /** Quality satisfied by the most recent behold action in this resolution (e.g. dragon). */
  readonly beheldQuality?: string;
  /** Whether a Dragon card was revealed while casting the resolving spell. */
  readonly revealedDragonAsCast?: boolean;
  /** Whether a Dragon was controlled while casting the resolving spell. */
  readonly controlledDragonAsCast?: boolean;
  /** Whether the referenced creature died from the immediately preceding destroy/damage step. */
  readonly creatureDiedThisWay?: boolean;
  /** Whether the resolving permanent entered the battlefield because it was cast. */
  readonly wasCast?: boolean;
  /** Permanent id chosen as Ring-bearer when the Ring last tempted the controller. */
  readonly chosenRingBearerId?: string;
  /** Alias for optional spell additional costs such as waterbend. */
  readonly waterbendWasPaid?: boolean;
  /** Whether an alternate "rather than pay this spell's mana cost" cost was paid. */
  readonly alternateCostPaid?: boolean;
  /** Whether a permanent entered face down under the controller's control this turn. */
  readonly faceDownPermanentEnteredThisTurnUnderYourControl?: boolean;
  /** Whether the controller turned a permanent face up this turn. */
  readonly turnedPermanentFaceUpThisTurn?: boolean;
  /** Whether a library search step applied during this resolution. */
  readonly searchedLibraryThisWay?: boolean;
  /** Cards milled by the most recent mill step in this resolution. */
  readonly lastMilledCards?: readonly any[];
  /** How many times this ability has resolved this turn when known. */
  readonly abilityResolveCountThisTurn?: number;
  /**
   * Optional selector bindings supplied by the caller from trigger/target resolution context.
   * This allows relational selectors such as "each of those opponents" to execute
   * deterministically in multiplayer when the antecedent set is known.
   */
  readonly selectorContext?: OracleIRSelectorContext;
  /**
   * When true, choice-requiring library steps queue UI instead of auto-binding.
   * Set by server-side Oracle IR execution; dry-run/audit callers leave this unset.
   */
  readonly interactivePlayerChoices?: boolean;
  /**
   * When true, optional look_choose_from_top steps queue LIBRARY_SEARCH instead of auto-applying.
   * Set when the server has a live socket (io) and can prompt; unit tests leave this false.
   */
  readonly deferOptionalLookChoices?: boolean;
  readonly deferOptionalGrantGraveyardChoices?: boolean;
  /** Optional per-player effects (counters, land play, Hypergenesis, etc.) defer to server prompts. */
  readonly deferOptionalPerPlayerChoices?: boolean;
  /**
   * When true, stack-target `copy_spell` steps defer to the server bridge instead of
   * inline replay (push copied spells onto the stack + optional retarget prompts).
   */
  readonly deferStackSpellCopiesToServer?: boolean;
  /**
   * Live legal-target list for random `change_target` when the stack item has no
   * `copyRetargetValidTargets` stamp (Grip of Chaos / Chef's Kiss).
   */
  readonly collectLegalRetargetCandidates?: (
    state: GameState,
    spell: any,
    targetingPlayerId: string,
  ) => ReadonlyArray<{ id: string; type?: string; name?: string }>;
  /**
   * Server-computed current power/toughness of a battlefield permanent (base/set P/T, P/T
   * counters, anthems, equipment, until-end-of-turn pumps): the numbers the battlefield shows.
   * Fight, bite and "damage equal to its power" read it via readCurrentPower; dry-run callers
   * omit it and fall back to the rules-engine static-ability pass.
   */
  readonly resolveCurrentPowerToughness?: (
    state: GameState,
    permanent: any,
  ) => { readonly power: number; readonly toughness: number } | null | undefined;
  /**
   * Step-indexed memory: traits of objects affected by each prior step in this resolution.
   * Populated by transition commit or interim recordCardsToStepLedger bridge.
   */
  readonly stepLedger?: ReadonlyMap<number, readonly RuntimeObjectSnapshot[]>;
  /** Set by the main loop during step execution. */
  readonly currentStepIndex?: number;
  /** Tracks which step kinds were applied at each index (antecedent lookup). */
  readonly appliedStepKinds?: ReadonlyMap<number, string>;
  /** Server pre-commit pipeline; omitted in dry-run/audit callers. */
  readonly serverBridge?: OracleIRServerExecutionBridge;
  /** Mutable halt state for deferred replacement choices (server only). */
  readonly transitionHaltState?: OracleIRTransitionHaltState;
  /**
   * Permanent ids whose counter placement already went through applyCounterModifications
   * (Hardened Scales, Doubling Season, ...) in this execution. The server's post-IR
   * counter sync must not apply those modifiers a second time.
   */
  readonly counterModifiersAppliedTo?: Set<string>;
}

export interface OracleIRExecutionResult {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly appliedSteps: readonly OracleEffectStep[];
  readonly skippedSteps: readonly OracleEffectStep[];
  /**
   * Structured automation gaps recorded while executing these steps. These are
   * also appended to `state.oracleAutomationGaps` with a capped history.
   */
  readonly automationGaps: readonly OracleAutomationGap[];
  /**
   * Steps that have `optional: true` ("you may") OR are `choose_mode` steps
   * that were NOT auto-applied because they require player interaction.
   * When `allowOptional` is false (the default), every such step is placed
   * here so callers can queue the appropriate player prompts.
   */
  readonly pendingOptionalSteps: readonly OracleEffectStep[];
  /**
   * Remaining steps not executed because execution halted on a player-choice gap.
   * Only populated when `haltOnPlayerChoiceRequired` is enabled.
   */
  readonly pendingContinuationSteps?: readonly OracleEffectStep[];
  /** Outcome of the final executed step in this invocation (including nested branches). */
  readonly lastStepOutcome?: OracleIRStepOutcome | null;
  /** Step carry-over for chained selectors (e.g. reveal_top → move_zone "those cards"). */
  readonly lastMovedCards?: readonly any[];
  readonly lastMilledCards?: readonly any[];
  /** Last-known snapshots of permanents sacrificed during this execution ("the sacrificed creature's power"). */
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastRevealedCardCount?: number;
  /** Per-player "that many" amounts (Warp World) when a later prompt resumes after shuffle. */
  readonly lastMovedCountByPlayer?: Readonly<Record<string, number>>;
  /** Structured replay events for server persistence after effect-program IR runs. */
  readonly replayMutations?: readonly import('./oracleIRReplayMutations').OracleIRReplayMutation[];
}
