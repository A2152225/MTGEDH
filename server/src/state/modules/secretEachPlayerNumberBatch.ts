/**
 * Origin parent: server/src/state/modules/spellLegacyChoiceBatchUtils.ts
 * Cluster: secret each-player number batches (Wheel of Misfortune family).
 *   Highest number damages every player who chose it. Players who did not
 *   choose the lowest number discard their hand, then draw.
 * Public: createSecretEachPlayerNumberBatch, recordSecretEachPlayerNumberChoice,
 *   clearSecretEachPlayerNumberBatch, applySecretEachPlayerNumberBatchResult
 */

import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/types.js';
import { drawCards } from './zones-handlers/zonesDrawCards.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { applyDamageToPlayer } from '../planeswalker/templates/resolve-handlers/loyaltyTemplateRuntimeHelpers.js';

function getBatches(state: any): Record<string, any> {
  if (!state.secretEachPlayerNumberBatches || typeof state.secretEachPlayerNumberBatches !== 'object' || Array.isArray(state.secretEachPlayerNumberBatches)) {
    state.secretEachPlayerNumberBatches = {};
  }
  return state.secretEachPlayerNumberBatches;
}

function normalizeChoices(choices: Record<string, number> | undefined): Record<string, number> {
  const next: Record<string, number> = {};
  if (!choices || typeof choices !== 'object' || Array.isArray(choices)) return next;
  for (const [playerId, amount] of Object.entries(choices)) {
    const id = String(playerId || '').trim();
    const number = Math.floor(Number(amount));
    if (!id || !Number.isFinite(number) || number < 0) continue;
    next[id] = number;
  }
  return next;
}

export function createSecretEachPlayerNumberBatch(
  state: any,
  batch: {
    id: string;
    controller?: string;
    sourceId?: string;
    sourceName?: string;
    expectedPlayerIds?: string[];
    choices?: Record<string, number>;
    drawCount?: number;
    minNumber?: number;
  },
): any {
  if (!state) return null;
  const batchId = String(batch?.id || '').trim();
  if (!batchId) return null;

  const batches = getBatches(state);
  const existing = batches[batchId] || {};
  const expectedPlayerIds = Array.isArray(batch?.expectedPlayerIds)
    ? batch.expectedPlayerIds.map((value) => String(value || '').trim()).filter(Boolean)
    : Array.isArray(existing?.expectedPlayerIds)
      ? existing.expectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
  const drawCount = Math.max(0, Math.floor(Number(batch?.drawCount ?? existing?.drawCount ?? 0)));
  const minNumber = Math.max(0, Math.floor(Number(batch?.minNumber ?? existing?.minNumber ?? 0)));

  const nextBatch = {
    ...existing,
    ...batch,
    id: batchId,
    controller: String(batch?.controller || existing?.controller || '').trim() || undefined,
    sourceId: String(batch?.sourceId || existing?.sourceId || '').trim() || undefined,
    sourceName: String(batch?.sourceName || existing?.sourceName || '').trim() || undefined,
    expectedPlayerIds,
    drawCount,
    minNumber,
    choices: {
      ...normalizeChoices(existing?.choices),
      ...normalizeChoices(batch?.choices),
    },
  };
  batches[batchId] = nextBatch;
  return nextBatch;
}

export function recordSecretEachPlayerNumberChoice(
  state: any,
  batchId: string,
  choice: {
    playerId: string;
    number: number;
    controller?: string;
    sourceId?: string;
    sourceName?: string;
    expectedPlayerIds?: string[];
    drawCount?: number;
    minNumber?: number;
  },
): any {
  const normalizedBatchId = String(batchId || '').trim();
  const playerId = String(choice?.playerId || '').trim();
  const selected = Math.floor(Number(choice?.number));
  if (!normalizedBatchId || !playerId || !Number.isFinite(selected) || selected < 0) return null;

  const batch = createSecretEachPlayerNumberBatch(state, {
    id: normalizedBatchId,
    controller: choice?.controller,
    sourceId: choice?.sourceId,
    sourceName: choice?.sourceName,
    expectedPlayerIds: choice?.expectedPlayerIds,
    drawCount: choice?.drawCount,
    minNumber: choice?.minNumber,
  });
  if (!batch) return null;
  batch.choices = {
    ...normalizeChoices(batch.choices),
    [playerId]: selected,
  };
  return batch;
}

export function clearSecretEachPlayerNumberBatch(state: any, batchId: string): void {
  if (!state?.secretEachPlayerNumberBatches || typeof state.secretEachPlayerNumberBatches !== 'object') return;
  const normalizedBatchId = String(batchId || '').trim();
  if (!normalizedBatchId) return;
  delete state.secretEachPlayerNumberBatches[normalizedBatchId];
  if (Object.keys(state.secretEachPlayerNumberBatches).length === 0) {
    delete state.secretEachPlayerNumberBatches;
  }
}

function discardHand(ctx: GameContext, playerId: string): void {
  const state = (ctx as any).state;
  const zones = (state.zones = state.zones || {});
  const zone = (zones[playerId] = zones[playerId] || { hand: [], graveyard: [] });
  zone.hand = Array.isArray(zone.hand) ? zone.hand : [];
  zone.graveyard = Array.isArray(zone.graveyard) ? zone.graveyard : [];
  if (zone.hand.length > 0) {
    const hand = [...zone.hand];
    for (const card of hand) {
      if (card) pushCardToPlayerGraveyardWithReplacements(ctx, playerId, card, zone.graveyard);
    }
    zone.hand = [];
  }
  zone.handCount = zone.hand.length;
  zone.graveyardCount = zone.graveyard.length;
}

export function applySecretEachPlayerNumberBatchResult(
  ctx: GameContext,
  options: {
    expectedPlayerIds?: string[];
    choices?: Record<string, number>;
    drawCount?: number;
  },
): { damageByPlayerId: Record<string, number>; wheeledPlayerIds: string[] } {
  const playerIds = Array.from(new Set(
    (Array.isArray(options.expectedPlayerIds) ? options.expectedPlayerIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
  const choices = normalizeChoices(options.choices);
  const submitted = playerIds.filter((playerId) => Number.isFinite(choices[playerId]));
  if (submitted.length === 0) {
    return { damageByPlayerId: {}, wheeledPlayerIds: [] };
  }

  const numbers = submitted.map((playerId) => choices[playerId]);
  const highest = Math.max(...numbers);
  const lowest = Math.min(...numbers);
  const drawCount = Math.max(0, Math.floor(Number(options.drawCount || 0)));
  const damageByPlayerId: Record<string, number> = {};
  const wheeledPlayerIds: string[] = [];

  for (const playerId of submitted) {
    if (choices[playerId] === highest && highest > 0) {
      applyDamageToPlayer(ctx, playerId as PlayerID, highest);
      damageByPlayerId[playerId] = highest;
    }
    if (choices[playerId] !== lowest) {
      discardHand(ctx, playerId);
      if (drawCount > 0) drawCards(ctx, playerId as PlayerID, drawCount);
      wheeledPlayerIds.push(playerId);
    }
  }

  return { damageByPlayerId, wheeledPlayerIds };
}
