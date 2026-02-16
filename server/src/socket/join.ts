import type { Server, Socket } from "socket.io";
import { randomBytes } from "crypto";
import { ensureGame, broadcastGame, schedulePriorityTimeout } from "./util";
import { appendEvent, updateGameCreatorPlayerId, getGameCreator } from "../db";
import { computeDiff } from "../utils/diff";
import { games } from "./socket.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Register join handlers.
 * Defensive and resilient:
 *  - tolerates Game implementations that lack hasRngSeed/seedRng/viewFor/join,
 *  - persists rngSeed best-effort and continues on DB write failures,
 *  - normalizes emitted view so view.zones[playerId] exists for every player,
 *  *  - ensures in-memory game.state.zones is updated for newly-added players so other modules don't see undefined.
 *
 * Added: per-game join queue to serialize join processing and avoid race-created duplicate roster entries.
 * Change: when a forcedFixedPlayerId is present we DO NOT call game.join(...) so reconnects cannot be
 *         overridden by custom join implementations that create new players.
 */

/* --- Helpers --- */
function safeParticipants(game: any) {
  try {
    if (!game) return [];
    if (typeof game.participants === "function") return game.participants();
    if (Array.isArray((game as any).participantsList))
      return (game as any).participantsList;
    return game.state && Array.isArray(game.state.players)
      ? game.state.players.map((p: any) => ({
          playerId: p.id,
          socketId: (p as any).socketId ?? undefined,
          spectator: !!(p.spectator || p.isSpectator),
        }))
      : [];
  } catch {
    return [];
  }
}

function defaultPlayerZones() {
  return {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}

/** Find a roster entry by display name (case-insensitive, trimmed) */
function findPlayerByName(game: any, name?: string) {
  if (!name) return undefined;
  try {
    const nm = String(name).trim().toLowerCase();
    if (!game || !game.state || !Array.isArray(game.state.players))
      return undefined;
    return (game.state.players as any[]).find(
      (p) => String(p?.name || "").trim().toLowerCase() === nm
    );
  } catch {
    return undefined;
  }
}

/** Find a roster entry by seatToken */
function findPlayerBySeatToken(game: any, token?: string) {
  if (!token) return undefined;
  try {
    if (!game || !game.state || !Array.isArray(game.state.players))
      return undefined;
    return (game.state.players as any[]).find(
      (p) => p?.seatToken && String(p.seatToken) === String(token)
    );
  } catch {
    return undefined;
  }
}

/** Generate a short seat token */
function makeSeatToken() {
  return randomBytes(6).toString("hex"); // 12 hex chars, reasonably unique for local use
}

/**
 * Ensure the authoritative in-memory game.state.zones has entries for all players
 * This prevents other modules from reading undefined for zones[playerId].
 */
function ensureStateZonesForPlayers(game: any) {
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

/**
 * Normalize a view object before emitting to clients. Also mirrors per-player zone defaults
 * back into game.state.zones when possible so server-side code sees consistent shape.
 */
function normalizeViewForEmit(rawView: any, game: any) {
  try {
    const view = rawView || {};
    view.zones = view.zones || {};
    const players = Array.isArray(view.players)
      ? view.players
      : game &&
        game.state &&
        Array.isArray(game.state.players)
      ? game.state.players
      : [];
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      view.zones[pid] = view.zones[pid] ?? defaultPlayerZones();
    }

    // Also ensure authoritative game.state.zones is populated so other server modules don't see undefined
    try {
      if (game && game.state) {
        game.state.zones = game.state.zones || {};
        for (const pid of Object.keys(view.zones)) {
          if (!game.state.zones[pid]) game.state.zones[pid] = view.zones[pid];
          else {
            // merge minimal shape without clobbering existing data
            const src = view.zones[pid];
            const dst = game.state.zones[pid];
            dst.hand = Array.isArray(dst.hand)
              ? dst.hand
              : Array.isArray(src.hand)
              ? src.hand
              : [];
            dst.handCount =
              typeof dst.handCount === "number"
                ? dst.handCount
                : Array.isArray(dst.hand)
                ? dst.hand.length
                : 0;
            dst.library = Array.isArray(dst.library)
              ? dst.library
              : Array.isArray(src.library)
              ? src.library
              : [];
            dst.libraryCount =
              typeof dst.libraryCount === "number"
                ? dst.libraryCount
                : Array.isArray(dst.library)
                ? dst.library.length
                : 0;
            dst.graveyard = Array.isArray(dst.graveyard)
              ? dst.graveyard
              : Array.isArray(src.graveyard)
              ? src.graveyard
              : [];
            dst.graveyardCount =
              typeof dst.graveyardCount === "number"
                ? dst.graveyardCount
                : Array.isArray(dst.graveyard)
                ? dst.graveyard.length
                : 0;
          }
        }
      }
    } catch (e) {
      // swallow; normalization already done for emit
    }

    return view;
  } catch (e) {
    debugWarn(1, "normalizeViewForEmit failed:", e);
    return rawView || {};
  }
}

/* --- Debug logging (env-gated) --- */
/**
 * Compact, env-gated state debug logger.
 * Avoids dumping the entire deck; logs summary + first/last library card only.
 */
function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;

    const playerIds = Array.isArray(view?.players)
      ? view.players.map((p: any) => p?.id ?? p?.playerId)
      : [];
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];

    const firstPid = playerIds[0];
    const z = firstPid && view?.zones ? view.zones[firstPid] : null;
    const handCount =
      typeof z?.handCount === "number"
        ? z.handCount
        : Array.isArray(z?.hand)
        ? z.hand.length
        : 0;
    const libraryCount =
      typeof z?.libraryCount === "number"
        ? z.libraryCount
        : Array.isArray(z?.library)
        ? z.library.length
        : 0;

    const lib = z && Array.isArray(z.library) ? z.library : [];
    const firstLib = lib[0];
    const lastLib =
      lib.length > 1 ? lib[lib.length - 1] : lib.length === 1 ? lib[0] : null;

    debug(2, 
      `[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerIds.join(
        ","
      )}] zones=[${zoneKeys.join(
        ","
      )}] handCount=${handCount} libraryCount=${libraryCount}`
    );
    debug(2, `[STATE_DEBUG] ${prefix} librarySample gameId=${gameId}`, {
      firstLibraryCard: firstLib
        ? {
            id: firstLib.id,
            name: firstLib.name,
            type_line: firstLib.type_line,
          }
        : null,
      lastLibraryCard: lastLib
        ? {
            id: lastLib.id,
            name: lastLib.name,
            type_line: lastLib.type_line,
          }
        : null,
    });
  } catch {
    // non-fatal
  }
}

/* --- Join queue to serialize join handling per game --- */
const joinQueues = new Map<string, Promise<void>>();

/* --- Handlers --- */
export function registerJoinHandlers(io: Server, socket: Socket) {
  // Join a game
  socket.on(
    "joinGame",
    async (payload?: {
      gameId?: unknown;
      playerName?: unknown;
      spectator?: unknown;
      seatToken?: unknown;
      fixedPlayerId?: unknown;
    }) => {
      const gameId = payload?.gameId;
      const playerName = typeof payload?.playerName === "string" ? payload.playerName : "";
      const spectator = payload?.spectator === true;
      const seatToken = typeof payload?.seatToken === "string" ? payload.seatToken : undefined;
      const fixedPlayerId = typeof payload?.fixedPlayerId === "string" ? payload.fixedPlayerId : undefined;

      if (!gameId || typeof gameId !== "string") {
        socket.emit("error", {
          code: "MISSING_GAME_ID",
          message: "Missing gameId",
        });
        return;
      }

      // Serialize handling for this gameId by chaining onto the per-game promise tail.
      const tail = joinQueues.get(gameId) || Promise.resolve();
      const myTask = tail
        .then(async () => {
          try {
            const game = ensureGame(gameId);
            if (!game) {
              try {
                socket.emit("error", {
                  code: "GAME_NOT_FOUND",
                  message: "Game not found.",
                });
              } catch {}
              return;
            }

            // Debug: log incoming join payload when enabled
            if (process.env.DEBUG_STATE === "1") {
              debug(2, "joinGame incoming payload:", {
                socketId: socket.id,
                gameId,
                playerName,
                spectator,
                seatToken,
                fixedPlayerId,
              });
            }

            // Try reattach by seatToken first (strong preference).
            let forcedFixedPlayerId = fixedPlayerId;
            let resolvedToken: string | undefined = undefined;
            if (!forcedFixedPlayerId && seatToken) {
              const byToken = findPlayerBySeatToken(game, seatToken);
              if (byToken && byToken.id) {
                forcedFixedPlayerId = byToken.id;
                resolvedToken = byToken.seatToken;
                if (process.env.DEBUG_STATE === "1")
                  debug(2, 
                    `joinGame: resolved via seatToken -> playerId=${forcedFixedPlayerId}`
                  );
              }
            }

            // If no forced id and a player name exists, only block on name if that player is actually connected.
            if (!forcedFixedPlayerId && playerName) {
              const existing =
                game.state && Array.isArray(game.state.players)
                  ? (game.state.players as any[]).find(
                      (p) =>
                        String(p?.name || "").trim().toLowerCase() ===
                        String(playerName).trim().toLowerCase()
                    )
                  : undefined;

              if (existing && existing.id) {
                const participants = safeParticipants(game);
                const isConnected = participants.some(
                  (pp: any) => pp.playerId === existing.id
                );

                if (isConnected) {
                  if (process.env.DEBUG_STATE === "1")
                    debug(2, 
                      `joinGame: name exists and is connected -> prompting nameInUse (playerId=${existing.id}, connected=true)`
                    );
                  socket.emit("nameInUse", {
                    gameId,
                    playerName,
                    options: [
                      { action: "reconnect", fixedPlayerId: existing.id },
                      { action: "newName" },
                      { action: "cancel" },
                    ],
                    meta: { isConnected: true },
                  });
                  return;
                } else {
                  // NEW: when the player with this name exists but is disconnected,
                  // treat this as a reconnect and reuse that playerId automatically.
                  forcedFixedPlayerId = existing.id;
                  resolvedToken = existing.seatToken || resolvedToken;
                  if (process.env.DEBUG_STATE === "1")
                    debug(2, 
                      `joinGame: name exists but is disconnected -> auto-reusing playerId=${existing.id}`
                    );
                }
              }
            }

            // Ensure RNG seed exists. Be defensive against missing methods or throws.
            try {
              let hasSeed = false;
              try {
                // IMPORTANT:
                // The rules-engine game always has an in-memory RNG seed (ctx.rngSeed) from createContext(),
                // so hasRngSeed() is NOT a reliable signal that the seed was persisted.
                // We treat game.state.rngSeed as the persisted marker and only generate/persist it once.
                const persistedSeed =
                  (game.state && (game.state as any).rngSeed) ??
                  (game as any)._rngSeed;
                hasSeed =
                  typeof persistedSeed === "number" &&
                  Number.isFinite(persistedSeed) &&
                  persistedSeed !== 0;
              } catch {
                hasSeed = false;
              }

              if (!hasSeed) {
                const seed =
                  (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
                try {
                  if (typeof (game as any).seedRng === "function") {
                    try {
                      (game as any).seedRng(seed);
                    } catch (e) {
                      // fall back to state field only
                    }
                  } else {
                    // no seedRng() available, just record seed for replay consistency
                  }
                } catch (e) {
                  debugWarn(1, 
                    "joinGame: failed to set rng seed on game instance (continuing):",
                    e
                  );
                }

                // Always store the seed on state as the persisted marker.
                // This prevents reseeding on reconnect and makes debugging easier.
                try {
                  game.state = (game.state || {}) as any;
                  (game.state as any).rngSeed = seed;
                  (game as any)._rngSeed = seed;
                } catch {
                  /* ignore */
                }

                try {
                  await appendEvent(
                    gameId,
                    (game as any).seq || 0,
                    "rngSeed",
                    { seed }
                  );
                } catch (err) {
                  debugWarn(1, 
                    "joinGame: appendEvent rngSeed failed (continuing):",
                    err
                  );
                }
              }
            } catch (e) {
              debugWarn(1, 
                "joinGame: rng seed detection failed (continuing):",
                e
              );
            }

            // Perform join using game.join() when available; otherwise fallback.
            // IMPORTANT: if we have a forcedFixedPlayerId (reconnect intent), DO NOT call game.join
            // because some implementations may create a new player despite the fixed id. Use the
            // server's deterministic fallback reattach/create logic instead.
            let playerId: string = "";
            let added = false;

            const shouldCallGameJoin =
              typeof (game as any).join === "function" && !forcedFixedPlayerId;
            if (shouldCallGameJoin) {
              try {
                const res = (game as any).join(
                  socket.id,
                  playerName,
                  Boolean(spectator),
                  forcedFixedPlayerId ?? undefined,
                  seatToken
                );
                playerId =
                  res?.playerId || (Array.isArray(res) ? res[0] : undefined) || "";
                added = Boolean(res?.added) || false;
                resolvedToken =
                  resolvedToken || res?.seatToken || res?.seat || undefined;
                if (process.env.DEBUG_STATE === "1")
                  debug(2, "joinGame: game.join returned", {
                    playerId,
                    added,
                    resolvedToken,
                  });
              } catch (err) {
                debugWarn(1, 
                  "joinGame: game.join threw (continuing to fallback):",
                  err
                );
              }
            } else {
              if (forcedFixedPlayerId && process.env.DEBUG_STATE === "1") {
                debug(2, 
                  "joinGame: skipping game.join because forcedFixedPlayerId present; falling back to server reattach logic"
                );
              }
            }

            // Helper: rebind engine-level participants to the current socket if possible
            function rebindEngineParticipant(gameObj: any, pid: string, sid: string) {
              try {
                if (typeof gameObj.participants === "function") {
                  const parts = gameObj.participants();
                  const target = parts.find((pp: any) => pp.playerId === pid);
                  if (target) {
                    target.socketId = sid;
                  }
                }
              } catch {
                // non-fatal
              }
            }

            // Fallback / safe reattach/create (serialized — no races now)
            if (!playerId) {
              // 1) forcedFixedPlayerId => reuse existing or create with that id (very rare)
              if (forcedFixedPlayerId) {
                playerId = forcedFixedPlayerId;
                try {
                  game.state = (game.state || {}) as any;
                  game.state.players = game.state.players || [];
                  const playerObj = (game.state.players as any[]).find(
                    (p) => p.id === playerId
                  );
                  if (playerObj) {
                    playerObj.socketId = socket.id;
                    if (!playerObj.seatToken)
                      playerObj.seatToken = resolvedToken || makeSeatToken();
                    resolvedToken = resolvedToken || playerObj.seatToken;
                    added = false;
                    if (process.env.DEBUG_STATE === "1")
                      debug(2, 
                        `joinGame: reused forcedFixedPlayerId ${playerId}`
                      );
                  } else {
                    // unexpected: create one with forced id
                    const token = resolvedToken || makeSeatToken();
                    const newP: any = {
                      id: playerId,
                      name: playerName,
                      spectator: Boolean(spectator),
                      isSpectator: Boolean(spectator),
                      seatToken: token,
                      socketId: socket.id,
                    };
                    game.state.players.push(newP);
                    resolvedToken = token;
                    added = true;
                    if (process.env.DEBUG_STATE === "1")
                      debug(2, 
                        `joinGame: created player for forcedFixedPlayerId ${playerId}`
                      );
                  }

                  // Rebind engine participants to this socketId
                  rebindEngineParticipant(game, playerId, socket.id);
                } catch (e) {
                  debugWarn(1, 
                    "joinGame: forcedFixedPlayerId fallback failed:",
                    e
                  );
                }
              } else {
                // 2) seatToken reattach (if present)
                if (seatToken) {
                  const byToken = findPlayerBySeatToken(game, seatToken);
                  if (byToken && byToken.id) {
                    playerId = byToken.id;
                    try {
                      byToken.socketId = socket.id;
                      resolvedToken = byToken.seatToken;
                    } catch {}
                    added = false;
                    if (process.env.DEBUG_STATE === "1")
                      debug(2, 
                        `joinGame: reattached by seatToken -> ${playerId}`
                      );
                    // Rebind engine participants
                    rebindEngineParticipant(game, playerId, socket.id);
                  }
                }
              }
            }

            // 3) reuse by name if disconnected (otherwise nameInUse would have returned earlier)
            if (!playerId && playerName) {
              const existingByName = findPlayerByName(game, playerName);
              if (existingByName && existingByName.id) {
                const participants = safeParticipants(game);
                const isConnected = participants.some(
                  (pp: any) => pp.playerId === existingByName.id
                );
                if (isConnected) {
                  socket.emit("nameInUse", {
                    gameId,
                    playerName,
                    options: [
                      { action: "reconnect", fixedPlayerId: existingByName.id },
                      { action: "newName" },
                      { action: "cancel" },
                    ],
                    meta: { isConnected: true },
                  });
                  return;
                } else {
                  playerId = existingByName.id;
                  try {
                    existingByName.socketId = socket.id;
                    if (!existingByName.seatToken)
                      existingByName.seatToken = makeSeatToken();
                    resolvedToken =
                      resolvedToken || existingByName.seatToken;
                  } catch {}
                  added = false;
                  if (process.env.DEBUG_STATE === "1")
                    debug(2, 
                      `joinGame: reused disconnected name -> ${playerId}`
                    );
                  // Rebind engine participants
                  rebindEngineParticipant(game, playerId, socket.id);
                }
              }
            }

            // 4) final re-checks and create new player if still no id
            if (!playerId) {
              // last-chance seatToken re-check
              if (seatToken) {
                const byToken2 = findPlayerBySeatToken(game, seatToken);
                if (byToken2 && byToken2.id) {
                  playerId = byToken2.id;
                  added = false;
                  try {
                    byToken2.socketId = socket.id;
                    resolvedToken = byToken2.seatToken;
                  } catch {}
                  if (process.env.DEBUG_STATE === "1")
                    debug(2, 
                      `joinGame: last-chance reattach by seatToken -> ${playerId}`
                    );
                  // Rebind engine participants
                  rebindEngineParticipant(game, playerId, socket.id);
                }
              }
            }

            if (!playerId) {
              if (playerName) {
                const existing = findPlayerByName(game, playerName);
                if (existing && existing.id) {
                  const participants = safeParticipants(game);
                  const isConnected = participants.some(
                    (pp: any) => pp.playerId === existing.id
                  );
                  socket.emit("nameInUse", {
                    gameId,
                    playerName,
                    options: [
                      { action: "reconnect", fixedPlayerId: existing.id },
                      { action: "newName" },
                      { action: "cancel" },
                    ],
                    meta: { isConnected: Boolean(isConnected) },
                  });
                  return;
                }
              }

              // create new
              const newId = `p_${Math.random().toString(36).slice(2, 9)}`;
              const tokenToUse = seatToken || makeSeatToken();
              
              // Check if game has started (not in pre_game phase)
              const gamePhase = String((game.state as any)?.phase || "").toLowerCase();
              // Game has started if phase is not empty AND not "pre_game"
              // Empty string or "pre_game" both indicate the game hasn't started yet
              const hasGameStarted = gamePhase !== "" && gamePhase !== "pre_game";
              
              const playerObj: any = {
                id: newId,
                name: playerName,
                spectator: Boolean(spectator),
                isSpectator: Boolean(spectator),
                seatToken: tokenToUse,
                socketId: socket.id,
                inactive: hasGameStarted && !spectator, // Mark as inactive if game has started and not a spectator
              };
              game.state = (game.state || {}) as any;
              game.state.players = game.state.players || [];
              game.state.players.push(playerObj);
              
              // Add to inactive set if game has started and player is not a spectator
              if (hasGameStarted && !spectator) {
                if (!(game as any).inactive) {
                  (game as any).inactive = new Set<string>();
                }
                (game as any).inactive.add(newId);
                if (process.env.DEBUG_STATE === "1")
                  debug(2, 
                    `joinGame: marked new player ${newId} as inactive (game already started)`
                  );
              }
              
              playerId = newId;
              resolvedToken = tokenToUse;
              added = true;
              if (process.env.DEBUG_STATE === "1")
                debug(2, 
                  `joinGame: created new player ${playerId} (name=${playerName})`
                );
              // Rebind engine participants (in case engine inspects state.players)
              rebindEngineParticipant(game, playerId, socket.id);
            }

            // Ensure server-side zones for players exist
            try {
              ensureStateZonesForPlayers(game);
            } catch (e) {
              /* ignore */
            }

            // Session metadata + socket room
            try {
              socket.data = {
                gameId,
                playerId,
                spectator: Boolean(spectator),
                isSpectator: Boolean(spectator),
              };
            } catch {}
            try {
              socket.join(gameId);
            } catch {}

            // Build view (viewFor or raw) with judge support
            let rawView: any;
            try {
              if (typeof (game as any).viewFor === "function") {
                const role = (socket.data as any)?.role;
                const isJudge = role === "judge";
                const viewer = isJudge ? ("spectator:judge" as any) : playerId;
                rawView = (game as any).viewFor(
                  viewer,
                  Boolean(spectator)
                );
              } else {
                rawView = game.state;
              }
            } catch (e) {
              debugWarn(1, 
                "joinGame: viewFor failed, falling back to raw state",
                e
              );
              rawView = game.state;
            }

            const view = normalizeViewForEmit(rawView, game);

            // Debug log
            logStateDebug("EMIT_JOIN_STATE", gameId, view);

            // Emit joined (include seatToken)
            try {
              socket.emit("joined", {
                gameId,
                you: playerId,
                seatToken: resolvedToken,
              });
            } catch (e) {
              debugWarn(1, "joinGame: emit joined failed", e);
            }
            try {
              socket.emit("state", {
                gameId,
                view,
                seq: (game as any).seq || 0,
              });
            } catch (e) {
              debugWarn(1, "joinGame: emit state failed", e);
            }

            // Persist join event if new
            if (!spectator && added) {
              // Track game creator: if this is the first human player and no creator is set,
              // set this player as the creator
              try {
                const creatorInfo = getGameCreator(gameId);
                if (creatorInfo && !creatorInfo.created_by_player_id) {
                  updateGameCreatorPlayerId(gameId, playerId);
                  debug(1, `[join] Set game creator for ${gameId} to player ${playerId}`);
                }
              } catch (e) {
                debugWarn(1, "joinGame: failed to update game creator (non-fatal):", e);
              }
              
              try {
                await appendEvent(
                  gameId,
                  (game as any).seq || 0,
                  "join",
                  {
                    playerId,
                    name: playerName,
                    seat:
                      view.players?.find(
                        (p: any) => p.id === playerId
                      )?.seat,
                    seatToken: resolvedToken,
                  }
                );
              } catch (dbError) {
                debugError(1, 
                  `joinGame database error for game ${gameId}:`,
                  dbError
                );
                try {
                  socket.emit("error", {
                    code: "DB_ERROR",
                    message: "Failed to log the player join event.",
                  });
                } catch {}
              }

              try {
                socket.to(gameId).emit("stateDiff", {
                  gameId,
                  diff:
                    typeof computeDiff === "function"
                      ? computeDiff(undefined, view, (game as any).seq || 0)
                      : { full: view },
                });
                schedulePriorityTimeout(io, game, gameId);
              } catch (e) {
                debugWarn(1, "joinGame: emit stateDiff failed", e);
                try {
                  io.to(gameId).emit("state", {
                    gameId,
                    view,
                    seq: (game as any).seq || 0,
                  });
                } catch {}
              }
            } else {
              try {
                schedulePriorityTimeout(io, game, gameId);
              } catch {}
            }
          } catch (err: any) {
            debugError(1, `joinGame error for socket ${socket.id}:`, err);
            try {
              socket.emit("error", {
                code: "JOIN_FAILED",
                message: String(err?.message || err),
              });
            } catch {}
          }
        })
        .catch((e) => {
          // swallow to keep chain healthy
          if (process.env.DEBUG_STATE === "1")
            debugWarn(1, "join queue task error:", e);
        });

      // put myTask onto the tail for this gameId so subsequent joins queue behind it
      joinQueues.set(gameId, myTask);
      // await the task so the socket handler completes after our serialized work
      await myTask;
    }
  );

  // Request state refresh
  socket.on("requestState", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    try {
      if (!gameId || typeof gameId !== 'string') return;

      // Prevent cross-game state leakage: only allow state refresh for the game
      // the socket is currently joined to.
      if ((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) {
        socket.emit?.('error', {
          code: 'NOT_IN_GAME',
          message: 'Not in game.',
        });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', {
          code: 'NOT_IN_GAME',
          message: 'Not in game.',
        });
        return;
      }

      const game = games.get(gameId);
      const playerId = socket.data?.playerId;
      if (!game || !playerId) return;

      let rawView: any;
      try {
        rawView =
          typeof (game as any).viewFor === "function"
            ? (() => {
                const role = (socket.data as any)?.role;
                const isJudge = role === "judge";
                const viewer = isJudge ? ("spectator:judge" as any) : playerId;
                return (game as any).viewFor(
                  viewer,
                  Boolean((socket.data as any)?.spectator || (socket.data as any)?.isSpectator)
                );
              })()
            : game.state;
      } catch (e) {
        debugWarn(1, 
          "requestState: viewFor failed, falling back to raw state",
          e
        );
        rawView = game.state;
      }
      try {
        ensureStateZonesForPlayers(game);
      } catch {}
      const view = normalizeViewForEmit(rawView, game);

      // Debug log
      logStateDebug("EMIT_REQUESTED_STATE", gameId, view);

      socket.emit("state", { gameId, view, seq: (game as any).seq || 0 });
      schedulePriorityTimeout(io, game, gameId);
    } catch (e) {
      debugWarn(1, "requestState handler failed:", e);
    }
  });
}

