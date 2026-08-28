// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerImpulseDuringResolutionCastPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster: during-resolution "that player may cast that card" after share-a-type
//   impulse exile (Possibility Storm). The original stack spell is not "that card".
// Public entry symbol: queueDuringResolutionShareTypeCastPromptFromOracleIRResult.
// Called from applyOracleIRStepsOnServer; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { putSpecificExiledCardsOnLibraryBottom } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { getOrCreatePlayerZones } from '../triggerLibraryMillUtils.js';
import { queueCastFromExileResolutionPrompt } from '../triggerCastFromExileUtils.js';

function appliedShareTypeImpulseSteps(result: OracleIRExecutionResult): OracleEffectStep[] {
  return (result.appliedSteps || []).filter((step) => {
    if (step.kind !== 'impulse_exile_top') return false;
    const amountRaw = String((step as any)?.amount?.raw || '').toLowerCase();
    return /shares a card type with it/.test(amountRaw);
  });
}

function collectExileCards(state: any): any[] {
  const seen = new Set<string>();
  const cards: any[] = [];
  const consider = (card: any) => {
    const id = String(card?.id || card?.cardId || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    cards.push(card);
  };
  for (const player of state?.players || []) {
    for (const card of Array.isArray(player?.exile) ? player.exile : []) consider(card);
  }
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const ownerId of Object.keys(zones)) {
    for (const card of Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : []) consider(card);
  }
  return cards;
}

function collectOriginalStackSpellIds(state: any, irCtx?: OracleIRExecutionContext): Set<string> {
  const ids = new Set<string>();
  const targetSpellId = String(irCtx?.targetSpellId || irCtx?.selectorContext?.targetSpellId || '').trim();
  if (targetSpellId) ids.add(targetSpellId);

  for (const card of collectExileCards(state)) {
    const id = String(card?.id || '').trim();
    const cardId = String(card?.card?.id || '').trim();
    const fromStack = String(card?.copiedFromStackItemId || card?.stackItemId || '').trim();
    if (!targetSpellId) continue;
    if (id === targetSpellId || cardId === targetSpellId || fromStack === targetSpellId) {
      if (id) ids.add(id);
      if (cardId) ids.add(cardId);
      if (fromStack) ids.add(fromStack);
    }
  }
  return ids;
}

function ownerIdForExileCard(state: any, card: any): string {
  const stamped = String(card?.ownerId || card?.owner || card?.card?.ownerId || card?.card?.owner || '').trim();
  if (stamped) return stamped;
  for (const player of state?.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    if ((Array.isArray(player?.exile) ? player.exile : []).some((entry: any) => String(entry?.id || '') === String(card?.id || ''))) {
      return playerId;
    }
  }
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const ownerId of Object.keys(zones)) {
    if ((Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : []).some((entry: any) => String(entry?.id || '') === String(card?.id || ''))) {
      return ownerId;
    }
  }
  return '';
}

function syncPlayerLibraryExileToZones(state: any, playerId: string): void {
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '') === playerId);
  if (!player) return;
  const zones = getOrCreatePlayerZones(state, playerId as PlayerID);
  zones.exile = Array.isArray(player.exile) ? [...player.exile] : [];
  zones.library = Array.isArray(player.library) ? [...player.library] : [];
  zones.exileCount = zones.exile.length;
  zones.libraryCount = zones.library.length;
}

function bottomOriginalStackSpells(
  state: any,
  originalSpellIds: Set<string>,
  keepCardId: string,
): void {
  const byOwner = new Map<string, any[]>();
  for (const card of collectExileCards(state)) {
    const id = String(card?.id || card?.cardId || '').trim();
    if (!id || id === keepCardId) continue;
    const fromStack = String(card?.copiedFromStackItemId || card?.stackItemId || '').trim();
    if (!originalSpellIds.has(id) && !originalSpellIds.has(fromStack)) continue;
    const ownerId = ownerIdForExileCard(state, card);
    if (!ownerId) continue;
    const list = byOwner.get(ownerId) || [];
    list.push(card);
    byOwner.set(ownerId, list);
  }
  for (const [ownerId, cards] of byOwner) {
    const result = putSpecificExiledCardsOnLibraryBottom(state, ownerId as PlayerID, cards);
    if (result.state && result.state !== state) {
      Object.assign(state, result.state);
      if (Array.isArray((result.state as any).players)) {
        state.players = (result.state as any).players;
      }
    }
    syncPlayerLibraryExileToZones(state, ownerId);
  }
}

export function queueDuringResolutionShareTypeCastPromptFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx?: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;
  if (appliedShareTypeImpulseSteps(result).length === 0) return;

  const originalSpellIds = collectOriginalStackSpellIds(state, params.irCtx);
  const hitCards = collectExileCards(state).filter((card) => {
    const id = String(card?.id || card?.cardId || '').trim();
    if (!id || originalSpellIds.has(id)) return false;
    const fromStack = String(card?.copiedFromStackItemId || card?.stackItemId || '').trim();
    if (fromStack && originalSpellIds.has(fromStack)) return false;
    const canBePlayedBy = String(card?.canBePlayedBy || '').trim();
    return Boolean(canBePlayedBy) || card?.withoutPayingManaCost === true || card?.castWithoutPayingManaCost === true;
  });

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queue = ResolutionQueueManager.getQueue(gameId);

  for (const hitCard of hitCards) {
    const hitId = String(hitCard?.id || '').trim();
    const playerId = String(
      hitCard?.canBePlayedBy || ownerIdForExileCard(state, hitCard) || params.controller || '',
    ).trim();
    if (!hitId || !playerId) continue;
    const alreadyQueued = queue.steps.some(
      (step: any) => String(step?.castFromExileCardId || '').trim() === hitId,
    );
    if (alreadyQueued) continue;
    queueCastFromExileResolutionPrompt(
      ctx,
      gameId,
      playerId as PlayerID,
      sourceName,
      sourceId,
      undefined,
      hitCard,
      {
        declineDestination: 'library_bottom_random',
        declineLabel: `Put ${String(hitCard?.name || 'that card')} on the bottom of your library`,
        castLabel: `Cast ${String(hitCard?.name || 'that card')} without paying its mana cost`,
        description: `${sourceName}: You may cast ${String(hitCard?.name || 'that card')} without paying its mana cost.`,
        mandatory: false,
      },
    );
  }

  const keepId = hitCards.length === 1 ? String(hitCards[0]?.id || '').trim() : '';
  bottomOriginalStackSpells(state, originalSpellIds, keepId);
}
