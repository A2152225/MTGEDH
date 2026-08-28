// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: player-zone hydrate/sync, emblem hydrate/sync, graveyard/exile
//   snapshots, token image enrich, and delayed upkeep-draw / flicker-return
//   bridges from Oracle IR results.
// Public entry symbols: enrichBattlefieldTokenImages, buildShadowProbeContext,
//   hydrateOracleIRPlayerZonesFromContext, snapshotGraveyardCardIds,
//   snapshotExileCardIds, bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult,
//   bridgeScheduleDelayedFlickerReturnsFromOracleIRResult,
//   syncOracleIRPlayerZonesToContext.
// Existing public API stays re-exported from the parent.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { processMillTriggers } from '../zones.js';
import { recordCardPutIntoGraveyardThisTurn } from '../turn-tracking.js';
import { checkGraveyardTrigger } from '../zone-manipulation.js';
import { scheduleExiledCardReturnToBattlefield } from '../executeSpellEffect.js';
import { scheduleDelayedDrawAtNextUpkeep } from '../triggerDelayedEffectUtils.js';
import { enrichTokenCardImages } from '../../../services/tokens.js';
import { debugWarn } from '../../../utils/debug.js';

export function enrichBattlefieldTokenImages(state: any): void {
  const cardsNeedingImages: any[] = [];
  for (const perm of state?.battlefield || []) {
    if (!perm?.isToken || !perm?.card) continue;
    const card = perm.card as any;
    if (card?.image_uris?.normal || card?.image_uris?.small) continue;
    cardsNeedingImages.push(card);
  }
  if (cardsNeedingImages.length === 0) return;
  void enrichTokenCardImages(cardsNeedingImages).catch((err) => {
    debugWarn(1, '[oracle-ir] enrichBattlefieldTokenImages failed (non-fatal):', err);
  });
}

/**
 * The live server stores libraries in ctx.libraries and zone summaries in state.zones,
 * while rules-engine Oracle IR reads/writes player.library on state.players.
 * Hydrate before IR execution and sync back afterward.
 */
/**
 * Clone ctx.libraries for Oracle IR shadow probes so draw/mill steps cannot mutate live game libraries.
 */
export function buildShadowProbeContext(ctx: GameContext): GameContext {
  const libraries = (ctx as any).libraries as Map<PlayerID, any[]> | undefined;
  const clonedLibraries = new Map<PlayerID, any[]>();
  if (libraries && typeof libraries.entries === 'function') {
    for (const [playerId, cards] of libraries.entries()) {
      clonedLibraries.set(
        playerId as PlayerID,
        Array.isArray(cards) ? cards.map((card) => ({ ...card })) : [],
      );
    }
  }
  return { ...(ctx as any), libraries: clonedLibraries } as GameContext;
}

function mapOracleIREmblemToLive(playerId: string, emblem: any): Record<string, unknown> | null {
  if (!emblem || typeof emblem !== 'object') return null;
  const id = String(emblem.id || '').trim();
  if (!id) return null;
  const abilities = Array.isArray(emblem.abilities)
    ? emblem.abilities.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
    : [];
  const effect = String(emblem.effect || abilities.join(' ')).trim();
  return {
    ...emblem,
    id,
    controller: String(emblem.controller || playerId).trim() || playerId,
    sourceName: String(emblem.createdBy || emblem.sourceName || emblem.name || 'Emblem').trim() || 'Emblem',
    effect,
    ...(abilities.length > 0 ? { abilities } : {}),
  };
}

function hydrateOracleIREmblemsFromState(state: any): void {
  const live = Array.isArray(state?.emblems) ? state.emblems : [];
  if (live.length === 0) return;
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const owned = live.filter((emblem: any) => String(emblem?.controller || '') === playerId);
    if (owned.length > 0) {
      player.emblems = owned.map((emblem: any) => ({ ...emblem }));
    }
  }
}

function syncOracleIREmblemsToState(state: any): boolean {
  const existing = Array.isArray(state?.emblems) ? state.emblems : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const emblem of existing) {
    const id = String(emblem?.id || '').trim();
    if (id) byId.set(id, emblem);
  }
  let changed = false;
  for (const player of state.players || []) {
    if (!Array.isArray(player?.emblems)) continue;
    const playerId = String(player.id || '').trim();
    if (!playerId) continue;
    for (const emblem of player.emblems) {
      const mapped = mapOracleIREmblemToLive(playerId, emblem);
      if (!mapped) continue;
      const id = String(mapped.id);
      if (!byId.has(id)) changed = true;
      byId.set(id, mapped);
    }
  }
  if (!changed && byId.size === existing.length) return false;
  state.emblems = [...byId.values()];
  return true;
}

export function hydrateOracleIRPlayerZonesFromContext(ctx: GameContext, state: any): void {
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const lifeFromState = state.life?.[playerId];
    if (typeof lifeFromState === 'number') {
      player.life = lifeFromState;
    }
  }

  hydrateOracleIREmblemsFromState(state);

  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  const canSyncLibraries = Boolean(libraries && typeof libraries.get === 'function');
  // Rules-engine zone ops can read/write through this map when player.library is empty.
  if (canSyncLibraries) {
    (state as any).__serverLibraries = libraries;
  }

  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    if (canSyncLibraries) {
      const library = libraries.get(playerId as PlayerID);
      if (Array.isArray(library)) {
        player.library = library.map((card: any) => ({ ...card, zone: card?.zone || 'library' }));
      }
    }

    const playerZones = zones[playerId] || {};
    if (Array.isArray(playerZones.graveyard)) {
      player.graveyard = playerZones.graveyard.map((card: any) => ({ ...card, zone: card?.zone || 'graveyard' }));
    }
    if (Array.isArray(playerZones.hand)) {
      player.hand = playerZones.hand.map((card: any) => ({ ...card, zone: card?.zone || 'hand' }));
    }
    if (typeof playerZones.handCount === 'number' && Number.isFinite(playerZones.handCount)) {
      player.handCount = playerZones.handCount;
    }
    if (Array.isArray(playerZones.exile)) {
      player.exile = playerZones.exile.map((card: any) => ({ ...card, zone: card?.zone || 'exile' }));
    }
  }
}

export function snapshotGraveyardCardIds(state: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const ids = new Set<string>();
    const zoneGraveyard = Array.isArray(zones[playerId]?.graveyard) ? zones[playerId].graveyard : [];
    const playerGraveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    for (const card of [...zoneGraveyard, ...playerGraveyard]) {
      const cardId = String(card?.id || '').trim();
      if (cardId) ids.add(cardId);
    }
    out.set(playerId, ids);
  }
  return out;
}

export function snapshotExileCardIds(state: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const exile = Array.isArray(zones[playerId]?.exile)
      ? zones[playerId].exile
      : Array.isArray(player?.exile)
        ? player.exile
        : [];
    out.set(playerId, new Set(exile.map((card: any) => String(card?.id || '')).filter(Boolean)));
  }
  return out;
}

const DELAYED_UPKEEP_DRAW_COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseDelayedUpkeepDrawCount(value: string, fallback = 1): number {
  const normalized = String(value || '').toLowerCase().trim();
  if (DELAYED_UPKEEP_DRAW_COUNT_WORDS[normalized] !== undefined) {
    return DELAYED_UPKEEP_DRAW_COUNT_WORDS[normalized];
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isScheduleDelayedBattlefieldReturnStep(
  step: OracleEffectStep,
): step is Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }> {
  if (step.kind !== 'schedule_delayed_trigger') return false;
  const effect = String(step.effect || '').toLowerCase();
  return /\breturn\b/.test(effect) && /\bbattlefield\b/.test(effect);
}

function isScheduleDelayedUpkeepDrawStep(
  step: OracleEffectStep,
): step is Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }> {
  if (step.kind !== 'schedule_delayed_trigger') return false;
  const timing = String(step.timing || '').trim();
  if (timing !== 'next_upkeep' && timing !== 'your_next_upkeep') return false;

  const nestedSteps = Array.isArray((step as { steps?: readonly OracleEffectStep[] }).steps)
    ? (step as { steps?: readonly OracleEffectStep[] }).steps!
    : [];
  if (nestedSteps.some((nested) => nested.kind === 'draw')) return true;

  const effect = String(step.effect || '').toLowerCase();
  return /\bdraw\b/.test(effect);
}

function parseDelayedUpkeepDrawCountFromStep(
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>,
): number {
  const nestedSteps = Array.isArray(step.steps) ? step.steps : [];
  const drawStep = nestedSteps.find((nested) => nested.kind === 'draw') as
    | Extract<OracleEffectStep, { kind: 'draw' }>
    | undefined;
  if (drawStep?.amount?.kind === 'number') {
    return Math.max(1, Math.floor(Number(drawStep.amount.value || 1)));
  }

  const effect = String(step.effect || '');
  const match = effect.match(/\bdraw\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i);
  if (match) return parseDelayedUpkeepDrawCount(match[1], 1);
  if (/\bdraw a card\b/i.test(effect)) return 1;
  return 1;
}

function mapDelayedTriggerTimingToFlickerReturnAt(
  timing: string | undefined,
): 'next_end_step' | 'owners_next_end_step' | 'end_of_combat' {
  const normalized = String(timing || '').trim();
  if (normalized === 'your_next_end_step') return 'owners_next_end_step';
  if (normalized === 'end_of_combat') return 'end_of_combat';
  return 'next_end_step';
}

function findLastNewlyExiledCard(
  state: any,
  exileBefore: Map<string, Set<string>>,
): { ownerId: PlayerID; cardId: string } | null {
  const zones = state.zones || {};
  let last: { ownerId: PlayerID; cardId: string } | null = null;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const beforeIds = exileBefore.get(playerId) || new Set<string>();
    const exile = Array.isArray(zones[playerId]?.exile)
      ? zones[playerId].exile
      : Array.isArray(player?.exile)
        ? player.exile
        : [];

    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      if (cardId && !beforeIds.has(cardId)) {
        last = { ownerId: playerId as PlayerID, cardId };
      }
    }
  }

  return last;
}

export function bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const delayedDrawSteps = (result.appliedSteps || []).filter(isScheduleDelayedUpkeepDrawStep);
  if (delayedDrawSteps.length === 0) return;

  const playerId = String(params.controller || '').trim();
  if (!playerId) return;

  const sourceName = String(params.sourceName || 'Delayed trigger').trim() || 'Delayed trigger';
  const sourceId = String(params.sourceId || '').trim() || undefined;

  for (const step of delayedDrawSteps) {
    scheduleDelayedDrawAtNextUpkeep(ctx, {
      playerId,
      sourceName,
      sourceId,
      count: parseDelayedUpkeepDrawCountFromStep(step),
    });
  }
}

export function bridgeScheduleDelayedFlickerReturnsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  exileBefore: Map<string, Set<string>>,
  params: {
    sourceName?: string;
  },
): void {
  const delayedReturnSteps = (result.appliedSteps || []).filter(isScheduleDelayedBattlefieldReturnStep);
  if (delayedReturnSteps.length === 0) return;

  const hadExileStep = (result.appliedSteps || []).some((step) => {
    if (step.kind === 'exile') return true;
    return step.kind === 'move_zone' && String((step as any).to || '') === 'exile';
  });
  if (!hadExileStep) return;

  const exiled = findLastNewlyExiledCard(state, exileBefore);
  if (!exiled) return;

  const sourceName = String(params.sourceName || 'Flicker effect').trim() || 'Flicker effect';
  for (const step of delayedReturnSteps) {
    const returnAt = mapDelayedTriggerTimingToFlickerReturnAt(step.timing);
    scheduleExiledCardReturnToBattlefield(ctx, exiled.ownerId, exiled.cardId, returnAt, sourceName);
  }
}

export function syncOracleIRPlayerZonesToContext(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  graveyardBefore: Map<string, Set<string>>,
): void {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  const canSyncLibraries = Boolean(libraries && typeof libraries.set === 'function');

  const zones = state.zones = state.zones || {};
  let changed = false;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    if (typeof player.life === 'number') {
      state.life = state.life || {};
      state.life[playerId] = player.life;
      changed = true;
    }

    const playerZones = zones[playerId] = zones[playerId] || {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      libraryCount: 0,
    };

    if (Array.isArray(player.hand)) {
      playerZones.hand = [...player.hand];
      if (player.hand.length > 0) {
        playerZones.handCount = player.hand.length;
      } else if (typeof playerZones.handCount !== 'number') {
        playerZones.handCount = 0;
      }
      changed = true;
    }

    if (Array.isArray(player.graveyard)) {
      const previousIds = graveyardBefore.get(playerId) || new Set<string>();
      const newlyMilled = player.graveyard.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && !previousIds.has(cardId);
      });

      playerZones.graveyard = [...player.graveyard];
      playerZones.graveyardCount = player.graveyard.length;
      changed = true;

      for (const card of newlyMilled) {
        recordCardPutIntoGraveyardThisTurn(ctx, playerId, card, { fromBattlefield: false });
        checkGraveyardTrigger(
          ctx,
          card,
          playerId,
          String((card as any)?.putIntoGraveyardFrom || ''),
        );
      }
      if (newlyMilled.length > 0) {
        try {
          processMillTriggers(ctx, playerId, newlyMilled, controller);
        } catch {
          // best-effort
        }
      }
    }

    if (Array.isArray(player.exile)) {
      playerZones.exile = [...player.exile];
      playerZones.exileCount = player.exile.length;
      changed = true;
    }

    if (!canSyncLibraries) continue;

    if (Array.isArray(player.library)) {
      libraries.set(playerId as PlayerID, [...player.library]);
      playerZones.library = [...player.library];
      playerZones.libraryCount = player.library.length;
      changed = true;
    }
  }

  if (syncOracleIREmblemsToState(state)) {
    changed = true;
  }

  delete (state as any).__serverLibraries;

  if (changed && typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }
}

export function syncAllOracleIRPlayerZonesAfterResolution(ctx: GameContext): void {
  const state = (ctx as any).state;
  if (!state) return;
  const graveyardBefore = snapshotGraveyardCardIds(state);
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (playerId) {
      syncOracleIRPlayerZonesToContext(ctx, state, playerId, graveyardBefore);
    }
  }
}

