/**
 * state/modules/applyEventReplayZoneCommanderManaHelpers.ts
 *
 * Replay helpers for commander/zone lookups, battlefield return characteristics,
 * dungeon step matchers, queued-step cleanup, and mana/life payment replay.
 *
 * Split from applyEventReplayHelpers.ts (with card-move/library helpers elsewhere).
 */

import type { GameContext } from "../context.js";
import { calculateAllPTBonuses, calculateVariablePT, parsePT } from "../utils.js";
import { recordDurablePermissionUse } from "./durable-permissions.js";
import { resolveCastPermissionId } from "./castIntent.js";
import { ResolutionQueueManager, ResolutionStepType } from "../resolution/index.js";
import { calculateManaProduction, getOrInitManaPool } from "../../socket/util.js";
import { applyManaAbilityLifeEffectToState, resolveManaAbilityLifeEffect } from "./mana-abilities-handlers/manaAbilitySelfDamage.js";

export function getReplayStartingPlayerId(state: any): string {
  return String(state?.startingPlayerId || state?.startingPlayer || state?.turnPlayer || '').trim();
}

export function getReplayOpeningHandBattlefieldCounters(state: any, card: any, playerId?: string): Record<string, number> {
  const cardName = String(card?.name || '').toLowerCase();
  const startingPlayerId = getReplayStartingPlayerId(state);
  if (cardName === 'gemstone caverns' && startingPlayerId && playerId && playerId !== startingPlayerId) {
    return { luck: 1 };
  }
  return {};
}

export function replayAddCreatureType(permanent: any, typeToAdd: string): void {
  if (!permanent?.card) {
    permanent.card = permanent.card || {};
  }
  const formattedType = String(typeToAdd || '').trim().replace(/^./, (char) => char.toUpperCase());
  if (!formattedType) return;
  const currentTypeLine = String(permanent.card.type_line || '');
  if (currentTypeLine.toLowerCase().includes(formattedType.toLowerCase())) {
    return;
  }
  permanent.card.type_line = currentTypeLine.includes('â€”')
    ? `${currentTypeLine} ${formattedType}`
    : `${currentTypeLine} â€” ${formattedType}`;
}

export function markReplayPermanentEnteredFromZone(permanent: any, zone: string): void {
  const normalizedZone = String(zone || '').trim().toLowerCase();
  if (!permanent || !normalizedZone) return;

  permanent.enteredFromZone = normalizedZone;
  if (normalizedZone === 'graveyard') {
    permanent.enteredFromGraveyard = true;
  }

  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card = {
      ...(permanent.card as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }

  if (permanent.faceUpCard && typeof permanent.faceUpCard === 'object') {
    permanent.faceUpCard = {
      ...(permanent.faceUpCard as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }
}

export function applyReplayBattlefieldReturnCharacteristics(permanent: any, metadata: any): void {
  if (!permanent || !metadata) return;

  const setTypeLine = String(metadata?.battlefieldSetTypeLine || '').trim();
  if (setTypeLine) {
    permanent.card = { ...(permanent.card || {}), type_line: setTypeLine };
    const isCreature = setTypeLine.toLowerCase().includes('creature');
    if (isCreature) {
      permanent.basePower = parsePT(permanent.card?.power);
      permanent.baseToughness = parsePT(permanent.card?.toughness);
      permanent.summoningSickness = true;
    } else {
      delete permanent.basePower;
      delete permanent.baseToughness;
      delete permanent.summoningSickness;
      delete permanent.card.power;
      delete permanent.card.toughness;
    }
  }

  if (typeof metadata?.battlefieldSetOracleText === 'string') {
    permanent.card = { ...(permanent.card || {}), oracle_text: String(metadata.battlefieldSetOracleText) };
  }

  if (metadata?.battlefieldLoseAllOtherTypes === true && setTypeLine) {
    delete permanent.addedTypes;
    delete permanent.grantedTypes;
  }

  const grantedTypes = Array.isArray(metadata?.battlefieldGrantedTypes) ? metadata.battlefieldGrantedTypes : [];
  for (const typeName of grantedTypes) {
    replayAddCreatureType(permanent, String(typeName || ''));
  }
}

export function resolveReplayCommanderId(ctx: any, event: any): string {
  const explicitCommanderId = String(event?.commanderId || '').trim();
  if (explicitCommanderId) return explicitCommanderId;

  const playerId = String(event?.playerId || '').trim();
  const commanderInfo = playerId ? (ctx?.state as any)?.commandZone?.[playerId] : undefined;
  const knownCommanderIds = Array.isArray(commanderInfo?.commanderIds)
    ? commanderInfo.commanderIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];

  const fallbackIds = [event?.cardId, event?.card?.id]
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);

  for (const fallbackId of fallbackIds) {
    if (knownCommanderIds.length === 0 || knownCommanderIds.includes(fallbackId)) {
      return fallbackId;
    }
  }

  const fallbackNames = [event?.cardName, event?.card?.name]
    .map((name: any) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  const commanderCards = Array.isArray(commanderInfo?.commanderCards) ? commanderInfo.commanderCards : [];
  for (const fallbackName of fallbackNames) {
    const matchedCommander = commanderCards.find((card: any) => String(card?.name || '').trim().toLowerCase() === fallbackName);
    const matchedId = String(matchedCommander?.id || '').trim();
    if (matchedId) {
      return matchedId;
    }
  }

  return '';
}

export function normalizeReplayEffectProgramMetadata(metadata: any): Record<string, any> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const effectProgramId = String(metadata.effectProgramId || '').trim();
  const effectProgramStepId = String(metadata.effectProgramStepId || '').trim();
  if (!effectProgramId || !effectProgramStepId) {
    return undefined;
  }

  return {
    effectProgramId,
    effectProgramFamily: metadata.effectProgramFamily ? String(metadata.effectProgramFamily) : undefined,
    effectProgramSourceId: metadata.effectProgramSourceId ? String(metadata.effectProgramSourceId) : undefined,
    effectProgramSourceName: metadata.effectProgramSourceName ? String(metadata.effectProgramSourceName) : undefined,
    effectProgramCursor: Number(metadata.effectProgramCursor || 0),
    effectProgramStepId,
    effectProgramBindingKey: String(metadata.effectProgramBindingKey || ''),
    effectProgramClause: metadata.effectProgramClause,
  };
}

export function normalizeChosenTargetRefs(state: any, spec: any, chosen: any[]): any[] {
  return (Array.isArray(chosen) ? chosen : []).map((target: any) => {
    if (!target || typeof target !== 'string') return target;

    if (
      spec?.op === 'COUNTER_TARGET_SPELL' ||
      spec?.op === 'COUNTER_TARGET_ABILITY' ||
      (Array.isArray(state?.stack) && state.stack.some((stackItem: any) => String(stackItem?.id || '') === target))
    ) {
      return { kind: 'stack', id: target };
    }

    if (Array.isArray(state?.players) && state.players.some((player: any) => String(player?.id || '') === target)) {
      return { kind: 'player', id: target };
    }

    return { kind: 'permanent', id: target };
  });
}

export function resolveReplayCommanderCard(ctx: any, event: any, commanderId: string): any | undefined {
  if (event?.card && typeof event.card === 'object' && !Array.isArray(event.card)) {
    return event.card;
  }

  const playerId = String(event?.playerId || '').trim();
  const commanderInfo = playerId ? (ctx?.state as any)?.commandZone?.[playerId] : undefined;
  const commanderCards = Array.isArray(commanderInfo?.commanderCards) ? commanderInfo.commanderCards : [];

  if (commanderId) {
    const matchedById = commanderCards.find((card: any) => String(card?.id || '').trim() === commanderId);
    if (matchedById) return matchedById;
  }

  const fallbackNames = [event?.cardName, event?.card?.name]
    .map((name: any) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  for (const fallbackName of fallbackNames) {
    const matchedByName = commanderCards.find((card: any) => String(card?.name || '').trim().toLowerCase() === fallbackName);
    if (matchedByName) return matchedByName;
  }

  return undefined;
}

export function getReplayLibraryForPlayer(ctx: any, playerId: string): any[] {
  const fromMap = ctx?.libraries?.get?.(playerId);
  const fromObject = ctx?.libraries?.[playerId];
  const fromZones = (ctx?.state as any)?.zones?.[playerId]?.library;
  if (Array.isArray(fromMap) && fromMap.length > 0) return fromMap;
  if (Array.isArray(fromObject) && fromObject.length > 0) return fromObject;
  if (Array.isArray(fromZones) && fromZones.length > 0) return fromZones;
  if (Array.isArray(fromMap)) return fromMap;
  if (Array.isArray(fromObject)) return fromObject;
  if (Array.isArray(fromZones)) return fromZones;
  return [];
}

export function findReplayCardInZone(ctx: any, playerId: string, zone: string, cardId: string): any | undefined {
  const normalizedZone = String(zone || '').toLowerCase().trim();
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedZone || !normalizedCardId) return undefined;

  if (normalizedZone === 'library') {
    return getReplayLibraryForPlayer(ctx, playerId).find((card: any) => String(card?.id || '') === normalizedCardId);
  }

  const zoneCards = (ctx?.state as any)?.zones?.[playerId]?.[normalizedZone];
  if (Array.isArray(zoneCards)) {
    const card = zoneCards.find((entry: any) => String(entry?.id || '') === normalizedCardId);
    if (card) return card;
  }

  if (normalizedZone === 'exile') {
    const zones = (ctx?.state as any)?.zones;
    if (zones && typeof zones === 'object') {
      for (const playerZones of Object.values(zones) as any[]) {
        const exileCards = Array.isArray(playerZones?.exile) ? playerZones.exile : [];
        const card = exileCards.find((entry: any) => String(entry?.id || '') === normalizedCardId);
        if (card) return card;
      }
    }
  }

  const playerEntry = Array.isArray((ctx?.state as any)?.players)
    ? ((ctx.state as any).players as any[]).find((entry: any) => String(entry?.id || '') === playerId)
    : undefined;
  const playerZoneCards = playerEntry && Array.isArray(playerEntry[normalizedZone]) ? playerEntry[normalizedZone] : [];
  return playerZoneCards.find((entry: any) => String(entry?.id || '') === normalizedCardId);
}

export function resolveReplayCardForPermissionUse(ctx: any, event: any, zone: string, cardData: any): any {
  if (cardData && typeof cardData === 'object') return cardData;

  const playerId = String(event?.playerId || '').trim();
  const cardId = String(cardData || '').trim();
  if (!playerId || !cardId) return { id: cardId || cardData };

  if (zone === 'command') {
    return resolveReplayCommanderCard(ctx, event, cardId) || { id: cardId };
  }

  return findReplayCardInZone(ctx, playerId, zone, cardId) || { id: cardId };
}

export function recordReplayDurablePermissionUse(state: any, permission: any): void {
  if (!permission) return;
  const permissionId = resolveCastPermissionId(permission)
    || String(typeof permission === 'string' ? permission : permission?.id || '').trim();
  if (!permissionId && typeof permission?.kind !== 'string') return;
  recordDurablePermissionUse(
    state,
    typeof permission?.kind === 'string' ? permission : permissionId,
  );
}
/* -------- Helpers ---------- */

/**
 * Generate a deterministic ID for permanents during replay.
 * Uses the game's RNG if available, otherwise uses a counter based on the card ID.
 * This ensures IDs are consistent across replays with the same RNG seed.
 */
export function generateDeterministicId(ctx: any, prefix: string, cardId: string): string {
  // Use the game's RNG if available for deterministic ID generation
  if (typeof ctx.rng === 'function') {
    const rngValue = Math.floor(ctx.rng() * 0xFFFFFFFF).toString(36);
    return `${prefix}_${cardId}_${rngValue}`;
  }
  // Fallback: use card ID with a counter (incremented on ctx)
  ctx._idCounter = (ctx._idCounter || 0) + 1;
  return `${prefix}_${cardId}_${ctx._idCounter}`;
}

export function getCurrentCombatPowerSnapshot(permanent: any, state: any): number {
  const card = permanent?.card || {};

  let basePower = parsePT((permanent as any)?.basePower);
  if (!Number.isFinite(basePower as number)) {
    basePower = parsePT(card?.power);
  }

  if (!Number.isFinite(basePower as number)) {
    const variablePT = calculateVariablePT({ ...(card || {}), controller: (permanent as any)?.controller }, state);
    if (variablePT && Number.isFinite(variablePT.power)) {
      basePower = Number(variablePT.power);
    }
  }

  const plusCounters = Number((permanent as any)?.counters?.['+1/+1'] || 0);
  const minusCounters = Number((permanent as any)?.counters?.['-1/-1'] || 0);
  let otherCounterPower = 0;

  if ((permanent as any)?.counters && typeof (permanent as any).counters === 'object') {
    for (const [counterType, amountRaw] of Object.entries((permanent as any).counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = String(counterType).match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (!counterMatch) continue;
      otherCounterPower += parseInt(counterMatch[1], 10) * Number(amountRaw || 0);
    }
  }

  const allBonuses = calculateAllPTBonuses(permanent, state);
  return Math.max(
    0,
    Number(basePower || 0) + plusCounters - minusCounters + otherCounterPower + Number(allBonuses.power || 0)
  );
}

export function clearReplayDanceWithCalamitySteps(gameId: string, playerId: string, effectId: string): void {
  if (!gameId) return;

  try {
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    const matchesDanceStep = (step: any): boolean => {
      if (!step) return false;
      const stepType = String(step?.type || '');
      if (String(step?.playerId || '') !== playerId) return false;

      if (stepType === String(ResolutionStepType.DANCE_WITH_CALAMITY) || stepType === String(ResolutionStepType.DANCE_WITH_CALAMITY_CAST)) {
        return !effectId || String(step?.effectId || '') === effectId;
      }

      if (stepType === String(ResolutionStepType.OPTION_CHOICE) && (step as any)?.danceWithCalamityCastPrompt === true) {
        return !effectId || String((step as any)?.danceWithCalamityEffectId || '') === effectId;
      }

      return false;
    };

    const activeStepMatched = matchesDanceStep(queue?.activeStep);
    const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

    if (activeStepMatched) {
      queue.activeStep = undefined;
    }
    if (Array.isArray(queue?.steps) && beforeCount > 0) {
      queue.steps = queue.steps.filter((step: any) => !matchesDanceStep(step));
    }
    if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
      queue.seq = Number(queue?.seq || 0) + 1;
    }
  } catch {
    // best-effort only
  }
}

export function clearReplayQueuedSteps(gameId: string, predicate: (step: any) => boolean): void {
  if (!gameId) return;

  try {
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    const activeStepMatched = predicate(queue?.activeStep);
    const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

    if (activeStepMatched) {
      queue.activeStep = undefined;
    }
    if (Array.isArray(queue?.steps) && beforeCount > 0) {
      queue.steps = queue.steps.filter((step: any) => !predicate(step));
    }
    if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
      queue.seq = Number(queue?.seq || 0) + 1;
    }
  } catch {
    // best-effort only
  }
}

export function clearReplayQueuedStepById(gameId: string, resolvedStepId: string): void {
  const stepId = String(resolvedStepId || '').trim();
  if (!gameId || !stepId) return;

  clearReplayQueuedSteps(gameId, (step: any) => String(step?.id || '').trim() === stepId);
}

export function cloneReplayPayload<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function incrementReplayTokenCreatedTracking(state: any, controllerId: string, amount: number): void {
  const count = Math.max(0, Math.floor(Number(amount || 0)));
  if (!state || !controllerId || count <= 0) return;

  state.tokensCreatedThisTurn = state.tokensCreatedThisTurn || {};
  state.tokenCreatedThisTurn = state.tokenCreatedThisTurn || {};
  state.createdTokenThisTurn = state.createdTokenThisTurn || {};
  state.tokensCreatedThisTurn[controllerId] = Number(state.tokensCreatedThisTurn[controllerId] || 0) + count;
  state.tokenCreatedThisTurn[controllerId] = Number(state.tokenCreatedThisTurn[controllerId] || 0) + count;
  state.createdTokenThisTurn[controllerId] = Number(state.createdTokenThisTurn[controllerId] || 0) + count;
}

export function matchesMirrormindOriginalReplayToken(permanent: any, original: any, controllerId: string, desiredTokenIds: Set<string>): boolean {
  if (!permanent || permanent.isToken !== true) return false;
  if (desiredTokenIds.has(String(permanent.id || ''))) return false;
  if (controllerId && String(permanent.controller || '') !== controllerId) return false;

  const originalName = String(original?.name || '').trim();
  if (originalName && String(permanent?.card?.name || '').trim() !== originalName) return false;

  const originalTypeLine = String(original?.options?.typeLine || '').trim();
  if (originalTypeLine && String(permanent?.card?.type_line || '').trim() !== originalTypeLine) return false;

  if (original?.basePower != null && Number(permanent?.basePower) !== Number(original.basePower)) return false;
  if (original?.baseToughness != null && Number(permanent?.baseToughness) !== Number(original.baseToughness)) return false;

  return true;
}

export function restoreMirrormindReplayTokens(ctx: GameContext, event: any): void {
  const state = ctx.state as any;
  state.battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];

  const controllerId = String(event?.playerId || event?.mirrormindCrownOriginalTokenCreate?.controller || '').trim();
  const original = event?.mirrormindCrownOriginalTokenCreate || {};
  const snapshots = Array.isArray(event?.createdTokenPermanents)
    ? event.createdTokenPermanents.filter((entry: any) => entry && typeof entry === 'object')
    : [];
  const desiredTokenIds = new Set<string>(snapshots.map((entry: any) => String(entry?.id || '')).filter(Boolean));

  let removedReplayCreatedOriginals = 0;
  if (desiredTokenIds.size > 0) {
    state.battlefield = state.battlefield.filter((permanent: any) => {
      if (!matchesMirrormindOriginalReplayToken(permanent, original, controllerId, desiredTokenIds)) {
        return true;
      }
      removedReplayCreatedOriginals += 1;
      return false;
    });
  }

  let addedSnapshots = 0;
  for (const snapshot of snapshots) {
    const snapshotId = String(snapshot?.id || '').trim();
    if (!snapshotId) continue;
    const alreadyPresent = state.battlefield.some((permanent: any) => String(permanent?.id || '') === snapshotId);
    if (alreadyPresent) continue;
    state.battlefield.push(cloneReplayPayload(snapshot));
    addedSnapshots += 1;
  }

  const equipmentId = String(event?.mirrormindCrownEquipmentId || event?.sourceId || '').trim();
  if (equipmentId) {
    state.mirrormindCrownUsedThisTurn = state.mirrormindCrownUsedThisTurn || {};
    state.mirrormindCrownUsedThisTurn[equipmentId] = true;
  }

  incrementReplayTokenCreatedTracking(state, controllerId, Math.max(0, addedSnapshots - removedReplayCreatedOriginals));
}

export function removeReplayCommanderCardFromZones(state: any, playerId: string, commanderId: string, cardId: string): void {
  const zones = state?.zones?.[playerId];
  const ids = new Set([commanderId, cardId].map((id) => String(id || '').trim()).filter(Boolean));
  if (ids.size === 0) return;

  const removeFromArrayZone = (zoneName: string) => {
    const zone = zones?.[zoneName];
    if (!Array.isArray(zone)) return;
    zones[zoneName] = zone.filter((card: any) => !ids.has(String(card?.id || '')));
    const countKey = `${zoneName}Count`;
    if (typeof zones[countKey] === 'number') zones[countKey] = zones[zoneName].length;
  };

  for (const zoneName of ['commandZone', 'graveyard', 'exile', 'hand', 'library']) {
    removeFromArrayZone(zoneName);
  }

  if (Array.isArray(state?.battlefield)) {
    state.battlefield = state.battlefield.filter((permanent: any) => {
      const permanentId = String(permanent?.id || '').trim();
      const permanentCardId = String(permanent?.card?.id || '').trim();
      return !ids.has(permanentId) && !ids.has(permanentCardId);
    });
  }
}

export function putReplayCommanderCardInDestination(ctx: GameContext, playerId: string, destinationZone: string, libraryPosition: string, card: any, exileTag?: any): void {
  if (!playerId || !card || typeof card !== 'object') return;
  const state = ctx.state as any;
  state.zones = state.zones || {};
  const zones = state.zones[playerId] = state.zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };

  const zoneName = ['graveyard', 'exile', 'hand', 'library'].includes(destinationZone) ? destinationZone : 'graveyard';
  const zoneCard = {
    ...cloneReplayPayload(card),
    ...(zoneName === 'exile' && exileTag && typeof exileTag === 'object' ? cloneReplayPayload(exileTag) : {}),
    zone: zoneName,
  };
  const cardId = String(zoneCard.id || '').trim();

  if (zoneName === 'library') {
    const libraryFromContext = (ctx as any).libraries?.get?.(playerId);
    const library = Array.isArray(libraryFromContext)
      ? libraryFromContext
      : (Array.isArray(zones.library) ? zones.library : (zones.library = []));
    const alreadyPresent = library.some((entry: any) => cardId && String(entry?.id || '') === cardId);
    if (!alreadyPresent) {
      if (libraryPosition === 'bottom' || libraryPosition === 'shuffle') {
        library.push(zoneCard);
      } else {
        library.unshift(zoneCard);
      }
    }
    zones.libraryCount = library.length;
    if ((ctx as any).libraries?.set) (ctx as any).libraries.set(playerId, library);
    return;
  }

  zones[zoneName] = Array.isArray(zones[zoneName]) ? zones[zoneName] : [];
  const alreadyPresent = zones[zoneName].some((entry: any) => cardId && String(entry?.id || '') === cardId);
  if (!alreadyPresent) {
    zones[zoneName].push(zoneCard);
    const countKey = `${zoneName}Count`;
    zones[countKey] = zones[zoneName].length;
  }
}

export function addReplayQueuedStepIfMissing(
  gameId: string,
  rawQueuedStep: unknown,
  defaults: { playerId?: string; description?: string } = {}
): void {
  if (!gameId || !rawQueuedStep || typeof rawQueuedStep !== 'object' || Array.isArray(rawQueuedStep)) return;

  const queuedStep = rawQueuedStep as Record<string, any>;
  const queuedStepType = String(queuedStep.type || '').trim();
  if (!queuedStepType) return;

  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const queuedStepId = String(queuedStep.id || '').trim();
  const alreadyPresent = Boolean(
    (queuedStepId && queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
    (queuedStepId && Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
  );
  if (alreadyPresent) return;

  ResolutionQueueManager.addStep(gameId, {
    ...queuedStep,
    ...(queuedStepId ? { id: queuedStepId } : {}),
    type: queuedStepType as any,
    playerId: String(queuedStep.playerId || defaults.playerId || '') as any,
    description: String(queuedStep.description || defaults.description || ''),
    mandatory: queuedStep.mandatory !== false,
  } as any);
}

export function matchesDungeonRoomPenaltyChoiceStep(step: any, event: any): boolean {
  const stepChoice = step?.dungeonRoomPenaltyChoice;
  if (!stepChoice || !event) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepChoice?.dungeonId || '').trim() === String(event?.dungeonId || '').trim() &&
    String(stepChoice?.roomId || '').trim() === String(event?.currentRoomId || '').trim()
  );
}

export function matchesDungeonRoomPaymentStep(step: any, event: any): boolean {
  const stepPayment = step?.dungeonRoomPayment;
  const eventPayment = event?.dungeonRoomPayment;
  if (!stepPayment || !eventPayment) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepPayment?.dungeonId || '').trim() === String(eventPayment?.dungeonId || '').trim() &&
    String(stepPayment?.roomId || '').trim() === String(eventPayment?.roomId || '').trim() &&
    String(stepPayment?.paymentType || '').trim() === String(eventPayment?.paymentType || '').trim()
  );
}

export function matchesSacrificeSelectionResolveStep(step: any, event: any): boolean {
  if (!step || !event || step?.sacrificeSelection !== true) return false;

  const stepPlayerId = String(step?.playerId || '').trim();
  const eventPlayerId = String(event?.playerId || '').trim();
  if (stepPlayerId !== eventPlayerId) return false;

  const stepSourceId = String(step?.sourceId || '').trim();
  const eventSourceId = String(event?.sourceId || '').trim();
  if (stepSourceId && eventSourceId && stepSourceId !== eventSourceId) return false;

  const stepSourceName = String(step?.sacrificeSourceName || step?.sourceName || '').trim();
  const eventSourceName = String(event?.sourceName || '').trim();
  if (stepSourceName && eventSourceName && stepSourceName !== eventSourceName) return false;

  return String(step?.sacrificePermanentType || 'permanent').trim() === String(event?.permanentType || 'permanent').trim();
}

export function matchesDungeonRoomFreeCastChoiceStep(step: any, event: any): boolean {
  const stepChoice = step?.dungeonRoomFreeCastFromHandChoice;
  if (!stepChoice || !event) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepChoice?.dungeonId || '').trim() === String(event?.dungeonId || '').trim() &&
    String(stepChoice?.roomId || '').trim() === String(event?.currentRoomId || '').trim()
  );
}

export function matchesDungeonRoomThroneChoiceStep(step: any, event: any): boolean {
  const stepChoice = step?.dungeonRoomThroneChoice;
  if (!stepChoice || !event) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepChoice?.dungeonId || '').trim() === String(event?.dungeonId || '').trim() &&
    String(stepChoice?.roomId || '').trim() === String(event?.currentRoomId || '').trim()
  );
}

export function ensureReplayPlayerZones(stateAny: any, playerId: string): any {
  const zones = stateAny.zones = stateAny.zones || {};
  return (zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
}

export function mergeCardsIntoReplayExile(playerZones: any, cards: any[]): void {
  const exile = playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];
  const byId = new Set(exile.map((card: any) => String(card?.id || '')).filter(Boolean));
  for (const card of Array.isArray(cards) ? cards : []) {
    const cardId = String(card?.id || '').trim();
    if (!cardId || byId.has(cardId)) continue;
    exile.push({ ...card, zone: 'exile' });
    byId.add(cardId);
  }
  playerZones.exileCount = exile.length;
}

const MANA_CODE_TO_POOL_KEY: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

const MANA_NAME_TO_CODE: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

export function normalizeManaColorCode(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (MANA_CODE_TO_POOL_KEY[upper]) return upper;
  const lower = raw.toLowerCase();
  return MANA_NAME_TO_CODE[lower];
}

export function normalizeRecordedManaMap(raw: unknown): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalized;

  for (const [key, amountRaw] of Object.entries(raw as Record<string, unknown>)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount)) continue;

    const lowerKey = String(key || '').trim().toLowerCase();
    if (lowerKey && Object.values(MANA_CODE_TO_POOL_KEY).includes(lowerKey)) {
      normalized[lowerKey] = (normalized[lowerKey] || 0) + amount;
      continue;
    }

    const code = normalizeManaColorCode(key);
    const poolKey = code ? MANA_CODE_TO_POOL_KEY[code] : undefined;
    if (poolKey) {
      normalized[poolKey] = (normalized[poolKey] || 0) + amount;
    }
  }

  return normalized;
}

export function getPermanentSpellTypeWords(card: any): string[] {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return ['artifact', 'creature', 'enchantment', 'planeswalker', 'battle']
    .filter((typeWord) => new RegExp(`\\b${typeWord}\\b`, 'i').test(typeLine));
}

export function recordGraveyardPermanentTypesCastThisTurn(state: any, playerId: string, card: any): void {
  const permanentTypes = getPermanentSpellTypeWords(card);
  if (permanentTypes.length === 0) return;

  state.graveyardPermanentTypesCastThisTurn = state.graveyardPermanentTypesCastThisTurn || {};
  const playerEntry = state.graveyardPermanentTypesCastThisTurn[String(playerId)] =
    state.graveyardPermanentTypesCastThisTurn[String(playerId)] || {};

  for (const typeWord of permanentTypes) {
    playerEntry[typeWord] = true;
  }
}

export function inferLegacyManaReplay(rawState: any, permanent: any, playerId: string, manaColor: unknown, abilityId?: unknown): Record<string, number> {
  const chosenColor = normalizeManaColorCode(manaColor);
  const manaProduction = calculateManaProduction(rawState, permanent, playerId, chosenColor, abilityId != null ? String(abilityId) : undefined);
  const addsAllColorsAtOnce = Array.isArray(manaProduction.colors)
    && manaProduction.requiresColorChoice !== true
    && manaProduction.colors.length > 1;
  if (addsAllColorsAtOnce) {
    const amountPerColor = Math.max(1, Math.floor(Number(manaProduction.totalAmount || 0) / manaProduction.colors.length));
    const replayAddedMana: Record<string, number> = {};
    for (const manaSymbol of manaProduction.colors) {
      const poolKey = MANA_CODE_TO_POOL_KEY[String(manaSymbol || '').toUpperCase()];
      if (!poolKey) continue;
      replayAddedMana[poolKey] = Number(replayAddedMana[poolKey] || 0) + amountPerColor;
    }
    return replayAddedMana;
  }

  const producedColor = chosenColor || normalizeManaColorCode(manaProduction.colors?.[0]);
  const poolKey = producedColor ? MANA_CODE_TO_POOL_KEY[producedColor] : undefined;
  if (!poolKey) return {};

  return {
    [poolKey]: Number(manaProduction.totalAmount || 0),
  };
}

export function applyRecordedManaToPool(ctx: any, playerId: string, rawMana: unknown): void {
  const normalized = normalizeRecordedManaMap(rawMana);
  if (Object.keys(normalized).length === 0) return;

  const pool = getOrInitManaPool(ctx.state, playerId);
  for (const [poolKey, amount] of Object.entries(normalized)) {
    pool[poolKey] = Number(pool[poolKey] || 0) + Number(amount || 0);
  }
}

export function inferLegacyManaLifeEffect(permanent: any, manaColor: unknown): { amount: number; isDamage: boolean } {
  const chosenColor = normalizeManaColorCode(manaColor);
  return resolveManaAbilityLifeEffect({
    card: permanent?.card,
    producesColoredMana: chosenColor !== 'C',
  });
}

export function getReplayManaActivationCostKey(playerId: string, permanentId: unknown, abilityId?: unknown): string {
  const normalizedPlayerId = String(playerId || '').trim();
  const normalizedPermanentId = String(permanentId || '').trim();
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedPlayerId || !normalizedPermanentId) {
    return '';
  }

  return normalizedAbilityId
    ? `${normalizedPlayerId}:${normalizedPermanentId}:${normalizedAbilityId}`
    : `${normalizedPlayerId}:${normalizedPermanentId}`;
}

export function rememberReplayManaActivationLifeCost(rawState: any, playerId: string, permanentId: unknown, abilityId: unknown, paidLife: number): void {
  const key = getReplayManaActivationCostKey(playerId, permanentId, abilityId);
  const finalPaidLife = Number(paidLife || 0);
  if (!key || !Number.isFinite(finalPaidLife) || finalPaidLife <= 0) {
    return;
  }

  const stateAny = rawState as any;
  stateAny._replayManaActivationLifeCosts = stateAny._replayManaActivationLifeCosts || {};
  stateAny._replayManaActivationLifeCosts[key] = finalPaidLife;
}

export function consumeReplayManaActivationLifeCost(rawState: any, playerId: string, permanentId: unknown, abilityId: unknown): number {
  const key = getReplayManaActivationCostKey(playerId, permanentId, abilityId);
  if (!key) {
    return 0;
  }

  const stateAny = rawState as any;
  const markerMap = stateAny._replayManaActivationLifeCosts;
  if (!markerMap || typeof markerMap !== 'object') {
    return 0;
  }

  const paidLife = Number(markerMap[key] || 0);
  delete markerMap[key];
  if (Object.keys(markerMap).length === 0) {
    delete stateAny._replayManaActivationLifeCosts;
  }

  return Number.isFinite(paidLife) && paidLife > 0 ? paidLife : 0;
}

export function applyManaAbilityLifeLoss(ctx: any, playerId: string, amount: number, tracksDamage: boolean): void {
  applyManaAbilityLifeEffectToState(ctx?.state, playerId, { amount, isDamage: tracksDamage });
}

export function applyRecordedLifePayment(ctx: GameContext, playerId: string, rawAmount: unknown): void {
  const paidLife = Number(rawAmount || 0);
  if (!playerId || !Number.isFinite(paidLife) || paidLife <= 0) return;

  (ctx.state as any).life = (ctx.state as any).life || {};
  const currentLife = Number((ctx.state as any).life?.[playerId] ?? ctx.state.startingLife ?? 40);
  (ctx.state as any).life[playerId] = Math.max(0, currentLife - paidLife);
  (ctx as any).life = (ctx as any).life || {};
  (ctx as any).life[playerId] = (ctx.state as any).life[playerId];

  try {
    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
      (((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + paidLife);
  } catch {
    // best-effort only
  }

  const player = ((ctx.state as any).players || []).find((p: any) => p?.id === playerId);
  if (player) {
    player.life = (ctx.state as any).life[playerId];
  }
}
