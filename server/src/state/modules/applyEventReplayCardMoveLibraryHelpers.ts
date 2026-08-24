/**
 * state/modules/applyEventReplayCardMoveLibraryHelpers.ts
 *
 * Replay helpers for hand/battlefield card moves, sacrifice/play-land state,
 * AI activate-ability / opponent-may-pay resolve, and pure library reorder builders.
 *
 * Split from applyEventReplayHelpers.ts (zone/commander/mana helpers elsewhere).
 */

import type { GameContext } from "../context.js";
import type { PlayerID } from "../types.js";
import { recordCardPutIntoGraveyardThisTurn } from "./turn-tracking.js";
import { drawCards } from "./zones.js";
import {
  createToken,
  movePermanentToGraveyard,
  trackPermanentSacrificedThisTurn,
} from "./counters_tokens.js";
import { syncPreparedPermanentAfterControlChange } from "./prepared.js";
import { resolveCastPermissionId } from "./castIntent.js";
import { debugWarn } from "../../utils/debug.js";
import { getOpponentMayPayDrawCount, getOpponentMayPayTreasureCount } from "./opponent-may-pay-utils.js";
import { parseManaCost } from "./mana-check.js";
import { consumeManaFromPool, resolveManaCostForPoolPayment } from "../../socket/util.js";
import {
  generateDeterministicId,
  applyRecordedLifePayment,
} from "./applyEventReplayZoneCommanderManaHelpers.js";
export function buildDisturbCastCard(card: any): any {
  const disturbFace = Array.isArray(card?.card_faces) ? card.card_faces[1] : undefined;
  const manaCost = disturbFace?.mana_cost ?? disturbFace?.manaCost ?? card?.mana_cost ?? card?.manaCost;
  return {
    ...card,
    ...(disturbFace || {}),
    id: card?.id,
    name: disturbFace?.name || card?.name,
    type_line: disturbFace?.type_line || disturbFace?.typeLine || card?.type_line,
    oracle_text: disturbFace?.oracle_text || disturbFace?.oracleText || card?.oracle_text,
    mana_cost: manaCost,
    manaCost,
    colors: Array.isArray(disturbFace?.colors) ? disturbFace.colors : card?.colors,
    image_uris: disturbFace?.image_uris || card?.image_uris,
    faceIndex: disturbFace ? 1 : (card?.faceIndex ?? 0),
    zone: 'stack',
    castWithAbility: 'disturb',
    transformed: true,
  };
}

export function getOrInitReplayPlayerZones(state: any, playerId: string): any {
  state.zones = state.zones || {};
  const zones = (state.zones[playerId] = state.zones[playerId] || {});
  zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
  zones.handCount = Array.isArray(zones.hand) ? zones.hand.length : Number(zones.handCount || 0);
  zones.graveyardCount = Array.isArray(zones.graveyard) ? zones.graveyard.length : Number(zones.graveyardCount || 0);
  zones.exileCount = Array.isArray(zones.exile) ? zones.exile.length : Number(zones.exileCount || 0);
  return zones;
}

export function applyReplayCardUpdates(targetCard: any, rawUpdates: unknown): void {
  if (!targetCard || !rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) return;

  for (const [key, value] of Object.entries(rawUpdates as Record<string, unknown>)) {
    if (!key) continue;
    if (value === null) {
      delete targetCard[key];
      continue;
    }
    if (Array.isArray(value)) {
      targetCard[key] = value.slice();
      continue;
    }
    if (value && typeof value === 'object') {
      targetCard[key] = { ...(value as Record<string, unknown>) };
      continue;
    }
    targetCard[key] = value;
  }
}

export function applyReplayHandCardMove(ctx: GameContext, playerId: string, moveSpec: any): void {
  const cardId = String(moveSpec?.cardId || '').trim();
  const destination = String(moveSpec?.destination || '').trim().toLowerCase();
  if (!playerId || !cardId || !destination) return;

  const zones = getOrInitReplayPlayerZones(ctx.state as any, playerId);
  const hand = zones.hand as any[];
  const handIndex = hand.findIndex((card: any) => card && String(card.id || '') === cardId);
  if (handIndex === -1) return;

  const [card] = hand.splice(handIndex, 1);
  if (!card) return;

  const movedCard = { ...card };
  applyReplayCardUpdates(movedCard, moveSpec?.cardUpdates);

  if (destination === 'graveyard') {
    movedCard.zone = 'graveyard';
    (zones.graveyard as any[]).push(movedCard);
    zones.graveyardCount = (zones.graveyard as any[]).length;
    recordCardPutIntoGraveyardThisTurn(ctx as any, String(playerId), movedCard, { fromBattlefield: false });
  } else if (destination === 'exile') {
    movedCard.zone = 'exile';
    (zones.exile as any[]).push(movedCard);
    zones.exileCount = (zones.exile as any[]).length;
  } else if (destination === 'hand') {
    movedCard.zone = 'hand';
    hand.push(movedCard);
  }

  zones.handCount = hand.length;
}

export function applyReplayCardUpdatesInHand(ctx: GameContext, playerId: string, cardId: string, rawUpdates: unknown): void {
  if (!playerId || !cardId) return;

  const zones = getOrInitReplayPlayerZones(ctx.state as any, playerId);
  const card = (zones.hand as any[]).find((entry: any) => entry && String(entry.id || '') === cardId);
  if (!card) return;

  applyReplayCardUpdates(card, rawUpdates);
}

export function applyReplaySacrificedPermanent(ctx: GameContext, permanentId: string): void {
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return;

  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === normalizedPermanentId);
  if (!permanent) return;

  const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
    ? { ...(permanent.card || {}), zone: 'graveyard' }
    : null;
  const graveyardOwnerId = String(permanent?.owner || permanent?.controller || '').trim();

  try {
    trackPermanentSacrificedThisTurn(ctx.state, permanent);
  } catch {
    // best-effort only
  }

  movePermanentToGraveyard(ctx as any, normalizedPermanentId, true);

  if (tokenGraveyardSnapshot && graveyardOwnerId) {
    const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
    const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

    const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
      if (!card) return false;
      const cardId = String((card as any).id || '').trim();
      const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
      if (cardId && snapshotId) return cardId === snapshotId;
      return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
    });

    if (!alreadyPresent) {
      (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
      playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
    }
  }
}

export function applyRecordedPlayLandReplayState(ctx: GameContext, event: any): void {
  const playerId = String(event?.playerId || '').trim();
  const cardId = String(event?.card?.id || event?.cardId || '').trim();
  const persistedPermanentId = String(event?.permanentId || '').trim();
  const graveyardPermissionId = resolveCastPermissionId(event);
  const graveyardPermissionSourceName = String(event?.graveyardPermissionSourceName || event?.card?.graveyardPermissionSourceName || '').trim();
  if (!playerId || !cardId) return;

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? ((ctx.state as any).battlefield as any[]) : [];
  const permanent = [...battlefield].reverse().find((entry: any) =>
    String(entry?.controller || '') === playerId && String(entry?.card?.id || '') === cardId
  );
  if (!permanent) return;
  if (persistedPermanentId) {
    permanent.id = persistedPermanentId;
  }

  if (graveyardPermissionId) {
    permanent.graveyardPermissionId = graveyardPermissionId;
    permanent.castPermissionId = graveyardPermissionId;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.graveyardPermissionId = graveyardPermissionId;
      permanent.card.castPermissionId = graveyardPermissionId;
    }
  }

  if (graveyardPermissionSourceName) {
    permanent.graveyardPermissionSourceName = graveyardPermissionSourceName;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.graveyardPermissionSourceName = graveyardPermissionSourceName;
    }
  }

  if (typeof event?.entersTapped === 'boolean') {
    permanent.tapped = event.entersTapped;
  }

  if (event?.paidLife != null) {
    applyRecordedLifePayment(ctx, playerId, event.paidLife);
  }
}

export function resolveReplayPermanentByEvent(ctx: GameContext, options: {
  permanentId?: unknown;
  playerId?: unknown;
  cardName?: unknown;
}): any | undefined {
  const requestedPermanentId = String(options?.permanentId || '').trim();
  const playerId = String(options?.playerId || '').trim();
  const cardName = String(options?.cardName || '').trim().toLowerCase();
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  if (battlefield.length === 0) {
    return undefined;
  }

  const stateAny = ctx.state as any;
  const replayPermanentAliases = (stateAny.replayPermanentAliases = stateAny.replayPermanentAliases || {});
  const aliasedPermanentId = requestedPermanentId && typeof replayPermanentAliases[requestedPermanentId] === 'string'
    ? String(replayPermanentAliases[requestedPermanentId] || '').trim()
    : '';

  const directMatch = battlefield.find((entry: any) => {
    const entryId = String(entry?.id || '').trim();
    return entryId !== '' && (entryId === requestedPermanentId || entryId === aliasedPermanentId);
  });
  if (directMatch) {
    if (requestedPermanentId && aliasedPermanentId && aliasedPermanentId !== requestedPermanentId) {
      replayPermanentAliases[requestedPermanentId] = String(directMatch.id || '');
    }
    return directMatch;
  }

  if (!playerId || !cardName) {
    return undefined;
  }

  const fallbackMatches = battlefield.filter((entry: any) =>
    String(entry?.controller || '').trim() === playerId &&
    String(entry?.card?.name || '').trim().toLowerCase() === cardName
  );
  if (fallbackMatches.length !== 1) {
    return undefined;
  }

  const resolvedPermanent = fallbackMatches[0];
  if (requestedPermanentId) {
    replayPermanentAliases[requestedPermanentId] = String(resolvedPermanent?.id || '').trim();
  }
  return resolvedPermanent;
}

export function consumeRecordedManaCostFromPool(pool: Record<string, number>, manaCost?: string): void {
  if (!pool || !manaCost) return;

  try {
    const resolved = resolveManaCostForPoolPayment(pool as any, manaCost);
    if (resolved && (resolved as any).ok) {
      consumeManaFromPool(pool as any, (resolved as any).coloredCost || {}, (resolved as any).genericCost || 0);
      return;
    }
  } catch {
    // Fall through to the conservative legacy spender below.
  }

  const parsedCost = parseManaCost(manaCost);
  const colorMap: Record<string, keyof typeof pool> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
    C: 'colorless',
  };

  for (const [symbol, amount] of Object.entries(parsedCost.colors || {})) {
    const poolKey = colorMap[String(symbol).toUpperCase()];
    if (!poolKey) continue;
    const current = Number(pool[poolKey] || 0);
    pool[poolKey] = Math.max(0, current - Number(amount || 0));
  }

  let remainingGeneric = Number(parsedCost.generic || 0);
  const spendOrder: Array<keyof typeof pool> = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
  for (const poolKey of spendOrder) {
    if (remainingGeneric <= 0) break;
    const available = Number(pool[poolKey] || 0);
    if (available <= 0) continue;
    const spent = Math.min(available, remainingGeneric);
    pool[poolKey] = available - spent;
    remainingGeneric -= spent;
  }
}

export function resolveOpponentMayPaySourceController(ctx: GameContext, e: any): string {
  const persistedSourceController = String(e?.sourceController || '').trim();
  if (persistedSourceController) {
    return persistedSourceController;
  }

  const sourceName = String(e?.sourceName || '').trim().toLowerCase();
  if (!sourceName) {
    return '';
  }

  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const matches = battlefield.filter((permanent: any) =>
    String(permanent?.card?.name || '').trim().toLowerCase() === sourceName
  );

  if (matches.length === 1) {
    return String(matches[0]?.controller || '').trim();
  }

  return '';
}

export function applyAIActivateAbilityReplay(ctx: GameContext, e: any): void {
  const playerId = String(e?.playerId || '').trim();
  const permanentId = String(e?.permanentId || '').trim();
  if (!playerId || !permanentId) {
    return;
  }

  const stateAny = ctx.state as any;
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
  const sourceName = String(e?.cardName || permanent?.card?.name || 'Ability').trim() || 'Ability';
  const abilityType = String(e?.abilityType || '').trim().toLowerCase();
  const activatedAbilityText = String(e?.activatedAbilityText || e?.abilityText || permanent?.card?.oracle_text || '').trim();

  try {
    const tapped = Array.isArray(e?.tappedPermanents) ? e.tappedPermanents : [];
    if (tapped.length > 0) {
      const tappedSet = new Set(tapped.map((id: any) => String(id)));
      for (const entry of battlefield as any[]) {
        if (entry && tappedSet.has(String(entry.id || ''))) {
          (entry as any).tapped = true;
        }
      }
    }
  } catch {
    // best-effort only
  }

  try {
    const paid = Number(e?.lifePaidForCost || 0);
    if (Number.isFinite(paid) && paid > 0) {
      stateAny.life = stateAny.life || {};
      const current = Number(stateAny.life?.[playerId] ?? ctx.state.startingLife ?? 40);
      stateAny.life[playerId] = Math.max(0, current - paid);
      stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
      stateAny.lifeLostThisTurn[String(playerId)] =
        ((stateAny.lifeLostThisTurn[String(playerId)] || 0) + paid);

      const player = Array.isArray(stateAny.players)
        ? stateAny.players.find((entry: any) => entry && String(entry.id || '') === playerId)
        : null;
      if (player) {
        player.life = stateAny.life[playerId];
      }
    }
  } catch {
    // best-effort only
  }

  try {
    const sacrificed = Array.isArray(e?.sacrificedPermanents) ? e.sacrificedPermanents : [];
    for (const rawId of sacrificed) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      applyReplaySacrificedPermanent(ctx, id);
    }
  } catch {
    // best-effort only
  }

  if (abilityType === 'humble-defector') {
    drawCards(ctx as any, playerId, 2);

    const targetOpponentId = String(e?.targetOpponentId || '').trim();
    if (targetOpponentId) {
      const humbleDefector = Array.isArray(ctx.state?.battlefield)
        ? (ctx.state.battlefield as any[]).find((entry: any) => entry && String(entry.id || '') === permanentId)
        : null;
      if (humbleDefector) {
        const previousController = String((humbleDefector as any).controller || '');
        (humbleDefector as any).controller = targetOpponentId;
        syncPreparedPermanentAfterControlChange(ctx.state, humbleDefector, previousController);
        (humbleDefector as any).summoningSickness = true;
      }
    }

    ctx.bumpSeq();
    return;
  }

  const usesStack = e?.usesStack !== false;
  if (!usesStack || !activatedAbilityText) {
    ctx.bumpSeq();
    return;
  }

  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const stack = stateAny.stack as any[];
  const existing = stack.find((item: any) =>
    item &&
    String(item.type || '') === 'ability' &&
    String(item.controller || '') === playerId &&
    String(item.source || '') === permanentId &&
    String(item.activatedAbilityText || item.description || '') === activatedAbilityText
  );
  if (existing) {
    ctx.bumpSeq();
    return;
  }

  const stackItem: any = {
    id: generateDeterministicId(ctx, 'ability_ai', `${permanentId}:${abilityType || activatedAbilityText}`),
    type: 'ability',
    controller: playerId,
    source: permanentId,
    sourceName,
    description: activatedAbilityText,
    activatedAbilityText,
    card: {
      id: permanentId,
      name: `${sourceName} (ability)`,
      type_line: 'Activated Ability',
      oracle_text: activatedAbilityText || String(permanent?.card?.oracle_text || ''),
      image_uris: permanent?.card?.image_uris,
    },
    targets: [],
  };

  if (abilityType === 'fetch-land') {
    stackItem.abilityType = 'fetch-land';
    stackItem.searchParams = e?.searchParams ? { ...(e.searchParams as Record<string, unknown>) } : undefined;
  }

  stack.push(stackItem);
  ctx.bumpSeq();
}

export function applyOpponentMayPayResolve(ctx: GameContext, e: any): void {
  const decidingPlayer = String(e?.decidingPlayer || e?.playerId || '').trim();
  const sourceName = String(e?.sourceName || '').trim();
  const manaCost = String(e?.manaCost || '').trim();
  const willPay = e?.willPay === true;
  const effectText = String(e?.declineEffect || e?.triggerText || '').trim();

  if (willPay) {
    if (e?.manaAlreadyPaid === true) {
      return;
    }
    if (decidingPlayer && manaCost) {
      const stateAny = ctx.state as any;
      stateAny.manaPool = stateAny.manaPool || {};
      stateAny.manaPool[decidingPlayer] = stateAny.manaPool[decidingPlayer] || {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      consumeRecordedManaCostFromPool(stateAny.manaPool[decidingPlayer], manaCost);
      ctx.bumpSeq();
    }
    return;
  }

  const sourceController = resolveOpponentMayPaySourceController(ctx, e);
  if (!sourceController) {
    debugWarn(2, `[applyEvent] opponentMayPayResolve: missing sourceController for ${sourceName || 'unknown source'}`);
    return;
  }

  const recordedDrawCount = Math.max(0, Number(e?.declineDrawCount ?? 0) || 0);
  const recordedTreasureCount = Math.max(0, Number(e?.declineTreasureCount ?? 0) || 0);
  const drawCount = recordedDrawCount > 0 ? recordedDrawCount : getOpponentMayPayDrawCount(sourceName, effectText);
  const treasureCount = recordedTreasureCount > 0
    ? recordedTreasureCount
    : getOpponentMayPayTreasureCount(sourceName, effectText);

  let appliedDeclineOutcome = false;
  if (drawCount > 0) {
    drawCards(ctx as any, sourceController as PlayerID, drawCount);
    appliedDeclineOutcome = true;
  }

  if (treasureCount > 0) {
    createToken(
      ctx as any,
      sourceController as PlayerID,
      'Treasure',
      treasureCount,
      undefined,
      undefined,
      {
        colors: [],
        typeLine: 'Token Artifact — Treasure',
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        isArtifact: true,
        skipEventPersistence: true,
      }
    );
    appliedDeclineOutcome = true;
  }

  if (appliedDeclineOutcome) {
    return;
  }

  debugWarn(
    2,
    `[applyEvent] opponentMayPayResolve: unsupported decline effect for ${sourceName || 'unknown source'} (${effectText || 'no effect text'})`
  );
}

export function extractReplayActivationCost(fullAbilityText: string): {
  requiresTap: boolean;
  manaCost: string;
  sacrificesSource: boolean;
} {
  const costMatch = String(fullAbilityText || '').match(/^([^:]+):/i);
  const costStr = String(costMatch?.[1] || '').trim().toLowerCase();
  const manaCostMatch = costStr.match(/\{[^}]+\}/g);
  const manaCost = manaCostMatch
    ? manaCostMatch.filter(symbol => !/^\{[tq]\}$/i.test(symbol)).join('')
    : '';

  return {
    requiresTap: costStr.includes('{t}') || costStr.includes('tap'),
    manaCost,
    sacrificesSource: /\bsacrifice\s+(?:this|~)\b/i.test(costStr),
  };
}

export function snapshotLibraryForReplay(ctx: GameContext, playerId: string): any[] {
  const zoneLibrary = ((ctx.state as any)?.zones?.[playerId]?.library || []) as any[];
  const libraryCards = ctx.libraries.get(playerId as any) || zoneLibrary;
  return libraryCards.map((libraryCard: any) => ({
    id: libraryCard.id,
    name: libraryCard.name,
    type_line: libraryCard.type_line,
    oracle_text: libraryCard.oracle_text,
    image_uris: libraryCard.image_uris,
    card_faces: libraryCard.card_faces,
    layout: libraryCard.layout,
    mana_cost: libraryCard.mana_cost,
    cmc: libraryCard.cmc,
    colors: libraryCard.colors,
    power: libraryCard.power,
    toughness: libraryCard.toughness,
    loyalty: libraryCard.loyalty,
    color_identity: libraryCard.color_identity,
  }));
}

export function cloneLibraryCards(cards: any[]): any[] {
  return Array.isArray(cards) ? cards.map((card: any) => ({ ...card, zone: 'library' })) : [];
}

export function getPlayerLibraryFromContext(ctx: any, playerId: string): any[] {
  const pid = String(playerId || '').trim();
  if (!pid) return [];
  const fromMap = ctx?.libraries?.get?.(pid);
  if (Array.isArray(fromMap) && fromMap.length > 0) {
    return fromMap.map((card: any) => ({ ...card }));
  }
  const fromZones = (ctx?.state as any)?.zones?.[pid]?.library;
  return Array.isArray(fromZones) ? fromZones.map((card: any) => ({ ...card })) : [];
}

export function extractLibraryCardsByIds(library: readonly any[], ids: readonly string[]): {
  remainder: any[];
  extracted: any[];
} {
  const lib = Array.isArray(library) ? library.map((card: any) => ({ ...card })) : [];
  const extracted: any[] = [];
  for (const rawId of ids) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const idx = lib.findIndex((card: any) => String(card?.id || '') === id);
    if (idx < 0) continue;
    extracted.push({ ...lib.splice(idx, 1)[0], zone: 'library' });
  }
  return {
    remainder: lib.map((card: any) => ({ ...card, zone: 'library' })),
    extracted,
  };
}

export function buildLibraryAfterPutOnBottom(library: readonly any[], orderedBottomIds: readonly string[]): any[] {
  const { remainder, extracted } = extractLibraryCardsByIds(library, orderedBottomIds);
  return [...remainder, ...extracted];
}

export function buildLibraryAfterPutOnTop(
  library: readonly any[],
  orderedTopIds: readonly string[],
  shuffledRemainderIds?: readonly string[],
): any[] {
  const { remainder, extracted: topCards } = extractLibraryCardsByIds(library, orderedTopIds);
  if (Array.isArray(shuffledRemainderIds) && shuffledRemainderIds.length > 0) {
    const { remainder: leftover, extracted: remainderOrdered } = extractLibraryCardsByIds(remainder, shuffledRemainderIds);
    return [...topCards, ...remainderOrdered, ...leftover];
  }
  return [...topCards, ...remainder];
}

export function buildLibraryAfterAppendOrderedBottom(
  library: readonly any[],
  orderedCardIds: readonly string[],
  bottomCards: readonly any[],
): any[] {
  const lib = Array.isArray(library) ? library.map((card: any) => ({ ...card, zone: 'library' })) : [];
  const byId = new Map<string, any>(
    (Array.isArray(bottomCards) ? bottomCards : []).map((card: any) => [String(card?.id || ''), card]),
  );
  for (const rawId of orderedCardIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const card = byId.get(id);
    if (card) {
      lib.push({ ...card, zone: 'library' });
    }
  }
  return lib;
}

export function reorderLibraryByIdList(library: readonly any[], orderedIds: readonly string[]): any[] {
  const byId = new Map<string, any>();
  for (const card of Array.isArray(library) ? library : []) {
    const id = String(card?.id || '').trim();
    if (id) byId.set(id, card);
  }
  const ordered: any[] = [];
  const seen = new Set<string>();
  for (const rawId of orderedIds) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    const card = byId.get(id);
    if (card) {
      ordered.push({ ...card, zone: 'library' });
      seen.add(id);
    }
  }
  for (const card of Array.isArray(library) ? library : []) {
    const id = String(card?.id || '').trim();
    if (id && !seen.has(id)) {
      ordered.push({ ...card, zone: 'library' });
    }
  }
  return ordered;
}

export function buildLibraryAfterRemovingSelectedCards(
  library: readonly any[],
  selectedCardIds: readonly string[],
): any[] {
  const removeSet = new Set(
    selectedCardIds.map((id) => String(id || '').trim()).filter(Boolean),
  );
  return (Array.isArray(library) ? library : [])
    .filter((card: any) => !removeSet.has(String(card?.id || '')))
    .map((card: any) => ({ ...card, zone: 'library' }));
}

export function buildLibraryAfterSearchResolve(
  library: readonly any[],
  selectedCardIds: readonly string[],
  remainingLibraryIds?: readonly string[],
): any[] {
  if (Array.isArray(remainingLibraryIds)) {
    const { extracted: selectedCards } = extractLibraryCardsByIds(library, selectedCardIds);
    return buildLibraryFromRemainingIds(library, selectedCards, remainingLibraryIds);
  }
  return buildLibraryAfterRemovingSelectedCards(library, selectedCardIds);
}

export function buildLibraryAfterCascadeResolve(
  library: readonly any[],
  exiledCards: readonly any[],
  remainingLibraryIds: readonly string[],
  bottomCardIds: readonly string[],
): any[] {
  const byId = new Map<string, any>();
  for (const card of [...library, ...exiledCards]) {
    const id = String(card?.id || '').trim();
    if (id) byId.set(id, card);
  }
  const remaining = remainingLibraryIds
    .map((id) => byId.get(String(id || '').trim()))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
  const bottom = bottomCardIds
    .map((id) => byId.get(String(id || '').trim()))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
  return [...remaining, ...bottom];
}

export function buildLibraryAfterPonderResolve(
  library: readonly any[],
  params: {
    lookedAtCardIds: readonly string[];
    libraryTopOrder?: readonly string[];
    shuffledLibraryIds?: readonly string[];
    shouldShuffle?: boolean;
    toHandCardIds?: readonly string[];
    drawnCardId?: string;
    lookedAtCards?: readonly any[];
  },
): any[] {
  const cardById = new Map<string, any>();
  for (const card of [...library, ...(params.lookedAtCards || [])]) {
    const id = String(card?.id || '').trim();
    if (id) cardById.set(id, card);
  }

  const toHandSet = new Set((params.toHandCardIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const drawnId = String(params.drawnCardId || '').trim();
  const { remainder, extracted } = extractLibraryCardsByIds(library, params.lookedAtCardIds);

  if (params.shouldShuffle && Array.isArray(params.shuffledLibraryIds) && params.shuffledLibraryIds.length > 0) {
    const shufflePool = [
      ...remainder,
      ...extracted.filter((card: any) => {
        const id = String(card?.id || '').trim();
        return id && !toHandSet.has(id) && id !== drawnId;
      }),
    ];
    return reorderLibraryByIdList(shufflePool, params.shuffledLibraryIds);
  }

  const backToLibraryIds = (params.libraryTopOrder || [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && !toHandSet.has(id) && id !== drawnId);
  const backCards = backToLibraryIds
    .map((id) => cardById.get(id))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
  return [...backCards, ...remainder];
}

export function buildLibraryFromRemainingIds(
  library: readonly any[],
  extraCards: readonly any[],
  remainingLibraryIds: readonly string[],
): any[] {
  const byId = new Map<string, any>();
  for (const card of [...library, ...extraCards]) {
    const id = String(card?.id || '').trim();
    if (id) byId.set(id, card);
  }
  return remainingLibraryIds
    .map((id) => byId.get(String(id || '').trim()))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
}

export function eventHasOwnField(event: unknown, field: string): boolean {
  return Boolean(event && typeof event === 'object' && Object.prototype.hasOwnProperty.call(event, field));
}

/**
 * reset(ctx, preservePlayers)
 * Conservative fallback reset used when no specialized engine reset is available.
 */
