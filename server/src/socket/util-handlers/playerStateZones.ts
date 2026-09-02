// server/src/socket/util-handlers/playerStateZones.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: defaultPlayerZones, ensureStateZonesForPlayers, millUntilLand.
// Public entry symbols: defaultPlayerZones, ensureStateZonesForPlayers,
//   millUntilLand.
// Re-exported from util.ts (millUntilLand) so the "./util.js" import path keeps working.

import { appendEvent } from "../../db/index.js";
import { pushCardToGraveyardFromLibrary } from "../../state/modules/graveyardEntryUtils.js";
import { debugWarn } from "../../utils/debug.js";

/* ------------------- Defensive normalization helpers ------------------- */

/** canonical minimal zone shape for a player */
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
 * Ensure authoritative in-memory game.state.zones has entries for all players.
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
    stateAny.tookCombatDamageSinceLastTurn = stateAny.tookCombatDamageSinceLastTurn || {};
    stateAny.combatDamageDealtToPlayerSinceLastTurn = stateAny.combatDamageDealtToPlayerSinceLastTurn || {};
    stateAny.descendedThisTurn = stateAny.descendedThisTurn || {};
    stateAny.permanentLeftBattlefieldThisTurn = stateAny.permanentLeftBattlefieldThisTurn || {};
    stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};

    stateAny.attackedPlayersLastTurnByPlayer = stateAny.attackedPlayersLastTurnByPlayer || {};
    stateAny.attackedYouLastTurnByPlayer = stateAny.attackedYouLastTurnByPlayer || {};
    stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts = stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts || {};
    stateAny.creaturesEnteredBattlefieldLastTurnByController = stateAny.creaturesEnteredBattlefieldLastTurnByController || {};
    if (typeof stateAny.spellsCastLastTurnCount !== 'number') stateAny.spellsCastLastTurnCount = 0;
    if (stateAny.spellsCastLastTurnByPlayerCounts === undefined) stateAny.spellsCastLastTurnByPlayerCounts = {};

    for (const p of stateAny.players as any[]) {
      const pid = String(p?.id ?? p?.playerId ?? '').trim();
      if (!pid) continue;

      if (typeof stateAny.tookCombatDamageSinceLastTurn[pid] !== 'boolean') stateAny.tookCombatDamageSinceLastTurn[pid] = false;
      if (typeof stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] !== 'boolean') stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] = false;
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
    }
  } catch (e) {
    debugWarn(1, "ensureStateZonesForPlayers failed:", e);
  }
}

/** Prefer a populated ctx.libraries Map over an empty zones.library (and the reverse). */
function pickMutablePlayerLibraryForMill(ctx: any, playerId: string): any[] {
  const fromMap = ctx?.libraries?.get?.(playerId);
  const fromZones = ctx?.state?.zones?.[playerId]?.library;
  if (Array.isArray(fromMap) && fromMap.length > 0) return fromMap;
  if (Array.isArray(fromZones) && fromZones.length > 0) return fromZones;
  if (Array.isArray(fromMap)) return fromMap;
  if (Array.isArray(fromZones)) return fromZones;
  return [];
}

function writePlayerLibraryForMill(ctx: any, playerId: string, library: any[]): void {
  const lib = Array.isArray(library) ? library : [];
  if (ctx?.libraries && typeof ctx.libraries.set === 'function') {
    ctx.libraries.set(playerId, lib);
  }
  const state = ctx?.state as any;
  if (!state) return;
  state.zones = state.zones || {};
  const zoneState = state.zones[playerId] = state.zones[playerId] || defaultPlayerZones();
  zoneState.library = lib;
  zoneState.libraryCount = lib.length;
}

/**
 * Mill cards from the top of a player's library until a land is revealed.
 * Moves all revealed cards to the graveyard and returns the milled cards.
 */
export function millUntilLand(
  game: any,
  targetPlayerId: string
): { milled: any[]; landHit?: any } {
  const result = { milled: [] as any[], landHit: undefined as any };
  try {
    game.state = game.state || {};
    game.state.zones = game.state.zones || {};
    const zones = game.state.zones[targetPlayerId] = game.state.zones[targetPlayerId] || defaultPlayerZones();
    zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
    const millCtx = {
      state: game.state,
      libraries: game.libraries,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      rng: game.rng,
      gameId: game.gameId || game.id,
    } as any;
    const lib = pickMutablePlayerLibraryForMill(millCtx, targetPlayerId);
    if (lib.length === 0) return result;

    while (lib.length > 0) {
      const card = lib.shift();
      if (!card) break;
      result.milled.push(card);
      const isLand = (card.type_line || "").toLowerCase().includes("land");
      pushCardToGraveyardFromLibrary(millCtx, targetPlayerId, card, zones.graveyard);
      if (isLand) {
        result.landHit = card;
        break;
      }
    }

    writePlayerLibraryForMill(millCtx, targetPlayerId, lib);
    zones.graveyardCount = zones.graveyard?.length ?? zones.graveyardCount;

    if (result.milled.length > 0 && !game?.isReplaying) {
      const gameId = String(game?.gameId || game?.id || '').trim();
      if (gameId && gameId !== 'unknown') {
        try {
          appendEvent(gameId, Number(game?.seq ?? 0), 'mill', {
            playerId: targetPlayerId,
            count: result.milled.length,
            cardIds: result.milled.map((c: any) => c?.id).filter(Boolean),
            reason: 'millUntilLand',
          });
        } catch (err) {
          debugWarn(1, '[millUntilLand] appendEvent(mill) failed:', err);
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_STATE) {
      debugWarn(1, "[millUntilLand] Error milling:", err);
    }
  }
  return result;
}
