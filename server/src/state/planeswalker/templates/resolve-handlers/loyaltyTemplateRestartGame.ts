// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateRestartGame.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: restartGameWithKarnExemptions
// Public entry symbols: restartGameWithKarnExemptions
// Karn Liberated restart: preserve non-Aura permanents exiled with source, then nextTurn.

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import { uid } from "../../../utils.js";
import { cleanupCardLeavingExile } from "../../../modules/playable-from-exile.js";
import { nextTurn } from "../../../modules/turn.js";
import { ResolutionQueueManager } from "../../../resolution/index.js";
import { getGameId } from "../utils.js";
import { shuffleInPlace, isNonAuraPermanentCard } from "./loyaltyTemplateHelpers.js";
import { drawCards as drawCardsFromZone } from "../../../modules/zones.js";
import { stampPermanentEntryTimestamp } from '../../../../../../rules-engine/src/permanentTimestamps.js';

export function restartGameWithKarnExemptions(
  ctx: GameContext,
  restartingPlayer: PlayerID,
  sourcePermanentId: string
): { preservedCount: number } {
  const state = (ctx as any).state;
  if (!state) return { preservedCount: 0 };

  const gameId = getGameId(ctx);
  if (gameId && gameId !== 'unknown') {
    try {
      // Restart should clear any pending interactions.
      ResolutionQueueManager.clearAllSteps(gameId);
    } catch {
      // best-effort
    }
  }

  // Clear runtime scheduled steps.
  (ctx as any)._scheduledStepsAfterCurrent = [];
  (ctx as any)._scheduledEndOfTurnSteps = [];

  // Reset stack and combat / misc flags.
  state.stack = [];
  state.emblems = [];
  state.pendingFlickerReturns = [];
  state.extraTurns = [];
  state.playableFromExile = {};
  state.blockersDeclaredBy = undefined;
  delete (state as any).pendingCommanderZoneChoice;
  state.stepAdvanceBlocked = undefined;
  state.noncreatureSpellsCastThisTurn = {};
  state.autoPassForTurn = {};
  (state as any).autoPassEmptyStackForTurn = {};
  state.landsPlayedThisTurn = {};
  (ctx as any).landsPlayedThisTurn = state.landsPlayedThisTurn;
  (ctx as any).manaPool = {};
  if ((ctx as any).passesInRow && typeof (ctx as any).passesInRow === 'object') {
    (ctx as any).passesInRow.value = 0;
  }

  // Reset inactive / hasLost flags.
  if ((ctx as any).inactive instanceof Set) {
    (ctx as any).inactive = new Set();
  }
  for (const p of state.players || []) {
    if (p) (p as any).hasLost = false;
  }

  const zones = (state.zones = state.zones || {});
  const libraries = (ctx as any).libraries as Map<PlayerID, any[]>;
  const commandZone = (ctx as any).commandZone || (state.commandZone = state.commandZone || {});

  const playerIds: PlayerID[] = Array.isArray(state.players)
    ? (state.players.map((p: any) => p?.id).filter(Boolean) as PlayerID[])
    : [];

  // Collect and remove exempted cards from exile.
  const preserved: Array<{ ownerId: PlayerID; card: any }> = [];
  for (const pid of playerIds) {
    const z = zones[pid] || (zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
    const exile: any[] = Array.isArray((z as any).exile) ? (z as any).exile : [];
    const remaining: any[] = [];
    for (const c of exile) {
      const exiledWith = String((c as any)?.exiledWithSourceId || '');
      if (exiledWith && exiledWith === sourcePermanentId && isNonAuraPermanentCard(c)) {
        cleanupCardLeavingExile(state, c);
        preserved.push({ ownerId: pid, card: c });
        continue;
      }
      remaining.push(c);
    }
    (z as any).exile = remaining;
    (z as any).exileCount = remaining.length;
  }

  // Commander IDs to keep out of libraries.
  const commanderIdsByPlayer: Record<string, Set<string>> = {};
  for (const pid of playerIds) {
    const info = commandZone?.[pid];
    const commanderIds: string[] = Array.isArray(info?.commanderIds) ? info.commanderIds : [];
    commanderIdsByPlayer[pid] = new Set(commanderIds.filter(Boolean));

    // On restart, all commanders are back in the command zone and tax resets.
    if (info) {
      (info as any).inCommandZone = commanderIds.slice();
      (info as any).taxById = {};
      (info as any).tax = 0;
    }
  }

  // Sweep battlefield into libraries (tokens cease).
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const toLibraryByPlayer: Record<string, any[]> = {};
  for (const pid of playerIds) toLibraryByPlayer[pid] = [];

  for (const perm of battlefield) {
    if (!perm?.card) continue;
    if ((perm as any).isToken === true) continue;

    const ownerId = perm.owner as PlayerID;
    if (!ownerId || !toLibraryByPlayer[ownerId]) continue;

    const cid = String((perm.card as any).id || '');
    if (cid && commanderIdsByPlayer[ownerId]?.has(cid)) {
      continue; // commanders return to command zone
    }

    toLibraryByPlayer[ownerId].push({ ...(perm.card as any), zone: 'library' });
  }

  // Clear battlefield.
  state.battlefield = [];

  // Sweep zones + existing library into libraries.
  for (const pid of playerIds) {
    const z = zones[pid] || (zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } as any);
    const commanderIds = commanderIdsByPlayer[pid] || new Set<string>();

    const existingLib: any[] = Array.isArray(libraries?.get?.(pid)) ? (libraries.get(pid) as any[]) : [];
    for (const c of existingLib) {
      const cid = String((c as any)?.id || '');
      if (cid && commanderIds.has(cid)) continue;
      toLibraryByPlayer[pid].push({ ...(c as any), zone: 'library' });
    }

    const sweepZone = (zoneName: 'hand' | 'graveyard' | 'exile') => {
      const arr: any[] = Array.isArray((z as any)[zoneName]) ? (z as any)[zoneName] : [];
      for (const c of arr) {
        const cid = String((c as any)?.id || '');
        if (cid && commanderIds.has(cid)) continue;

        if (zoneName === 'exile') {
          cleanupCardLeavingExile(state, c);
        }
        toLibraryByPlayer[pid].push({ ...(c as any), zone: 'library' });
      }
      (z as any)[zoneName] = [];
      (z as any)[`${zoneName}Count`] = 0;
    };

    sweepZone('hand');
    sweepZone('graveyard');
    sweepZone('exile');

    // Set and shuffle new library.
    const newLib = toLibraryByPlayer[pid];
    shuffleInPlace(newLib, typeof (ctx as any).rng === 'function' ? (ctx as any).rng : Math.random);
    libraries.set(pid, newLib);
    (z as any).libraryCount = newLib.length;
  }

  // Reset life/poison/experience.
  state.life = state.life || {};
  const startingLife = state.startingLife ?? 40;
  for (const pid of playerIds) {
    state.life[pid] = startingLife;
    const playerObj = (state.players || []).find((p: any) => p?.id === pid);
    if (playerObj) (playerObj as any).life = startingLife;

    if ((ctx as any).poison) (ctx as any).poison[pid] = 0;
    if ((ctx as any).experience) (ctx as any).experience[pid] = 0;

    // New opening hands: 7 cards.
    drawCardsFromZone(ctx as any, pid, 7);
  }

  // Starting player takes the first turn of the restarted game.
  state.turnNumber = 0;
  const idx = playerIds.indexOf(restartingPlayer);
  const prev = idx > 0 ? playerIds[idx - 1] : playerIds[playerIds.length - 1];
  state.turnPlayer = prev;
  state.priority = null;

  // Initialize beginning of first turn via engine's nextTurn.
  try {
    nextTurn(ctx as any);
  } catch {
    // If something goes wrong, at least keep the game out of pre_game.
    state.phase = 'beginning';
    state.step = 'UPKEEP';
    state.turnPlayer = restartingPlayer;
    state.priority = restartingPlayer;
  }

  // Put preserved non-Aura permanents onto battlefield under restarting player's control.
  for (const entry of preserved) {
    const card = entry.card;
    const typeLineLower = String(card?.type_line || '').toLowerCase();
    const isCreature = typeLineLower.includes('creature');
    const isPlaneswalker = typeLineLower.includes('planeswalker');

    const newPermanent: any = {
      id: uid('perm'),
      card: { ...(card as any), zone: 'battlefield' },
      controller: restartingPlayer,
      owner: entry.ownerId,
      tapped: false,
      summoning_sickness: isCreature,
      counters: {},
      attachedTo: undefined,
    };

    if (isPlaneswalker && (card as any)?.loyalty) {
      const loyaltyValue = parseInt((card as any).loyalty, 10);
      if (!Number.isNaN(loyaltyValue)) {
        newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
        newPermanent.loyalty = loyaltyValue;
        newPermanent.baseLoyalty = loyaltyValue;
      }
    }

    state.battlefield.push(newPermanent);
    stampPermanentEntryTimestamp(state, state.battlefield[state.battlefield.length - 1]);
  }

  ;(ctx as any).bumpSeq?.();
  return { preservedCount: preserved.length };
}

