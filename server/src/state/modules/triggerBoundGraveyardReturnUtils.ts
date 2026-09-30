import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { uid, parsePT } from '../utils.js';
import { recordCardLeftGraveyardThisTurn } from './turn-tracking.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentBridge.js';
import {
  applyBattlefieldReturnCharacteristicMetadata,
  markPermanentEnteredFromZone,
  scheduleDelayedGraveyardReturn,
  turnReturnedPermanentFaceUp,
} from './triggerDelayedEffectUtils.js';
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

export function applyBoundGraveyardReturnFromTriggerMetadata(
  params: {
    readonly ctx: GameContext;
    readonly state: any;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly triggerItem: any;
  },
): boolean {
  const boundGraveyardCardId = String((params.triggerItem as any).boundGraveyardCardId || '').trim();
  const boundGraveyardOwnerId = String((params.triggerItem as any).boundGraveyardOwnerId || '').trim();
  const boundTargetZone = String((params.triggerItem as any).targetZone || '').toLowerCase();
  const boundTargetDestination = String((params.triggerItem as any).targetDestination || '').toLowerCase();
  if (!boundGraveyardCardId || boundTargetZone !== 'graveyard' || (boundTargetDestination !== 'hand' && boundTargetDestination !== 'battlefield')) {
    return false;
  }

  const zones = params.state.zones || {};
  const delayedReturnAt = String((params.triggerItem as any).delayedReturnAt || '').toLowerCase();

  if (delayedReturnAt === 'next_end_step' || delayedReturnAt === 'next_upkeep_selected_card_owner') {
    const delayedOwnerSearchIds = boundGraveyardOwnerId
      ? [boundGraveyardOwnerId, ...Object.keys(zones as Record<string, any>).filter((ownerId) => ownerId !== boundGraveyardOwnerId)]
      : Object.keys(zones as Record<string, any>);

    for (const ownerId of delayedOwnerSearchIds) {
      const playerZones = (zones as Record<string, any>)[ownerId];
      const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
      if (!graveyard.some((card: any) => String(card?.id || '') === boundGraveyardCardId)) {
        continue;
      }

      scheduleDelayedGraveyardReturn(params.ctx, {
        playerId: String(params.controller),
        sourceName: params.sourceName,
        entries: [{
          cardId: boundGraveyardCardId,
          zoneOwnerId: String(ownerId),
          destination: boundTargetDestination === 'battlefield' ? 'battlefield' : 'hand',
          fireAtStep: delayedReturnAt === 'next_upkeep_selected_card_owner' ? 'upkeep' : 'end_step',
          fireAtPlayerId: delayedReturnAt === 'next_upkeep_selected_card_owner' ? String(ownerId) : undefined,
          destinationUsesSelectedCardOwner: (params.triggerItem as any).destinationUsesSelectedCardOwner === true,
          battlefieldControllerMode: String((params.triggerItem as any).battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
          battlefieldControllerId: boundTargetDestination === 'battlefield' && String((params.triggerItem as any).battlefieldControllerMode || '').toLowerCase() !== 'owner'
            ? String(params.controller || '').trim() || undefined
            : undefined,
          battlefieldTapped: (params.triggerItem as any).battlefieldTapped === true,
          battlefieldCounters: (params.triggerItem as any).battlefieldCounters && typeof (params.triggerItem as any).battlefieldCounters === 'object'
            ? { ...((params.triggerItem as any).battlefieldCounters as Record<string, number>) }
            : undefined,
          battlefieldFaceDown: (params.triggerItem as any).battlefieldFaceDown === true,
          battlefieldTurnFaceUp: (params.triggerItem as any).battlefieldTurnFaceUp === true,
          battlefieldSuspected: (params.triggerItem as any).battlefieldSuspected === true,
        }],
      });
      debug(2, `[executeTriggerEffect] ${params.sourceName} scheduled delayed graveyard return for ${boundGraveyardCardId}`);
      return true;
    }

    return true;
  }

  let sourceOwnerId = '';
  let boundCard: any | undefined;

  const searchOwnerIds = boundGraveyardOwnerId
    ? [boundGraveyardOwnerId, ...Object.keys(zones as Record<string, any>).filter((ownerId) => ownerId !== boundGraveyardOwnerId)]
    : Object.keys(zones as Record<string, any>);

  for (const ownerId of searchOwnerIds) {
    const playerZones = (zones as Record<string, any>)[ownerId];
    const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
    const idx = graveyard.findIndex((card: any) => String(card?.id || '') === boundGraveyardCardId);
    if (idx === -1) continue;
    sourceOwnerId = String(ownerId);
    [boundCard] = graveyard.splice(idx, 1);
    playerZones.graveyardCount = graveyard.length;
    break;
  }

  if (!(boundCard && sourceOwnerId)) {
    return true;
  }

  recordCardLeftGraveyardThisTurn(params.ctx, sourceOwnerId, boundCard);
  const createdPermanentIds: string[] = [];
  const createdBattlefieldEntries: Array<{ permanent: any; controllerId: string }> = [];

  if (boundTargetDestination === 'hand') {
    const destinationPlayerId = (params.triggerItem as any).destinationUsesSelectedCardOwner === true ? sourceOwnerId : String(params.controller);
    const destinationZones = (params.state.zones[destinationPlayerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 }) as any;
    params.state.zones[destinationPlayerId] = destinationZones;
    destinationZones.hand = Array.isArray(destinationZones.hand) ? destinationZones.hand : [];
    destinationZones.hand.push({ ...boundCard, zone: 'hand' });
    destinationZones.handCount = destinationZones.hand.length;
  } else if (boundTargetDestination === 'battlefield') {
    const battlefield = params.state.battlefield = params.state.battlefield || [];
    const typeLine = String(boundCard?.type_line || '').toLowerCase();
    const isCreature = typeLine.includes('creature');
    const permanentId = uid('perm');
    const battlefieldControllerId = String((params.triggerItem as any).battlefieldControllerId || '').trim()
      || (String((params.triggerItem as any).battlefieldControllerMode || '').toLowerCase() === 'owner'
        ? sourceOwnerId
        : String(params.controller));
    const entersFaceDown = (params.triggerItem as any).battlefieldFaceDown === true;
    const counters = (params.triggerItem as any).battlefieldCounters && typeof (params.triggerItem as any).battlefieldCounters === 'object'
      ? { ...((params.triggerItem as any).battlefieldCounters as Record<string, number>) }
      : {};
    const permanent: any = entersFaceDown
      ? {
          id: permanentId,
          controller: battlefieldControllerId,
          owner: sourceOwnerId,
          tapped: (params.triggerItem as any).battlefieldTapped === true,
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
          faceUpCard: { ...boundCard, zone: 'battlefield' },
          canTurnFaceUp: isCreature,
        }
      : {
          id: permanentId,
          controller: battlefieldControllerId,
          owner: sourceOwnerId,
          tapped: (params.triggerItem as any).battlefieldTapped === true,
          counters,
          basePower: isCreature ? parsePT(boundCard?.power) : undefined,
          baseToughness: isCreature ? parsePT(boundCard?.toughness) : undefined,
          summoningSickness: isCreature,
          card: { ...boundCard, zone: 'battlefield' },
        };
    if ((params.triggerItem as any).battlefieldSuspected === true) {
      permanent.suspected = true;
      permanent.isSuspected = true;
      permanent.card = { ...(permanent.card || {}), suspected: true, isSuspected: true };
    }
    if ((params.triggerItem as any).battlefieldTurnFaceUp === true) {
      turnReturnedPermanentFaceUp(permanent, params.ctx);
    }
    applyBattlefieldReturnCharacteristicMetadata(permanent, params.triggerItem);
    markPermanentEnteredFromZone(permanent, 'graveyard');
    battlefield.push(permanent as any);
    stampPermanentEntryTimestamp(params.state, battlefield[battlefield.length - 1]);
    createdPermanentIds.push(permanentId);
    createdBattlefieldEntries.push({ permanent, controllerId: battlefieldControllerId });
  }

  try {
    const gameId = String((params.ctx as any)?.gameId || '').trim();
    if (gameId) {
      appendEvent(gameId, (params.ctx as any).seq ?? 0, 'confirmGraveyardTargets', {
        playerId: String(params.controller),
        effectId: String((params.triggerItem as any).id || params.sourceName || uid('graveyard_trigger')),
        selectedCardIds: [boundGraveyardCardId],
        createdPermanentIds: createdPermanentIds.length > 0 ? createdPermanentIds : undefined,
        destination: boundTargetDestination,
        targetPlayerId: sourceOwnerId,
        destinationUsesSelectedCardOwner: (params.triggerItem as any).destinationUsesSelectedCardOwner === true ? true : undefined,
        battlefieldControllerMode: String((params.triggerItem as any).battlefieldControllerMode || '').trim() || undefined,
        battlefieldTapped: (params.triggerItem as any).battlefieldTapped === true ? true : undefined,
        battlefieldCounters: (params.triggerItem as any).battlefieldCounters && typeof (params.triggerItem as any).battlefieldCounters === 'object'
          ? { ...((params.triggerItem as any).battlefieldCounters as Record<string, number>) }
          : undefined,
        battlefieldFaceDown: (params.triggerItem as any).battlefieldFaceDown === true ? true : undefined,
        battlefieldTurnFaceUp: (params.triggerItem as any).battlefieldTurnFaceUp === true ? true : undefined,
        battlefieldSuspected: (params.triggerItem as any).battlefieldSuspected === true ? true : undefined,
        battlefieldSetTypeLine: String((params.triggerItem as any).battlefieldSetTypeLine || '').trim() || undefined,
        battlefieldSetOracleText: typeof (params.triggerItem as any).battlefieldSetOracleText === 'string'
          ? String((params.triggerItem as any).battlefieldSetOracleText)
          : undefined,
        battlefieldLoseAllOtherTypes: (params.triggerItem as any).battlefieldLoseAllOtherTypes === true ? true : undefined,
        battlefieldGrantedTypes: Array.isArray((params.triggerItem as any).battlefieldGrantedTypes)
          ? [...((params.triggerItem as any).battlefieldGrantedTypes as string[])]
          : undefined,
      });
    }
  } catch (err) {
    debugWarn(1, '[executeTriggerEffect] appendEvent(confirmGraveyardTargets bound) failed:', err);
  }

  if (!(params.ctx as any).isReplaying) {
    for (const entry of createdBattlefieldEntries) {
      triggerETBEffectsForPermanent(params.ctx, entry.permanent, entry.controllerId as PlayerID);
    }
  }

  debug(2, `[executeTriggerEffect] ${params.sourceName} returned ${boundCard?.name || boundGraveyardCardId} from ${sourceOwnerId}'s graveyard to ${boundTargetDestination}`);
  return true;
}
