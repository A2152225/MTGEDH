import type { PlayerID } from '../../shared/src';

/** Snapshot of a card or permanent recorded by an earlier step ("the creatures destroyed this way"). */
export type OracleIRConditionObjectSnapshot = Readonly<Record<string, unknown>>;

/**
 * Resolution facts the conditional-clause evaluators read straight off the execution context
 * ("if mana from a Treasure was spent", "if you won the bidding", "if a 6 was rolled").
 * Callers that already know the answer (server resolution, tests) pass it here; when a field is
 * absent the evaluator falls back to state inspection or reports the clause as undecidable.
 * Type-only: declaring them documents the inputs the executor already consumes.
 */
export interface OracleIRConditionContextFacts {
  readonly anotherPartyClassEnteredThisTurn?: boolean;
  readonly anyPlayerPaidTwo?: boolean;
  readonly artifactOrCreatureSpellCounteredThisWay?: boolean;
  readonly atLeastSevenManaSpentToCast?: boolean;
  readonly atLeastSevenRedManaSpentToCast?: boolean;
  readonly blackDamagePreventedThisWay?: boolean;
  readonly blueManaSpentToCastThisSpell?: boolean;
  readonly castAnotherInstantOrSorceryThisTurn?: boolean;
  readonly castDuringMainPhase?: boolean;
  readonly castFromHand?: boolean;
  readonly castUsingWebSlinging?: boolean;
  readonly colorlessManaSpentToCast?: number;
  readonly colorlessManaWasNotSpentToCast?: boolean;
  readonly creatureDamagePreventedThisWay?: boolean;
  readonly creatureDealtDamageThisWay?: boolean;
  readonly damageIncludedWarriorSource?: boolean;
  readonly damageSourcePermanentIds?: readonly string[];
  readonly delveExiledFlyingCreature?: boolean;
  readonly didNotPutExiledCardOntoBattlefield?: boolean;
  readonly didNotPutRevealedCardOntoBattlefieldThisWay?: boolean;
  readonly discardedItThisTurn?: boolean;
  readonly draftRemovedFlyingCreatureWithSameName?: boolean;
  readonly eachOpponentChoseSilence?: boolean;
  readonly eachOpponentChoseSnitch?: boolean;
  readonly enteredFromGraveyard?: boolean;
  readonly entersAsCreature?: boolean;
  readonly equippedCreatureDidNotDealCombatDamageToCreatureThisTurn?: boolean;
  readonly firstTimePlusOneCountersPutOnThatPermanentThisTurn?: boolean;
  readonly greenManaSpentToCastThisSpell?: boolean;
  readonly guessedCorrectlyForCardNamedThisPermanent?: boolean;
  readonly hasNotPlayedIt?: boolean;
  readonly isDefendingPlayer?: boolean;
  readonly isFirstSpellCastThisGame?: boolean;
  readonly itDied?: boolean;
  readonly lastGuessCorrect?: boolean;
  readonly madnessCostWasPaid?: boolean;
  readonly manaFromTreasureSpent?: boolean;
  readonly manaSpentOnMulticoloredCreatureSpell?: boolean;
  readonly noCreatureGotVotes?: boolean;
  readonly noncreatureDamagePreventedThisWay?: boolean;
  readonly noneWereCast?: boolean;
  readonly opponentProtectsIt?: boolean;
  readonly opponentRevealedExactChosenColorCount?: boolean;
  readonly permanentsSacrificedToActivateAbility?: boolean;
  readonly revealedCardMatchesChosenType?: boolean;
  readonly sacrificedPermanentWasCommander?: boolean;
  readonly spellTargetsCommanderYouControl?: boolean;
  readonly targetWasDealtNoncombatDamageThisTurn?: boolean;
  readonly theyAreNotAttackingYou?: boolean;
  readonly wasNotCastThisWay?: boolean;
  readonly wasNotPutOntoBattlefieldWithThisAbility?: boolean;
  readonly wonBidding?: boolean;
  readonly youSacrificedPermanentThisWay?: boolean;
  readonly coinFlipsWonThisResolution?: number;
  readonly lastDieRollResult?: number;
  readonly lastDiscoveredCardManaValue?: number;
  readonly lastExcessDamageDealtThisWay?: number;
  readonly manaSpentToCastIt?: number;
  readonly manaSpentToCastTargetSpell?: number;
  readonly stationedCreaturePower?: number;
  readonly abilityId?: string;
  readonly itCreatureId?: string;
  readonly lastCoinFlipResult?: string;
  readonly paidAlternateCostRaw?: string;
  readonly secondTargetPermanentId?: string;
  readonly thisCreatureId?: string;
  readonly defendingPlayerId?: PlayerID;
  readonly colorsOfManaSpentToActivate?: readonly string[];
  readonly lastTappedMatchingPermanentIds?: readonly string[];
  /** Vote tallies ("each player votes ..."): choice -> number of votes. */
  readonly lastVoteResults?: Readonly<Record<string, number>>;
  readonly lastDamagedCards?: readonly OracleIRConditionObjectSnapshot[];
  readonly lastCreaturesDiedThisWay?: readonly OracleIRConditionObjectSnapshot[];
  readonly lastDestroyedCreatures?: readonly OracleIRConditionObjectSnapshot[];
  /** The resolving stack item when the caller has it (targets, description, alternate cost). */
  readonly stackItem?: OracleIRConditionObjectSnapshot;
}
