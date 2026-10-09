// Origin parent: server/src/state/modules/manualActionApply.ts
// Cluster: slide a found object into a destination zone without running triggers.
// Public entry symbols: relocateManualObject, placeCardInZone.

import type { GameContext } from '../../context.js';
import type { ManualActionPayload, ManualZone } from '../../../../../shared/src/manualAction.js';
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';
import { uid } from '../../utils.js';
import {
  pickMutablePlayerLibrary,
  writePlayerLibrary,
} from '../applyEventReplayCardMoveLibraryHelpers.js';
import {
  cardIdOf,
  findManualObject,
  getOrInitPlayerZones,
  isTokenObject,
  ownerIdOf,
  removeManualObject,
  type ManualFoundObject,
} from './manualActionFind.js';

export type PlaceOptions = {
  controllerId?: string;
  tapped?: boolean;
  faceDown?: boolean;
  position?: 'top' | 'bottom' | 'nth';
  nth?: number;
  createdPermanentIds?: string[];
};

function cloneCard(card: any, zone: string, extra?: Record<string, unknown>): any {
  return { ...(card || {}), zone, ...(extra || {}) };
}

function nextPermanentId(payload: ManualActionPayload, _card?: unknown): string {
  const recorded = Array.isArray(payload.createdPermanentIds) ? payload.createdPermanentIds : [];
  const next = recorded.find((id) => String(id || '').trim());
  if (next) {
    payload.createdPermanentIds = recorded.filter((id) => id !== next);
    return String(next);
  }
  const generated = uid('perm');
  payload.createdPermanentIds = [...recorded, generated];
  return generated;
}

export function placeCardInZone(
  ctx: GameContext,
  card: any,
  ownerId: string,
  toZone: ManualZone,
  payload: ManualActionPayload,
  options: PlaceOptions = {},
): string | null {
  const faceDown = options.faceDown === true;
  const controllerId = String(options.controllerId || payload.controllerId || ownerId || payload.actorId || '').trim();

  if (toZone === 'battlefield') {
    if (isTokenObject(card) && !card?.type_line && !card?.card) {
      // already a token card object
    }
    const typeLine = String(card?.type_line || '').toLowerCase();
    const isCreature = typeLine.includes('creature');
    const permanentId = nextPermanentId(payload, card);
    const permanent: any = {
      id: permanentId,
      controller: controllerId || ownerId,
      owner: ownerId,
      tapped: options.tapped === true,
      counters: {},
      card: cloneCard(card, 'battlefield', faceDown ? { faceDown: true } : { faceDown: false }),
      basePower: isCreature ? parseInt(String(card?.power || '0'), 10) || 0 : undefined,
      baseToughness: isCreature ? parseInt(String(card?.toughness || '0'), 10) || 0 : undefined,
      summoningSickness: isCreature,
      isToken: isTokenObject(card),
    };
    if (faceDown) {
      permanent.faceDown = true;
      permanent.card.faceDown = true;
    }
    ctx.state.battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
    (ctx.state.battlefield as any[]).push(permanent);
    stampPermanentEntryTimestamp(ctx.state as any, permanent);
    return permanentId;
  }

  if (toZone === 'library') {
    const lib = pickMutablePlayerLibrary(ctx, ownerId);
    const nextCard = cloneCard(card, 'library', faceDown ? { faceDown: true } : undefined);
    const position = options.position || payload.position || 'top';
    if (position === 'bottom') {
      lib.push(nextCard);
    } else if (position === 'nth') {
      const nth = Math.max(1, Math.floor(Number(options.nth ?? payload.nth ?? 1)));
      const insertAt = Math.min(lib.length, nth - 1);
      lib.splice(insertAt, 0, nextCard);
    } else {
      lib.unshift(nextCard);
    }
    writePlayerLibrary(ctx, ownerId, lib);
    return cardIdOf(nextCard);
  }

  if (toZone === 'command') {
    const state = ctx.state as any;
    state.commandZone = state.commandZone || {};
    const cz = state.commandZone[ownerId] = state.commandZone[ownerId] || {
      commanderIds: [],
      commanderCards: [],
      inCommandZone: [],
    };
    cz.commanderCards = Array.isArray(cz.commanderCards) ? cz.commanderCards : [];
    cz.inCommandZone = Array.isArray(cz.inCommandZone) ? cz.inCommandZone : [];
    const nextCard = cloneCard(card, 'command');
    const id = cardIdOf(nextCard);
    if (!cz.commanderCards.some((c: any) => cardIdOf(c) === id)) cz.commanderCards.push(nextCard);
    if (id && !cz.inCommandZone.includes(id)) cz.inCommandZone.push(id);
    if (id && Array.isArray(cz.commanderIds) && !cz.commanderIds.includes(id)) cz.commanderIds.push(id);
    return id;
  }

  const z = getOrInitPlayerZones(ctx, ownerId);
  const nextCard = cloneCard(card, toZone, faceDown ? { faceDown: true } : undefined);
  if (toZone === 'hand') {
    z.hand.push(nextCard);
    z.handCount = z.hand.length;
  } else if (toZone === 'graveyard') {
    z.graveyard.push(nextCard);
    z.graveyardCount = z.graveyard.length;
  } else if (toZone === 'exile') {
    z.exile.push(nextCard);
    z.exileCount = z.exile.length;
  } else if (toZone === 'stack') {
    const stack = Array.isArray(ctx.state.stack) ? (ctx.state.stack as any[]) : [];
    ctx.state.stack = stack as any;
    stack.push({
      id: nextPermanentId(payload),
      type: 'spell',
      controller: controllerId,
      owner: ownerId,
      card: nextCard,
    });
  }
  return cardIdOf(nextCard);
}

export function relocateManualObject(
  ctx: GameContext,
  objectId: string,
  toZone: ManualZone,
  payload: ManualActionPayload,
  options: PlaceOptions = {},
): { ok: boolean; name: string; fromZone?: ManualZone; skippedToken?: boolean } {
  const found: ManualFoundObject | null = findManualObject(ctx, objectId);
  if (!found) return { ok: false, name: objectId };

  if (isTokenObject(found.permanent || found.card) && toZone !== 'battlefield') {
    removeManualObject(ctx, found);
    return { ok: true, name: String(found.card?.name || objectId), fromZone: found.zone, skippedToken: true };
  }

  const card = removeManualObject(ctx, found);
  const ownerId = ownerIdOf(found.permanent || found.card, found.ownerId);
  placeCardInZone(ctx, card, ownerId, toZone, payload, {
    ...options,
    controllerId: options.controllerId || payload.controllerId || found.permanent?.controller || ownerId,
  });
  return { ok: true, name: String(card?.name || found.card?.name || objectId), fromZone: found.zone };
}
