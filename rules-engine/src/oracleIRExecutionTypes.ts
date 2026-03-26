import type { GameState, PlayerID, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';

export interface OracleIRExecutionOptions {
  /**
   * If false (default), skips "may" steps because they require a player choice.
   * If true, applies optional steps as if the player chose "yes".
   */
  readonly allowOptional?: boolean;
  /**
   * Explicit selected mode ids for a choose_mode step when already chosen by a player.
   */
  readonly selectedModeIds?: readonly string[];
}

export interface OracleIRSelectorContext {
  /** Bound target for selectors parsed as target player. */
  readonly targetPlayerId?: PlayerID;
  /** Bound target for selectors parsed as target opponent. */
  readonly targetOpponentId?: PlayerID;
  /** Bound antecedent set for selectors parsed as "each of those opponents". */
  readonly eachOfThoseOpponents?: readonly PlayerID[];
  /** Bound chosen objects for multi-selection antecedents such as "the chosen creatures". */
  readonly chosenObjectIds?: readonly string[];
  /** Explicit chosen dungeon id for venture selection. */
  readonly chosenDungeonId?: string;
  /** Explicit chosen room id for venture branch selection. */
  readonly chosenDungeonRoomId?: string;
  /** Bound mana choice for clauses like "Add {R} or {G}." */
  readonly chosenMana?: string;
  /** Bound pay/decline choice for unless-pays-life wrappers when already known. */
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
}

export interface OracleIRExecutionEventHint {
  /** Best-effort single target player from trigger/ability resolution context. */
  readonly targetPlayerId?: PlayerID;
  /** Best-effort single target opponent from trigger/ability resolution context. */
  readonly targetOpponentId?: PlayerID;
  /** Best-effort single target permanent from trigger/ability resolution context. */
  readonly targetPermanentId?: string;
  /** Bound chosen objects for delayed/antecedent-based battlefield references. */
  readonly chosenObjectIds?: readonly string[];
  /** Explicit chosen dungeon id for venture selection. */
  readonly chosenDungeonId?: string;
  /** Explicit chosen room id for venture branch selection. */
  readonly chosenDungeonRoomId?: string;
  /** Explicit mana choice for "add {R} or {G}" style effects when already known. */
  readonly chosenMana?: string;
  /** Explicit pay/decline choice for unless-pays-life wrappers when already known. */
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
  /** Explicit choice for "tap or untap" style effects when known. */
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  /** Generic affected players for this event (may include non-opponents). */
  readonly affectedPlayerIds?: readonly PlayerID[];
  /** Affected opponents for this event (preferred for relational opponent selectors). */
  readonly affectedOpponentIds?: readonly PlayerID[];
  /** Opponents dealt damage by the triggering event/source (Breeches-style antecedent). */
  readonly opponentsDealtDamageIds?: readonly PlayerID[];
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
  /** Winning choice text for vote-result wrappers such as "carnage gets more votes". */
  readonly winningVoteChoice?: string | null;
  /** Explicit vote tallies keyed by choice text when already known from runtime context. */
  readonly voteChoiceCounts?: Readonly<Record<string, number>>;
  /** Whether a gift cost was paid / promised for gift-conditional spell text. */
  readonly giftPromised?: boolean;
}

export interface OracleIRExecutionContext {
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
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
  /** Internal runtime carry-over for nested follow-up steps that reference permanents tapped this way. */
  readonly lastTappedMatchingPermanentCount?: number;
  /** Internal runtime carry-over for clash follow-up conditionals like "If you win". */
  readonly lastClashWon?: boolean;
  /** Internal runtime carry-over for collect-evidence follow-up conditionals like "If evidence was collected". */
  readonly lastCollectedEvidence?: boolean;
  /** Internal runtime carry-over for nested follow-up steps that reference battlefield permanents moved by prior steps. */
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  /** Internal runtime carry-over for scheme effects that refer to "that scheme". */
  readonly lastSetInMotionScheme?: any;
  /** Optional direct target creature binding used by modify_pt where-X evaluation and legacy tests/callers. */
  readonly targetCreatureId?: string;
  /** Optional direct target permanent binding used by targeted effects like Merrow Reejerey. */
  readonly targetPermanentId?: string;
  /** Choice for effects worded as "tap or untap target permanent." */
  readonly tapOrUntapChoice?: 'tap' | 'untap';
  /** Choice for unless-pays-life wrappers when already known. */
  readonly unlessPaysLifeChoice?: 'pay' | 'decline';
  /** Normalized reference spell types used by some deterministic unknown-amount loops. */
  readonly referenceSpellTypes?: readonly string[];
  /** Reference spell mana value used by some deterministic unknown-amount loops. */
  readonly referenceSpellManaValue?: number;
  /** Result of a relevant coin flip when already known from runtime context. */
  readonly wonCoinFlip?: boolean;
  /** Winning vote choice when already known from runtime context. */
  readonly winningVoteChoice?: string | null;
  /** Explicit vote tallies keyed by choice text when already known from runtime context. */
  readonly voteChoiceCounts?: Readonly<Record<string, number>>;
  /** Whether a gift cost was paid / promised for gift-conditional spell text. */
  readonly giftPromised?: boolean;
  /**
   * Optional selector bindings supplied by the caller from trigger/target resolution context.
   * This allows relational selectors such as "each of those opponents" to execute
   * deterministically in multiplayer when the antecedent set is known.
   */
  readonly selectorContext?: OracleIRSelectorContext;
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
}
