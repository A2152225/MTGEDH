import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { drawCards as drawCardsFromZone, movePermanentToHand } from './zones.js';
import { recordCardLeftGraveyardThisTurn } from './turn-tracking.js';
import {
  markPermanentEnteredFromZone,
  turnReturnedPermanentFaceUp,
} from './triggerDelayedEffectUtils.js';
import { destroyPermanent, movePermanentToExile } from './counters_tokens.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentBridge.js';

export interface TriggerDelayedCleanupParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyDelayedCleanupTriggersFromMetadata(
  params: TriggerDelayedCleanupParams,
): boolean {
  const action = params.triggerItem?.delayedAction as ('draw' | 'exile' | 'sacrifice' | 'return_hand' | 'graveyard_return' | undefined);

  if (action === 'draw') {
    const count = Math.max(1, Math.floor(Number(params.triggerItem?.delayedDrawCount || 1)));
    drawCardsFromZone(params.ctx, params.controller, count);
    return true;
  }

  try {
    const permanentIds = params.triggerItem?.delayedPermanentIds as (string[] | undefined);
    const delayedGraveyardReturnEntries = Array.isArray(params.triggerItem?.delayedGraveyardReturnEntries)
      ? params.triggerItem.delayedGraveyardReturnEntries
      : undefined;
    const delayedSourceName = String(params.triggerItem?.delayedSourceName || params.sourceName || 'Delayed trigger');

    if (action === 'graveyard_return' && Array.isArray(delayedGraveyardReturnEntries) && delayedGraveyardReturnEntries.length > 0) {
      const zones = params.state.zones || {};
      for (const rawEntry of delayedGraveyardReturnEntries) {
        const zoneOwnerId = String(rawEntry?.zoneOwnerId || '').trim();
        const cardId = String(rawEntry?.cardId || '').trim();
        const destination = String(rawEntry?.destination || '').toLowerCase();
        if (!zoneOwnerId || !cardId || (destination !== 'hand' && destination !== 'battlefield')) {
          continue;
        }

        const playerZones = zones[zoneOwnerId] || {};
        const graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
        const graveyardIndex = graveyard.findIndex((card: any) => String(card?.id || '') === cardId);
        if (graveyardIndex === -1) {
          continue;
        }

        const [card] = graveyard.splice(graveyardIndex, 1);
        playerZones.graveyardCount = graveyard.length;
        recordCardLeftGraveyardThisTurn(params.ctx, zoneOwnerId, card);

        if (destination === 'hand') {
          const destinationPlayerId = rawEntry?.destinationUsesSelectedCardOwner === true
            ? zoneOwnerId
            : String(params.controller || zoneOwnerId);
          const destinationZones = (zones[destinationPlayerId] || {
            hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0,
          }) as any;
          zones[destinationPlayerId] = destinationZones;
          destinationZones.hand = Array.isArray(destinationZones.hand) ? destinationZones.hand : [];
          destinationZones.hand.push({ ...card, zone: 'hand' });
          destinationZones.handCount = destinationZones.hand.length;
          continue;
        }

        const battlefield = params.state.battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
        const typeLine = String(card?.type_line || '').toLowerCase();
        const isCreature = typeLine.includes('creature');
        const battlefieldControllerId = String(rawEntry?.battlefieldControllerId || '').trim()
          || (String(rawEntry?.battlefieldControllerMode || '').toLowerCase() === 'owner' ? zoneOwnerId : String(params.controller || zoneOwnerId));
        const entersFaceDown = rawEntry?.battlefieldFaceDown === true;
        const counters = rawEntry?.battlefieldCounters && typeof rawEntry.battlefieldCounters === 'object'
          ? { ...rawEntry.battlefieldCounters }
          : {};
        const permanent: any = entersFaceDown
          ? {
              id: uid('perm'),
              controller: battlefieldControllerId,
              owner: zoneOwnerId,
              tapped: rawEntry?.battlefieldTapped === true,
              counters,
              basePower: 2,
              baseToughness: 2,
              summoningSickness: true,
              card: {
                name: 'Face-down Creature',
                type_line: 'Creature',
                zone: 'battlefield',
                power: '2',
                toughness: '2',
              },
              isFaceDown: true,
              faceDownType: 'effect',
              faceUpCard: { ...card, zone: 'battlefield' },
              canTurnFaceUp: isCreature,
            }
          : {
              id: uid('perm'),
              controller: battlefieldControllerId,
              owner: zoneOwnerId,
              tapped: rawEntry?.battlefieldTapped === true,
              counters,
              basePower: isCreature ? parsePT(card?.power) : undefined,
              baseToughness: isCreature ? parsePT(card?.toughness) : undefined,
              summoningSickness: isCreature,
              card: { ...card, zone: 'battlefield' },
            };
        if (rawEntry?.battlefieldSuspected === true) {
          permanent.suspected = true;
          permanent.isSuspected = true;
          permanent.card = { ...(permanent.card || {}), suspected: true, isSuspected: true };
        }
        if (rawEntry?.battlefieldTurnFaceUp === true) {
          turnReturnedPermanentFaceUp(permanent, params.ctx);
        }
        markPermanentEnteredFromZone(permanent, 'graveyard');
        battlefield.push(permanent);
        if (!(params.ctx as any).isReplaying) {
          triggerETBEffectsForPermanent(params.ctx, permanent, battlefieldControllerId as PlayerID);
        }
      }

      return true;
    }

    if (action === 'return_hand' && Array.isArray(permanentIds) && permanentIds.length > 0) {
      for (const rawId of permanentIds) {
        const permanentId = String(rawId || '').trim();
        if (!permanentId) continue;
        movePermanentToHand(params.ctx, permanentId);
      }
      return true;
    }

    if ((action === 'exile' || action === 'sacrifice') && Array.isArray(permanentIds) && permanentIds.length > 0) {
      const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];

      for (const rawId of permanentIds) {
        const permanentId = String(rawId || '').trim();
        if (!permanentId) continue;

        const perm = battlefield.find((p: any) => p?.id === permanentId);
        if (!perm) continue;

        if (action === 'exile') {
          movePermanentToExile(params.ctx, permanentId, {
            exiledWithSourceName: delayedSourceName,
          });
          continue;
        }

        const permController = String((perm as any)?.controller || (perm as any)?.owner || '').trim();
        if (permController && String(params.controller) && permController !== String(params.controller)) {
          continue;
        }

        try {
          const stateAny = params.state as any;
          const key = String(params.controller || permController || '').trim();
          if (key) {
            stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
            stateAny.permanentsSacrificedThisTurn[key] = (stateAny.permanentsSacrificedThisTurn[key] || 0) + 1;

            const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
            const nm = String((perm as any)?.card?.name || '').toLowerCase();
            const isFood = tl.includes('food') && (tl.includes('artifact') || tl.includes('token'));
            if (isFood && (nm === 'food' || tl.includes('— food') || tl.includes('- food') || tl.includes('food'))) {
              stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
              stateAny.foodsSacrificedThisTurn[key] = (stateAny.foodsSacrificedThisTurn[key] || 0) + 1;
            }
          }
        } catch {
          // best-effort only
        }

        destroyPermanent(params.ctx, permanentId, true);
      }

      return true;
    }
  } catch {
    return false;
  }

  return false;
}
