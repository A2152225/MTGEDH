// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: player-zone hydrate/sync, emblem hydrate/sync, graveyard/exile
//   snapshots, token image enrich, and delayed upkeep-draw / flicker-return
//   bridges from Oracle IR results.
// Public entry symbols: enrichBattlefieldTokenImages, repairNamelessBattlefieldCards, buildShadowProbeContext,
//   hydrateOracleIRPlayerZonesFromContext, snapshotGraveyardCardIds,
//   snapshotExileCardIds, bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult,
//   bridgeScheduleDelayedFlickerReturnsFromOracleIRResult,
//   syncOracleIRPlayerZonesToContext.
// Existing public API stays re-exported from the parent.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OraclePlayerSelector } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import type { GameContext } from '../../context.js';
import { processMillTriggers } from '../zones.js';
import { recordCardPutIntoGraveyardThisTurn } from '../turn-tracking.js';
import { checkGraveyardTrigger } from '../zone-manipulation.js';
import { offerCommanderZoneChoiceForArrivals } from '../commanderZoneChoiceOnEntry.js';
import { scheduleExiledCardReturnToBattlefield } from '../executeSpellEffect.js';
import { scheduleDelayedDrawAtNextUpkeep } from '../triggerDelayedEffectUtils.js';
import { delayedUpkeepDrawIsUpToFromStep } from '../triggerDelayedDrawUpToUtils.js';
import { enrichTokenCardImages } from '../../../services/tokens.js';
import { lookupLocalCardByNameSync } from '../../../services/localCardLookup.js';
import { debugWarn } from '../../../utils/debug.js';
import {
  flattenZoneCardForBattlefield,
  isUsableCardDisplayName,
} from '../../../../../rules-engine/src/oracleIRExecutorZoneCardIdentity.js';

export function repairNamelessBattlefieldCards(state: any): void {
  for (const perm of state?.battlefield || []) {
    if (!perm || perm.isFaceDown || perm.isToken) continue;
    const flat = flattenZoneCardForBattlefield(perm.card);
    if (flat && typeof flat === 'object') perm.card = flat;
    const card = perm.card as Record<string, unknown> | undefined;
    if (!card || typeof card !== 'object') continue;
    const name = String(card.name || '').trim();
    const id = String(card.id || perm.id || '').trim();
    const hasImage = Boolean(
      (card.image_uris as { small?: string; normal?: string } | undefined)?.small
      || (card.image_uris as { small?: string; normal?: string } | undefined)?.normal
      || (card as { imageUrl?: string }).imageUrl,
    );
    if (isUsableCardDisplayName(name, id) && hasImage) continue;
    const lookupName = isUsableCardDisplayName(name, id) ? name : '';
    if (!lookupName) continue;
    try {
      const lookedUp = lookupLocalCardByNameSync(lookupName);
      if (!lookedUp) continue;
      if (!isUsableCardDisplayName(String(card.name || ''), id) && lookedUp.name) {
        card.name = lookedUp.name;
      }
      if (!hasImage && lookedUp.image_uris) {
        card.image_uris = lookedUp.image_uris;
      }
      if (!card.type_line && lookedUp.type_line) {
        card.type_line = lookedUp.type_line;
      }
    } catch {
      // best-effort display repair after Warp World put
    }
  }
}

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

function pickPopulatedZoneArray(...candidates: unknown[]): any[] | undefined {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return undefined;
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

    const playerZones = zones[playerId] || {};
    const mapLibrary = canSyncLibraries ? libraries.get(playerId as PlayerID) : undefined;
    const chosenLibrary = pickPopulatedZoneArray(mapLibrary, playerZones.library, player.library);
    if (chosenLibrary) {
      player.library = chosenLibrary.map((card: any) => ({ ...card, zone: card?.zone || 'library' }));
    }

    const chosenGraveyard = pickPopulatedZoneArray(playerZones.graveyard, player.graveyard);
    if (chosenGraveyard) {
      player.graveyard = chosenGraveyard.map((card: any) => ({ ...card, zone: card?.zone || 'graveyard' }));
    }
    const chosenHand = pickPopulatedZoneArray(playerZones.hand, player.hand);
    if (chosenHand) {
      player.hand = chosenHand.map((card: any) => ({ ...card, zone: card?.zone || 'hand' }));
    }
    if (typeof playerZones.handCount === 'number' && Number.isFinite(playerZones.handCount)) {
      player.handCount = playerZones.handCount;
    }
    const chosenExile = pickPopulatedZoneArray(playerZones.exile, player.exile);
    if (chosenExile) {
      player.exile = chosenExile.map((card: any) => ({ ...card, zone: card?.zone || 'exile' }));
    }
    const chosenCommand = pickPopulatedZoneArray(playerZones.commandZone, player.commandZone);
    if (chosenCommand) {
      player.commandZone = chosenCommand.map((card: any) => ({ ...card, zone: card?.zone || 'command' }));
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
    const ids = new Set<string>();
    const zoneExile = Array.isArray(zones[playerId]?.exile) ? zones[playerId].exile : [];
    const playerExile = Array.isArray(player?.exile) ? player.exile : [];
    for (const card of [...zoneExile, ...playerExile]) {
      const cardId = String(card?.id || '').trim();
      if (cardId) ids.add(cardId);
    }
    out.set(playerId, ids);
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
  const match = effect.match(
    /\bdraw(?:s)?\s+(?:up to\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i,
  );
  if (match) return parseDelayedUpkeepDrawCount(match[1], 1);
  if (/\bdraw a card\b/i.test(effect)) return 1;
  return 1;
}

function delayedUpkeepDrawWho(
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>,
): OraclePlayerSelector {
  const nestedSteps = Array.isArray(step.steps) ? step.steps : [];
  const drawStep = nestedSteps.find((nested) => nested.kind === 'draw') as
    | Extract<OracleEffectStep, { kind: 'draw' }>
    | undefined;
  if (drawStep?.who) return drawStep.who;

  const effect = String(step.effect || '').trim();
  if (/^its controller\b/i.test(effect)) return { kind: 'controller_of_referenced_object' };
  if (/^(?:that player|they)\b/i.test(effect)) return { kind: 'target_player' };
  return { kind: 'you' };
}

function resolveDelayedUpkeepDrawPlayerId(params: {
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>;
  state: any;
  irCtx?: OracleIRExecutionContext;
  fallbackController: string;
  stackBefore?: ReadonlyArray<{ id?: string; controller?: string }>;
}): string {
  const fallback = String(params.fallbackController || '').trim();
  const who = delayedUpkeepDrawWho(params.step);
  if (!who || who.kind === 'you') return fallback;

  const irCtx = params.irCtx;
  const spellId = String(
    irCtx?.targetSpellId
    || irCtx?.selectorContext?.targetSpellId
    || (Array.isArray(irCtx?.selectorContext?.chosenObjectIds) ? irCtx?.selectorContext?.chosenObjectIds[0] : '')
    || '',
  ).trim();

  if (who.kind === 'controller_of_referenced_object') {
    const fromBefore = (params.stackBefore || []).find((entry) => String(entry?.id || '').trim() === spellId);
    const beforeController = String(fromBefore?.controller || '').trim();
    if (beforeController) return beforeController;

    const onStack = Array.isArray(params.state?.stack)
      ? params.state.stack.find((entry: any) => String(entry?.id || '').trim() === spellId)
      : undefined;
    const stackController = String(onStack?.controller || onStack?.owner || '').trim();
    if (stackController) return stackController;
  }

  if (irCtx) {
    const resolved = resolvePlayers(params.state, who, irCtx);
    const first = String(resolved[0] || '').trim();
    if (first) return first;
  }

  return fallback;
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
    state?: any;
    irCtx?: OracleIRExecutionContext;
    stackBefore?: ReadonlyArray<{ id?: string; controller?: string }>;
  },
): void {
  const delayedDrawSteps = (result.appliedSteps || []).filter(isScheduleDelayedUpkeepDrawStep);
  if (delayedDrawSteps.length === 0) return;

  const casterId = String(params.controller || '').trim();
  if (!casterId) return;

  const sourceName = String(params.sourceName || 'Delayed trigger').trim() || 'Delayed trigger';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const state = params.state ?? (ctx as any).state;

  for (const step of delayedDrawSteps) {
    const playerId = resolveDelayedUpkeepDrawPlayerId({
      step,
      state,
      irCtx: params.irCtx,
      fallbackController: casterId,
      stackBefore: params.stackBefore,
    });
    if (!playerId) continue;
    scheduleDelayedDrawAtNextUpkeep(ctx, {
      playerId,
      createdBy: casterId,
      sourceName,
      sourceId,
      count: parseDelayedUpkeepDrawCountFromStep(step),
      ...(delayedUpkeepDrawIsUpToFromStep(step) ? { upTo: true } : null),
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

export interface SyncOracleIRPlayerZonesOptions {
  /** Direct IR apply already queued mill triggers before this sync. */
  readonly skipProcessMillTriggers?: boolean;
}

export function syncOracleIRPlayerZonesToContext(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  graveyardBefore: Map<string, Set<string>>,
  options?: SyncOracleIRPlayerZonesOptions,
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

    // Copy the post-mill library before graveyard-from-anywhere shuffles.
    // Kozilek and Gaea's Blessing shuffle into ctx.libraries; copying
    // player.library afterwards puts the milled library back.
    if (canSyncLibraries && Array.isArray(player.library)) {
      libraries!.set(playerId as PlayerID, [...player.library]);
      playerZones.library = [...player.library];
      playerZones.libraryCount = player.library.length;
      changed = true;
    }

    if (Array.isArray(player.graveyard)) {
      const previousIds = graveyardBefore.get(playerId) || new Set<string>();
      const newlyMilled = player.graveyard.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && !previousIds.has(cardId);
      });
      // Counter spell writes the card onto player.graveyard before this sync.
      // The post-resolution id snapshot already contains it, so compare against
      // the zone copy that has not been overwritten yet. Backgrounds are
      // enchantments; the offer itself does not require a creature.
      const zoneIdsBeforeCopy = new Set(
        (Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [])
          .map((card: any) => String(card?.id || '').trim())
          .filter(Boolean),
      );
      const arrivedInGraveyard = player.graveyard.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && !zoneIdsBeforeCopy.has(cardId);
      });
      const commanderArrivals = [...arrivedInGraveyard];
      for (const card of newlyMilled) {
        const cardId = String(card?.id || '').trim();
        if (cardId && !commanderArrivals.some((entry: any) => String(entry?.id || '').trim() === cardId)) {
          commanderArrivals.push(card);
        }
      }

      playerZones.graveyard = [...player.graveyard];
      playerZones.graveyardCount = player.graveyard.length;
      changed = true;

      if (commanderArrivals.length > 0) {
        offerCommanderZoneChoiceForArrivals(ctx, playerId, commanderArrivals, 'graveyard');
      }

      for (const card of newlyMilled) {
        recordCardPutIntoGraveyardThisTurn(ctx, playerId, card, { fromBattlefield: false });
        checkGraveyardTrigger(
          ctx,
          card,
          playerId,
          String((card as any)?.putIntoGraveyardFrom || ''),
        );
      }
      if (newlyMilled.length > 0 && options?.skipProcessMillTriggers !== true) {
        try {
          processMillTriggers(ctx, playerId, newlyMilled, controller);
        } catch {
          // best-effort
        }
      }
    }

    if (Array.isArray(player.exile)) {
      const previousExileIds = new Set(
        (Array.isArray(playerZones.exile) ? playerZones.exile : [])
          .map((card: any) => String(card?.id || '').trim())
          .filter(Boolean),
      );
      const newlyExiled = player.exile.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && !previousExileIds.has(cardId);
      });
      playerZones.exile = [...player.exile];
      playerZones.exileCount = player.exile.length;
      changed = true;
      if (newlyExiled.length > 0) {
        offerCommanderZoneChoiceForArrivals(ctx, playerId, newlyExiled, 'exile');
      }
    }

    if (Array.isArray(player.commandZone)) {
      playerZones.commandZone = [...player.commandZone];
      playerZones.commandZoneCount = player.commandZone.length;
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

export function syncAllOracleIRPlayerZonesAfterResolution(
  ctx: GameContext,
  options?: SyncOracleIRPlayerZonesOptions & {
    /** Graveyard ids from before the effect. A snapshot taken after the mill hides new cards. */
    readonly graveyardBefore?: Map<string, Set<string>>;
  },
): void {
  const state = (ctx as any).state;
  if (!state) return;
  const graveyardBefore = options?.graveyardBefore ?? snapshotGraveyardCardIds(state);
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (playerId) {
      syncOracleIRPlayerZonesToContext(ctx, state, playerId, graveyardBefore, options);
    }
  }
}

