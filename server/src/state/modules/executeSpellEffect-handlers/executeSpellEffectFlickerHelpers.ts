/**
 * Extracted from executeSpellEffect.ts.
 * Cluster moved: FlickerReturnAt, normalizeFlickerReturnAt,
 * scheduleExiledCardReturnToBattlefield, returnExiledCardToBattlefield,
 * isCardInOwnerExile, resolveFlickerReturnAfterExile.
 * Public entries: scheduleExiledCardReturnToBattlefield,
 * returnExiledCardToBattlefield (parent keeps thin wrappers).
 *
 * Leaf must not import executeSpellEffect.ts or executeSpellEffect-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { cleanupCardLeavingExile } from '../playable-from-exile.js';
import { triggerETBEffectsForPermanent } from '../triggerEtbPermanentEffects.js';
import { detectEntersWithCounters } from '../detectEntersWithCounters.js';
import { debug } from '../../../utils/debug.js';
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

type FlickerReturnAt = 'immediate' | 'next_end_step' | 'owners_next_end_step' | 'end_of_combat';

export function normalizeFlickerReturnAt(returnDelay: unknown): FlickerReturnAt {
  const normalized = String(returnDelay || '').toLowerCase();
  if (normalized === 'end_of_turn') return 'next_end_step';
  if (normalized === 'end_of_combat') return 'end_of_combat';
  if (normalized === 'owners_next_end_step') return 'owners_next_end_step';
  if (normalized === 'next_end_step') return 'next_end_step';
  return 'immediate';
}

export function scheduleExiledCardReturnToBattlefield(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  returnAt: FlickerReturnAt,
  sourceName: string,
): boolean {
  const normalizedOwnerId = String(ownerId || '').trim() as PlayerID;
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedOwnerId || !normalizedCardId || returnAt === 'immediate') {
    return false;
  }

  const stateAny = (ctx as any).state as any;
  stateAny.pendingFlickerReturns = Array.isArray(stateAny.pendingFlickerReturns)
    ? stateAny.pendingFlickerReturns
    : [];
  stateAny.pendingFlickerReturns.push({
    kind: 'return_from_exile_to_battlefield',
    ownerId: normalizedOwnerId,
    cardId: normalizedCardId,
    returnAt,
    sourceName,
  });
  return true;
}

export function returnExiledCardToBattlefield(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  sourceName = 'Flicker effect',
): any | null {
  const stateAny = (ctx as any).state as any;
  const normalizedOwnerId = String(ownerId || '').trim() as PlayerID;
  const normalizedCardId = String(cardId || '').trim();
  if (!stateAny || !normalizedOwnerId || !normalizedCardId) return null;

  const zones = stateAny.zones || {};
  const ownerZones = zones[normalizedOwnerId];
  const exile = Array.isArray(ownerZones?.exile) ? ownerZones.exile : [];
  const exileIndex = exile.findIndex((card: any) => String(card?.id || '') === normalizedCardId);
  if (exileIndex < 0) return null;

  const card = exile.splice(exileIndex, 1)[0];
  if (typeof ownerZones.exileCount === 'number') {
    ownerZones.exileCount = exile.length;
  }
  cleanupCardLeavingExile(stateAny, card);

  const entersWithCounters = detectEntersWithCounters(card);
  const isPlaneswalker = String(card?.type_line || '').toLowerCase().includes('planeswalker');
  const newPermanent: any = {
    id: uid('perm'),
    card: { ...card, zone: 'battlefield' },
    controller: normalizedOwnerId,
    owner: normalizedOwnerId,
    tapped: false,
    summoning_sickness: String(card?.type_line || '').toLowerCase().includes('creature') || false,
    counters: entersWithCounters && Object.keys(entersWithCounters).length > 0 ? entersWithCounters : {},
    attachedTo: undefined,
  };

  if (isPlaneswalker && card?.loyalty) {
    const loyaltyValue = parseInt(String(card.loyalty), 10);
    if (!Number.isNaN(loyaltyValue)) {
      newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
      newPermanent.loyalty = loyaltyValue;
      newPermanent.baseLoyalty = loyaltyValue;
    }
  }

  stateAny.battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];
  stateAny.battlefield.push(newPermanent);
  stampPermanentEntryTimestamp(stateAny, stateAny.battlefield[stateAny.battlefield.length - 1]);

  debug(2, `[returnExiledCardToBattlefield] ${sourceName}: returned ${card?.name || normalizedCardId} to battlefield as ${newPermanent.id}`);
  triggerETBEffectsForPermanent(ctx, newPermanent, normalizedOwnerId);
  (ctx as any).bumpSeq?.();
  return newPermanent;
}

function isCardInOwnerExile(ctx: GameContext, ownerId: PlayerID, cardId: string): boolean {
  const stateAny = (ctx as any).state as any;
  const exile = stateAny?.zones?.[ownerId]?.exile;
  return Array.isArray(exile) && exile.some((card: any) => String(card?.id || '') === String(cardId || ''));
}

export function resolveFlickerReturnAfterExile(
  ctx: GameContext,
  ownerId: PlayerID,
  cardId: string,
  returnAt: FlickerReturnAt,
  sourceName: string,
): any | null {
  if (returnAt === 'immediate') {
    return returnExiledCardToBattlefield(ctx, ownerId, cardId, sourceName);
  }
  if (!isCardInOwnerExile(ctx, ownerId, cardId)) {
    return null;
  }
  scheduleExiledCardReturnToBattlefield(ctx, ownerId, cardId, returnAt, sourceName);
  return null;
}

