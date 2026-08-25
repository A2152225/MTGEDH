/**
 * Extracted from dungeon-effects.ts: DungeonRoomExecuteEffectPayload plus
 * library / pending-card / shuffle helpers used by automatic room token effects.
 * Cluster moved: DungeonRoomExecuteEffectPayload, cloneZoneCards, getLibraryCards,
 * getTopLibraryCards, getPendingDungeonRoomCardChoiceKey, setPendingDungeonRoomCardIds,
 * getPendingDungeonRoomCardIds, getLibraryCardChoiceEntries, shuffleCardsInPlace.
 * Public: DungeonRoomExecuteEffectPayload
 *
 * Leaf must not import dungeon-effects.ts or dungeon-effects-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';

export type DungeonRoomExecuteEffectPayload = {
  effectType: 'createToken';
  controllerId: string;
  tokenData: {
    id: string;
    name: string;
    typeLine: string;
    power?: number;
    toughness?: number;
    colors: string[];
    abilities: string[];
    hasHaste: boolean;
  };
} | {
  effectType: 'dungeonExileCards';
  controllerId: string;
  exiledCards: any[];
  remainingLibraryIds: string[];
  grantPlayableFromExile: boolean;
} | {
  effectType: 'dungeonDrawCards';
  controllerId: string;
  drawnCards: any[];
  remainingLibraryIds: string[];
} | {
  effectType: 'dungeonSetLibrary';
  controllerId: string;
  remainingLibraryIds: string[];
};

function cloneZoneCards(cards: any[]): any[] {
  return (Array.isArray(cards) ? cards : []).map((card: any) => ({ ...card }));
}

function getLibraryCards(ctx: GameContext, playerId: PlayerID): any[] {
  const library = (ctx as any)?.libraries?.get?.(playerId);
  return Array.isArray(library) ? library : [];
}

function getTopLibraryCards(ctx: GameContext, playerId: PlayerID, count: number): any[] {
  return cloneZoneCards(getLibraryCards(ctx, playerId).slice(0, Math.max(0, Number(count || 0))));
}

function getPendingDungeonRoomCardChoiceKey(playerId: PlayerID, roomKey: string, sourceId?: string): string {
  return `${String(playerId || '').trim()}:${String(roomKey || '').trim()}:${String(sourceId || '').trim()}`;
}

function setPendingDungeonRoomCardIds(
  ctx: GameContext,
  playerId: PlayerID,
  roomKey: string,
  sourceId: string | undefined,
  cardIds: string[],
): void {
  const stateAny = ctx.state as any;
  stateAny.pendingDungeonRoomCardIds = stateAny.pendingDungeonRoomCardIds || {};
  stateAny.pendingDungeonRoomCardIds[getPendingDungeonRoomCardChoiceKey(playerId, roomKey, sourceId)] = cardIds;
}

function getPendingDungeonRoomCardIds(
  ctx: GameContext,
  playerId: PlayerID,
  roomKey: string,
  sourceId?: string,
): string[] {
  const stateAny = ctx.state as any;
  const pending = stateAny.pendingDungeonRoomCardIds || {};
  const exact = pending[getPendingDungeonRoomCardChoiceKey(playerId, roomKey, sourceId)];
  if (Array.isArray(exact)) {
    return exact.map((cardId: any) => String(cardId || '')).filter(Boolean);
  }

  if (sourceId) {
    const fallback = pending[getPendingDungeonRoomCardChoiceKey(playerId, roomKey, undefined)];
    if (Array.isArray(fallback)) {
      return fallback.map((cardId: any) => String(cardId || '')).filter(Boolean);
    }
  }

  return [];
}

function getLibraryCardChoiceEntries(cards: any[]): Array<{
  id: string;
  label: string;
  description: string;
  imageUrl?: string;
}> {
  return (Array.isArray(cards) ? cards : [])
    .filter((card: any) => card && String(card.id || '').trim())
    .map((card: any) => ({
      id: String(card.id),
      label: String(card.name || 'Card'),
      description: String(card.type_line || ''),
      imageUrl: card.image_uris?.small || card.image_uris?.normal,
    }));
}

function shuffleCardsInPlace(cards: any[], rng?: (() => number) | undefined): void {
  const random = typeof rng === 'function' ? rng : Math.random;
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
}

export {
  cloneZoneCards,
  getLibraryCards,
  getTopLibraryCards,
  getPendingDungeonRoomCardChoiceKey,
  setPendingDungeonRoomCardIds,
  getPendingDungeonRoomCardIds,
  getLibraryCardChoiceEntries,
  shuffleCardsInPlace,
};
