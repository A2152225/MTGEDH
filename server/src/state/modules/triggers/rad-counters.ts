import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../../utils/debug.js';
import { getOrCreatePlayerZones } from '../triggerLibraryMillUtils.js';
import { pushCardToPlayerGraveyardWithReplacements } from '../graveyardEntryUtils.js';
import { processLifeChange } from '../game-state-effects.js';

function readPlayerRadCount(state: any, playerId: PlayerID): number {
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === String(playerId));
  const fromPlayerCounters = Number(player?.counters?.rad ?? player?.radCounters ?? 0);
  if (Number.isFinite(fromPlayerCounters) && fromPlayerCounters > 0) {
    return Math.floor(fromPlayerCounters);
  }

  const fromStateMap = Number(state?.radCounters?.[playerId] ?? state?.playerCounters?.[playerId]?.rad ?? 0);
  if (Number.isFinite(fromStateMap) && fromStateMap > 0) {
    return Math.floor(fromStateMap);
  }

  return 0;
}

function writePlayerRadCount(state: any, playerId: PlayerID, nextRad: number): void {
  const normalized = Math.max(0, Math.floor(Number(nextRad) || 0));
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === String(playerId));
  if (player) {
    player.counters = player.counters || {};
    player.counters.rad = normalized;
    player.radCounters = normalized;
  }
  state.radCounters = state.radCounters || {};
  state.radCounters[playerId] = normalized;
}

function isNonlandCard(card: any): boolean {
  const typeLine = String(card?.type_line || card?.types?.join?.(' ') || '').toLowerCase();
  return typeLine.length > 0 && !/\bland\b/.test(typeLine);
}

/**
 * Rule 728.1 inherent triggered ability at precombat main.
 * Mills equal to rad count; each nonland milled causes 1 life loss and removes one rad counter.
 */
export function processRadCountersAtPrecombatMain(ctx: GameContext, playerId: PlayerID): boolean {
  const state = (ctx as any).state;
  if (!state) return false;

  const radCount = readPlayerRadCount(state, playerId);
  if (radCount <= 0) {
    return false;
  }

  const libraries = (ctx as any).libraries;
  const library = Array.isArray(libraries?.get?.(playerId)) ? libraries.get(playerId) as any[] : [];
  const millCount = Math.min(radCount, library.length);
  if (millCount <= 0) {
    return false;
  }

  const zones = getOrCreatePlayerZones(state, playerId);
  let nonlandMilled = 0;

  for (let idx = 0; idx < millCount; idx += 1) {
    if (library.length === 0) break;
    const card = library.shift();
    if (!card) break;
    pushCardToPlayerGraveyardWithReplacements(ctx, playerId, { ...card, zone: 'graveyard' }, zones.graveyard);
    if (isNonlandCard(card)) {
      nonlandMilled += 1;
    }
  }

  if (typeof libraries?.set === 'function') {
    libraries.set(playerId, library);
  }
  zones.libraryCount = library.length;
  zones.graveyardCount = zones.graveyard.length;

  if (nonlandMilled > 0) {
    const { finalAmount, prevented } = processLifeChange(ctx, playerId, nonlandMilled, false);
    if (!prevented && finalAmount !== 0) {
      state.life = state.life || {};
      const players = state.players || [];
      const player = players.find((entry: any) => String(entry?.id || '') === String(playerId));
      const startingLife = state.startingLife ?? 40;
      const currentLife = state.life[playerId] ?? player?.life ?? startingLife;
      const nextLife = currentLife - Math.abs(finalAmount);
      state.life[playerId] = nextLife;
      if (player) {
        player.life = nextLife;
      }
      state.lifeLostThisTurn = state.lifeLostThisTurn || {};
      state.lifeLostThisTurn[playerId] =
        (state.lifeLostThisTurn[playerId] || 0) + Math.abs(finalAmount);
    }
  }

  const remainingRad = Math.max(0, radCount - nonlandMilled);
  writePlayerRadCount(state, playerId, remainingRad);

  debug(
    2,
    `[rad] ${playerId} milled ${millCount} (nonlands=${nonlandMilled}), rad ${radCount} -> ${remainingRad}`,
  );

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  return true;
}
