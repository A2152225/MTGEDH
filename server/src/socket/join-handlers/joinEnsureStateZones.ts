// server/src/socket/join-handlers/joinEnsureStateZones.ts
// Origin parent: server/src/socket/join.ts
// Cluster moved: defaultPlayerZones, ensureStateZonesForPlayers.
// Public entry symbols: defaultPlayerZones, ensureStateZonesForPlayers.

import { debugWarn } from "../../utils/debug.js";

export function defaultPlayerZones() {
  return {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}


/**
 * Ensure the authoritative in-memory game.state.zones has entries for all players
 * This prevents other modules from reading undefined for zones[playerId].
 */
export function ensureStateZonesForPlayers(game: any) {
  try {
    if (!game) return;
    game.state = (game.state || {}) as any;
    game.state.players = game.state.players || [];
    game.state.zones = game.state.zones || {};
    for (const p of game.state.players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      if (!game.state.zones[pid]) game.state.zones[pid] = defaultPlayerZones();
      else {
        // ensure counts/arrays exist
        const z = game.state.zones[pid];
        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.handCount =
          typeof z.handCount === "number"
            ? z.handCount
            : Array.isArray(z.hand)
            ? z.hand.length
            : 0;
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount =
          typeof z.libraryCount === "number"
            ? z.libraryCount
            : Array.isArray(z.library)
            ? z.library.length
            : 0;
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount =
          typeof z.graveyardCount === "number"
            ? z.graveyardCount
            : Array.isArray(z.graveyard)
            ? z.graveyard.length
            : 0;
      }
    }

    // Intervening-if baseline trackers: make per-player entries exist early
    // so templates can return deterministic false/0 instead of null before the first turn transition.
    const stateAny = game.state as any;

    // Ensure per-turn map containers exist (older saved games may be missing these).
    stateAny.landsPlayedThisTurn = stateAny.landsPlayedThisTurn || {};
    stateAny.landsEnteredBattlefieldThisTurn = stateAny.landsEnteredBattlefieldThisTurn || {};
    stateAny.nonlandPermanentsEnteredBattlefieldThisTurn = stateAny.nonlandPermanentsEnteredBattlefieldThisTurn || {};
    stateAny.creaturesEnteredBattlefieldThisTurnByController = stateAny.creaturesEnteredBattlefieldThisTurnByController || {};
    stateAny.creaturesEnteredBattlefieldThisTurnByControllerSubtype = stateAny.creaturesEnteredBattlefieldThisTurnByControllerSubtype || {};
    stateAny.creaturesEnteredBattlefieldThisTurnIdsByController = stateAny.creaturesEnteredBattlefieldThisTurnIdsByController || {};
    stateAny.faceDownCreaturesEnteredBattlefieldThisTurnByController = stateAny.faceDownCreaturesEnteredBattlefieldThisTurnByController || {};
    stateAny.artifactsEnteredBattlefieldThisTurnByController = stateAny.artifactsEnteredBattlefieldThisTurnByController || {};
    stateAny.artifactsEnteredBattlefieldThisTurnIdsByController = stateAny.artifactsEnteredBattlefieldThisTurnIdsByController || {};
    stateAny.enchantmentsEnteredBattlefieldThisTurnByController = stateAny.enchantmentsEnteredBattlefieldThisTurnByController || {};
    stateAny.enchantmentsEnteredBattlefieldThisTurnIdsByController = stateAny.enchantmentsEnteredBattlefieldThisTurnIdsByController || {};
    stateAny.planeswalkersEnteredBattlefieldThisTurnByController = stateAny.planeswalkersEnteredBattlefieldThisTurnByController || {};
    stateAny.planeswalkersEnteredBattlefieldThisTurnIdsByController = stateAny.planeswalkersEnteredBattlefieldThisTurnIdsByController || {};
    stateAny.battlesEnteredBattlefieldThisTurnByController = stateAny.battlesEnteredBattlefieldThisTurnByController || {};
    stateAny.battlesEnteredBattlefieldThisTurnIdsByController = stateAny.battlesEnteredBattlefieldThisTurnIdsByController || {};
    stateAny.creaturesDiedThisTurnByController = stateAny.creaturesDiedThisTurnByController || {};
    stateAny.creaturesDiedThisTurnByControllerSubtype = stateAny.creaturesDiedThisTurnByControllerSubtype || {};
    stateAny.creaturesDiedThisTurnIds = Array.isArray(stateAny.creaturesDiedThisTurnIds) ? stateAny.creaturesDiedThisTurnIds : [];

    // Per-turn numeric/boolean trackers used by intervening-if evaluation.
    stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
    stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
    stateAny.cardsDrawnThisTurn = stateAny.cardsDrawnThisTurn || {};
    stateAny.spellsCastThisTurn = Array.isArray(stateAny.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];
    stateAny.playersWhoSearchedOwnLibraryThisTurn = Array.isArray(stateAny.playersWhoSearchedOwnLibraryThisTurn)
      ? stateAny.playersWhoSearchedOwnLibraryThisTurn
      : [];
    stateAny.spellsCastFromHandThisTurn = stateAny.spellsCastFromHandThisTurn || {};
    stateAny.noncreatureSpellsCastThisTurn = stateAny.noncreatureSpellsCastThisTurn || {};
    stateAny.damageTakenThisTurnByPlayer = stateAny.damageTakenThisTurnByPlayer || {};
    stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
    if (typeof stateAny.anyPlayerDiscardedCardThisTurn !== 'boolean') stateAny.anyPlayerDiscardedCardThisTurn = false;
    stateAny.dieRollsThisTurn = stateAny.dieRollsThisTurn || {};
    stateAny.countersPutThisTurnByPermanentId = stateAny.countersPutThisTurnByPermanentId || {};
    stateAny.plusOneCountersPutThisTurnByPermanentId = stateAny.plusOneCountersPutThisTurnByPermanentId || {};
    stateAny.creaturesThatDealtDamageToPlayer = stateAny.creaturesThatDealtDamageToPlayer || {};
    stateAny.linkedExiles = Array.isArray(stateAny.linkedExiles) ? stateAny.linkedExiles : [];

    // Newer per-turn trackers used by recognized templates.
    stateAny.spellWasWarpedThisTurn = stateAny.spellWasWarpedThisTurn || {};
    stateAny.evidenceCollectedThisTurn = stateAny.evidenceCollectedThisTurn || {};
    stateAny.evidenceCollectedThisTurnByPlayer = stateAny.evidenceCollectedThisTurnByPlayer || {};
    stateAny.evidenceCollectedThisTurnByPlayerCounts = stateAny.evidenceCollectedThisTurnByPlayerCounts || {};
    stateAny.cardsPutIntoYourGraveyardThisTurn = stateAny.cardsPutIntoYourGraveyardThisTurn || {};
    stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn = stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn || {};
    stateAny.creatureCardPutIntoYourGraveyardThisTurn = stateAny.creatureCardPutIntoYourGraveyardThisTurn || {};
    stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn = stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn || {};
    stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn = stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn || {};
    if (typeof stateAny.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn !== 'boolean') {
      stateAny.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = false;
    }
    stateAny.permanentPutIntoHandFromBattlefieldThisTurn = stateAny.permanentPutIntoHandFromBattlefieldThisTurn || {};
    stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
    stateAny.attackedByAssassinThisTurnByPlayer = stateAny.attackedByAssassinThisTurnByPlayer || {};
    stateAny.putCounterOnPermanentThisTurnByPermanentId = stateAny.putCounterOnPermanentThisTurnByPermanentId || {};

    // Per-turn trackers that are reset with deterministic defaults in nextTurn.
    stateAny.playedCardFromExileThisTurn = stateAny.playedCardFromExileThisTurn || {};
    stateAny.playedFromExileThisTurn = stateAny.playedFromExileThisTurn || {};
    stateAny.cardsPlayedFromExileThisTurn = stateAny.cardsPlayedFromExileThisTurn || {};
    stateAny.castFromExileThisTurn = stateAny.castFromExileThisTurn || {};
    stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
    stateAny.playedLandFromGraveyardThisTurn = stateAny.playedLandFromGraveyardThisTurn || {};
    stateAny.playedLandFromExileThisTurn = stateAny.playedLandFromExileThisTurn || {};
    stateAny.completedDungeonThisTurn = stateAny.completedDungeonThisTurn || {};
    stateAny.dungeonCompletedThisTurn = stateAny.dungeonCompletedThisTurn || {};
    stateAny.cycleCountThisTurn = stateAny.cycleCountThisTurn || {};
    stateAny.cardsCycledThisTurn = stateAny.cardsCycledThisTurn || {};
    stateAny.cycledCardsThisTurn = stateAny.cycledCardsThisTurn || {};
    stateAny.committedCrimeThisTurn = stateAny.committedCrimeThisTurn || {};
    stateAny.crimeCommittedThisTurn = stateAny.crimeCommittedThisTurn || {};
    stateAny.hasCommittedCrimeThisTurn = stateAny.hasCommittedCrimeThisTurn || {};
    stateAny.tokensCreatedThisTurn = stateAny.tokensCreatedThisTurn || {};
    stateAny.tokenCreatedThisTurn = stateAny.tokenCreatedThisTurn || {};
    stateAny.createdTokenThisTurn = stateAny.createdTokenThisTurn || {};
    stateAny.sacrificedCluesThisTurn = stateAny.sacrificedCluesThisTurn || {};
    stateAny.cluesSacrificedThisTurn = stateAny.cluesSacrificedThisTurn || {};
    stateAny.cluesSacrificedThisTurnCount = stateAny.cluesSacrificedThisTurnCount || {};
    stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
    stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
    stateAny.putCounterOnCreatureThisTurn = stateAny.putCounterOnCreatureThisTurn || {};
    stateAny.placedCounterOnCreatureThisTurn = stateAny.placedCounterOnCreatureThisTurn || {};
    stateAny.countersPlacedOnCreaturesThisTurn = stateAny.countersPlacedOnCreaturesThisTurn || {};
    stateAny.putPlusOneCounterOnPermanentThisTurn = stateAny.putPlusOneCounterOnPermanentThisTurn || {};
    stateAny.placedPlusOneCounterOnPermanentThisTurn = stateAny.placedPlusOneCounterOnPermanentThisTurn || {};
    stateAny.plusOneCounterPlacedOnPermanentThisTurn = stateAny.plusOneCounterPlacedOnPermanentThisTurn || {};
    stateAny.cardLeftGraveyardThisTurn = stateAny.cardLeftGraveyardThisTurn || {};
    stateAny.cardsLeftGraveyardThisTurn = stateAny.cardsLeftGraveyardThisTurn || {};
    stateAny.leftGraveyardThisTurn = stateAny.leftGraveyardThisTurn || {};
    stateAny.creatureCardLeftGraveyardThisTurn = stateAny.creatureCardLeftGraveyardThisTurn || {};
    stateAny.creatureCardsLeftGraveyardThisTurn = stateAny.creatureCardsLeftGraveyardThisTurn || {};
    stateAny.cardLeftYourGraveyardThisTurn = stateAny.cardLeftYourGraveyardThisTurn || {};
    stateAny.creatureCardLeftYourGraveyardThisTurn = stateAny.creatureCardLeftYourGraveyardThisTurn || {};

    stateAny.tookCombatDamageSinceLastTurn = stateAny.tookCombatDamageSinceLastTurn || {};
    stateAny.combatDamageDealtToPlayerSinceLastTurn = stateAny.combatDamageDealtToPlayerSinceLastTurn || {};
    stateAny.descendedThisTurn = stateAny.descendedThisTurn || {};
    stateAny.permanentLeftBattlefieldThisTurn = stateAny.permanentLeftBattlefieldThisTurn || {};
    stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};

    // Combat trackers used by recognized intervening-if templates.
    stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};
    stateAny.attackedOrBlockedThisCombatByPermanentId = stateAny.attackedOrBlockedThisCombatByPermanentId || {};
    stateAny.attackersDeclaredThisCombatByPlayer = stateAny.attackersDeclaredThisCombatByPlayer || {};
    stateAny.blockersDeclaredThisCombatByPlayer = stateAny.blockersDeclaredThisCombatByPlayer || {};

    stateAny.attackedPlayersLastTurnByPlayer = stateAny.attackedPlayersLastTurnByPlayer || {};
    stateAny.attackedYouLastTurnByPlayer = stateAny.attackedYouLastTurnByPlayer || {};
    stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts = stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts || {};
    stateAny.creaturesEnteredBattlefieldLastTurnByController = stateAny.creaturesEnteredBattlefieldLastTurnByController || {};
    if (typeof stateAny.spellsCastLastTurnCount !== 'number') stateAny.spellsCastLastTurnCount = 0;
    if (stateAny.spellsCastLastTurnByPlayerCounts === undefined) stateAny.spellsCastLastTurnByPlayerCounts = {};
    stateAny.lifeLostLastTurnByPlayerCounts = stateAny.lifeLostLastTurnByPlayerCounts || {};
    stateAny.lifeLostLastTurnByPlayer = stateAny.lifeLostLastTurnByPlayer || {};
    stateAny.lifeLostLastTurn = stateAny.lifeLostLastTurn || {};

    stateAny.monarchAtTurnBeginByPlayer = stateAny.monarchAtTurnBeginByPlayer || {};
    stateAny.wasMonarchAtTurnBegin = stateAny.wasMonarchAtTurnBegin || {};
    stateAny.monarchAtTurnBegan = stateAny.monarchAtTurnBegan || {};
    if (typeof stateAny.dayNightChangedThisTurn !== 'boolean') stateAny.dayNightChangedThisTurn = false;

    for (const p of stateAny.players as any[]) {
      const pid = String(p?.id ?? p?.playerId ?? '').trim();
      if (!pid) continue;

      if (typeof stateAny.tookCombatDamageSinceLastTurn[pid] !== 'boolean') stateAny.tookCombatDamageSinceLastTurn[pid] = false;
      if (typeof stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] !== 'boolean') stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] = false;
      if (typeof stateAny.completedDungeonThisTurn[pid] !== 'boolean') stateAny.completedDungeonThisTurn[pid] = false;
      if (typeof stateAny.dungeonCompletedThisTurn[pid] !== 'boolean') stateAny.dungeonCompletedThisTurn[pid] = false;
      if (typeof stateAny.cycleCountThisTurn[pid] !== 'number') stateAny.cycleCountThisTurn[pid] = 0;
      if (typeof stateAny.cardsCycledThisTurn[pid] !== 'number') stateAny.cardsCycledThisTurn[pid] = 0;
      if (typeof stateAny.cycledCardsThisTurn[pid] !== 'number') stateAny.cycledCardsThisTurn[pid] = 0;
      if (typeof stateAny.committedCrimeThisTurn[pid] !== 'boolean') stateAny.committedCrimeThisTurn[pid] = false;
      if (typeof stateAny.crimeCommittedThisTurn[pid] !== 'boolean') stateAny.crimeCommittedThisTurn[pid] = false;
      if (typeof stateAny.hasCommittedCrimeThisTurn[pid] !== 'boolean') stateAny.hasCommittedCrimeThisTurn[pid] = false;
      if (typeof stateAny.monarchAtTurnBeginByPlayer[pid] !== 'boolean') stateAny.monarchAtTurnBeginByPlayer[pid] = false;
      if (typeof stateAny.wasMonarchAtTurnBegin[pid] !== 'boolean') stateAny.wasMonarchAtTurnBegin[pid] = false;
      if (typeof stateAny.monarchAtTurnBegan[pid] !== 'boolean') stateAny.monarchAtTurnBegan[pid] = false;
      if (typeof stateAny.descendedThisTurn[pid] !== 'boolean') stateAny.descendedThisTurn[pid] = false;
      if (typeof stateAny.permanentLeftBattlefieldThisTurn[pid] !== 'boolean') stateAny.permanentLeftBattlefieldThisTurn[pid] = false;
      if (!Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[pid])) stateAny.attackedPlayersThisTurnByPlayer[pid] = [];

      if (!Array.isArray(stateAny.attackedPlayersLastTurnByPlayer[pid])) stateAny.attackedPlayersLastTurnByPlayer[pid] = [];
      if (!stateAny.attackedYouLastTurnByPlayer[pid] || typeof stateAny.attackedYouLastTurnByPlayer[pid] !== 'object') {
        stateAny.attackedYouLastTurnByPlayer[pid] = {};
      }
      if (typeof stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[pid] !== 'number') stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[pid] = 0;
      if (typeof stateAny.creaturesEnteredBattlefieldLastTurnByController[pid] !== 'number') stateAny.creaturesEnteredBattlefieldLastTurnByController[pid] = 0;
      if (stateAny.spellsCastLastTurnByPlayerCounts && typeof stateAny.spellsCastLastTurnByPlayerCounts === 'object') {
        if (typeof stateAny.spellsCastLastTurnByPlayerCounts[pid] !== 'number') stateAny.spellsCastLastTurnByPlayerCounts[pid] = 0;
      }
      if (typeof stateAny.lifeLostLastTurnByPlayerCounts[pid] !== 'number') stateAny.lifeLostLastTurnByPlayerCounts[pid] = 0;
      if (typeof stateAny.lifeLostLastTurnByPlayer[pid] !== 'number') stateAny.lifeLostLastTurnByPlayer[pid] = stateAny.lifeLostLastTurnByPlayerCounts[pid];
      if (typeof stateAny.lifeLostLastTurn[pid] !== 'number') stateAny.lifeLostLastTurn[pid] = stateAny.lifeLostLastTurnByPlayerCounts[pid];

      if (typeof stateAny.lifeGainedThisTurn[pid] !== 'number') stateAny.lifeGainedThisTurn[pid] = 0;
      if (typeof stateAny.lifeLostThisTurn[pid] !== 'number') stateAny.lifeLostThisTurn[pid] = 0;
      if (typeof stateAny.cardsDrawnThisTurn[pid] !== 'number') stateAny.cardsDrawnThisTurn[pid] = 0;
      if (typeof stateAny.spellsCastFromHandThisTurn[pid] !== 'number') stateAny.spellsCastFromHandThisTurn[pid] = 0;
      if (typeof stateAny.noncreatureSpellsCastThisTurn[pid] !== 'number') stateAny.noncreatureSpellsCastThisTurn[pid] = 0;
      if (typeof stateAny.damageTakenThisTurnByPlayer[pid] !== 'number') stateAny.damageTakenThisTurnByPlayer[pid] = 0;
      if (typeof stateAny.discardedCardThisTurn[pid] !== 'boolean') stateAny.discardedCardThisTurn[pid] = false;
      if (!Array.isArray(stateAny.dieRollsThisTurn[pid])) stateAny.dieRollsThisTurn[pid] = [];
      if (!stateAny.creaturesThatDealtDamageToPlayer[pid] || typeof stateAny.creaturesThatDealtDamageToPlayer[pid] !== 'object') {
        stateAny.creaturesThatDealtDamageToPlayer[pid] = {};
      }

      if (typeof stateAny.spellWasWarpedThisTurn[pid] !== 'boolean') stateAny.spellWasWarpedThisTurn[pid] = false;
      if (typeof stateAny.evidenceCollectedThisTurn[pid] !== 'boolean') stateAny.evidenceCollectedThisTurn[pid] = false;
      if (typeof stateAny.evidenceCollectedThisTurnByPlayer[pid] !== 'boolean') stateAny.evidenceCollectedThisTurnByPlayer[pid] = false;
      if (typeof stateAny.evidenceCollectedThisTurnByPlayerCounts[pid] !== 'number') stateAny.evidenceCollectedThisTurnByPlayerCounts[pid] = 0;
      if (typeof stateAny.cardsPutIntoYourGraveyardThisTurn[pid] !== 'number') stateAny.cardsPutIntoYourGraveyardThisTurn[pid] = 0;
      if (typeof stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn[pid] !== 'number') stateAny.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn[pid] = 0;
      if (typeof stateAny.creatureCardPutIntoYourGraveyardThisTurn[pid] !== 'boolean') stateAny.creatureCardPutIntoYourGraveyardThisTurn[pid] = false;
      if (typeof stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn[pid] !== 'boolean') {
        stateAny.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn[pid] = false;
      }
      if (typeof stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn[pid] !== 'boolean') {
        stateAny.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn[pid] = false;
      }
      if (typeof stateAny.permanentPutIntoHandFromBattlefieldThisTurn[pid] !== 'boolean') {
        stateAny.permanentPutIntoHandFromBattlefieldThisTurn[pid] = false;
      }

      if (typeof stateAny.playedCardFromExileThisTurn[pid] !== 'boolean') stateAny.playedCardFromExileThisTurn[pid] = false;
      if (typeof stateAny.tokensCreatedThisTurn[pid] !== 'number') stateAny.tokensCreatedThisTurn[pid] = 0;
      if (typeof stateAny.tokenCreatedThisTurn[pid] !== 'number') stateAny.tokenCreatedThisTurn[pid] = 0;
      if (typeof stateAny.createdTokenThisTurn[pid] !== 'number') stateAny.createdTokenThisTurn[pid] = 0;
      if (typeof stateAny.sacrificedCluesThisTurn[pid] !== 'number') stateAny.sacrificedCluesThisTurn[pid] = 0;
      if (typeof stateAny.cluesSacrificedThisTurn[pid] !== 'number') stateAny.cluesSacrificedThisTurn[pid] = 0;
      if (typeof stateAny.cluesSacrificedThisTurnCount[pid] !== 'number') stateAny.cluesSacrificedThisTurnCount[pid] = 0;
      if (typeof stateAny.permanentsSacrificedThisTurn[pid] !== 'number') stateAny.permanentsSacrificedThisTurn[pid] = 0;
      if (typeof stateAny.foodsSacrificedThisTurn[pid] !== 'number') stateAny.foodsSacrificedThisTurn[pid] = 0;
      if (typeof stateAny.putCounterOnCreatureThisTurn[pid] !== 'boolean') stateAny.putCounterOnCreatureThisTurn[pid] = false;
      if (typeof stateAny.placedCounterOnCreatureThisTurn[pid] !== 'boolean') stateAny.placedCounterOnCreatureThisTurn[pid] = false;
      if (typeof stateAny.countersPlacedOnCreaturesThisTurn[pid] !== 'boolean') stateAny.countersPlacedOnCreaturesThisTurn[pid] = false;
      if (typeof stateAny.putPlusOneCounterOnPermanentThisTurn[pid] !== 'boolean') stateAny.putPlusOneCounterOnPermanentThisTurn[pid] = false;
      if (typeof stateAny.placedPlusOneCounterOnPermanentThisTurn[pid] !== 'boolean') stateAny.placedPlusOneCounterOnPermanentThisTurn[pid] = false;
      if (typeof stateAny.plusOneCounterPlacedOnPermanentThisTurn[pid] !== 'boolean') stateAny.plusOneCounterPlacedOnPermanentThisTurn[pid] = false;
      if (typeof stateAny.cardLeftGraveyardThisTurn[pid] !== 'boolean') stateAny.cardLeftGraveyardThisTurn[pid] = false;
      if (typeof stateAny.cardsLeftGraveyardThisTurn[pid] !== 'boolean') stateAny.cardsLeftGraveyardThisTurn[pid] = false;
      if (typeof stateAny.leftGraveyardThisTurn[pid] !== 'boolean') stateAny.leftGraveyardThisTurn[pid] = false;
      if (typeof stateAny.creatureCardLeftGraveyardThisTurn[pid] !== 'boolean') stateAny.creatureCardLeftGraveyardThisTurn[pid] = false;
      if (typeof stateAny.creatureCardsLeftGraveyardThisTurn[pid] !== 'boolean') stateAny.creatureCardsLeftGraveyardThisTurn[pid] = false;
      if (typeof stateAny.cardLeftYourGraveyardThisTurn[pid] !== 'boolean') stateAny.cardLeftYourGraveyardThisTurn[pid] = false;
      if (typeof stateAny.creatureCardLeftYourGraveyardThisTurn[pid] !== 'boolean') stateAny.creatureCardLeftYourGraveyardThisTurn[pid] = false;
    }
  } catch (e) {
    // non-fatal; best-effort
    debugWarn(1, "ensureStateZonesForPlayers failed:", e);
  }
}
