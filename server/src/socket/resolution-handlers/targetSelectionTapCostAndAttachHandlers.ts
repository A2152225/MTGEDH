/**
 * socket/resolution-handlers/targetSelectionTapCostAndAttachHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: two non-stack target-selection branches plus the nested helper only one of them
 * used - `tapCreaturesCost` (Summon the School style "Tap N untapped X you control:", which
 * validates everything before tapping so a failure never taps without returning the card) and
 * `attachEquipmentToPermanentSelectEquipment` (the player picked which Equipment to attach), whose
 * body was the closure `attachEquipmentToPermanentById`.
 * Public entry symbols: handleTapCreaturesCostTargetSelection,
 * handleAttachEquipmentSelectEquipmentTargetSelection.
 *
 * Both branches always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { stampPermanentEntryTimestamp, stampAttachmentTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';

import { queueTapTriggersForTappedPermanents } from "../../state/modules/tap-trigger-queue.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/**
 * Attach an Equipment to a permanent, detaching it from whatever it was on.
 *
 * Returns false (and logs) when the pair is no longer a legal attachment.
 */
async function attachEquipmentToPermanentById(
  ioRef: any,
  gameRef: any,
  currentGameId: string,
  controllerId: string,
  equipmentPermanentId: string,
  targetPermanentId: string,
  options?: {
    sourceName?: string;
    targetName?: string;
    emitChat?: boolean;
    persistEvent?: boolean;
  },
): Promise<boolean> {
  const battlefield = Array.isArray(gameRef.state?.battlefield) ? gameRef.state.battlefield : [];
  const equipment = battlefield.find((permanent: any) => permanent?.id === equipmentPermanentId);
  const targetPermanent = battlefield.find((permanent: any) => permanent?.id === targetPermanentId);
  if (!equipment || !targetPermanent) {
    debugWarn(2, `[Resolution] attachEquipmentToPermanent: missing equipment or target permanent`);
    return false;
  }

  const equipmentTypeLine = String(equipment.card?.type_line || '').toLowerCase();
  if (!equipmentTypeLine.includes('equipment')) {
    debugWarn(2, `[Resolution] attachEquipmentToPermanent: ${equipment.card?.name || equipmentPermanentId} is not an Equipment`);
    return false;
  }

  const equipmentId = String((equipment as any).id || equipmentPermanentId);
  for (const permanent of battlefield) {
    const attachedEquipment = Array.isArray((permanent as any)?.attachedEquipment)
      ? (permanent as any).attachedEquipment
      : null;
    if (!attachedEquipment) continue;
    (permanent as any).attachedEquipment = attachedEquipment.filter((id: any) => String(id) !== equipmentId);
    if ((permanent as any).attachedEquipment.length === 0) {
      (permanent as any).isEquipped = false;
    }
  }

  equipment.attachedTo = targetPermanent.id;
  stampAttachmentTimestamp(gameRef.state, equipment);
  targetPermanent.attachedEquipment = Array.isArray(targetPermanent.attachedEquipment) ? targetPermanent.attachedEquipment : [];
  if (!targetPermanent.attachedEquipment.some((id: any) => String(id) === equipmentId)) {
    targetPermanent.attachedEquipment.push(equipmentId);
  }
  targetPermanent.isEquipped = true;

  if (options?.emitChat !== false) {
    const sourceName = String(options?.sourceName || 'Ability');
    const targetName = String(options?.targetName || 'the permanent');
    ioRef.to(currentGameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId: currentGameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(gameRef, controllerId)} attached ${equipment.card?.name || 'an Equipment'} to ${targetPermanent.card?.name || targetName}.`,
      ts: Date.now(),
    });
  }

  if (options?.persistEvent !== false) {
    try {
      await appendEvent(currentGameId, (gameRef as any).seq ?? 0, 'equipPermanent', {
        playerId: controllerId,
        equipmentId,
        targetCreatureId: targetPermanentId,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist equipPermanent event for attachEquipmentToPermanent:', err);
    }
  }

  return true;
}

/**
 * TAP CREATURES AS COST (Summon the School style: "Tap N untapped X you control:").
 *
 * Not stack targeting: apply taps and move the source card from graveyard to hand.
 */
export function handleTapCreaturesCostTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
  const requiredCount = Number(stepAny?.requiredCount || 0);
  const creatureType = String(stepAny?.creatureType || '').trim();

  const fail = (code: string, message: string) => {
    debugWarn(1, `[Resolution] tapCreaturesCost ${code}: ${message}`);
    emitToPlayer(io, pid as any, 'error', { code, message });
  };

  if (!cardId) {
    fail('INVALID_STEP', 'Graveyard return step is missing its card.');
    return;
  }

  if (!Number.isFinite(requiredCount) || requiredCount <= 0) {
    fail('INVALID_STEP', 'Invalid tap-cost requirement.');
    return;
  }

  // Enforce exact count for cost payment
  if (selections.length !== requiredCount) {
    fail('INVALID_SELECTION', `Select exactly ${requiredCount} creature(s) to tap.`);
    return;
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const selectedPermanents: any[] = [];

  for (const permanentId of selections) {
    const permanent = battlefield.find((p: any) => p && p.id === permanentId);
    if (!permanent || String(permanent.controller) !== String(pid)) {
      fail('INVALID_SELECTION', 'One of the selected permanents is no longer a legal tap cost.');
      return;
    }
    if ((permanent as any).tapped) {
      fail('ALREADY_TAPPED', `${permanent.card?.name || 'Creature'} is already tapped.`);
      return;
    }
    selectedPermanents.push(permanent);
  }

  const zones = (game.state as any)?.zones?.[pid];
  if (!zones || !Array.isArray(zones.graveyard)) {
    fail('NO_ZONES', 'Graveyard not found.');
    return;
  }

  const cardIndex = zones.graveyard.findIndex((c: any) => String(c?.id) === cardId);
  if (cardIndex === -1) {
    fail('CARD_NOT_IN_GRAVEYARD', 'That card is no longer in your graveyard.');
    return;
  }

  // Mutate only after all validation succeeds (avoid tapping without returning the card).
  const tappedCreatureNames: string[] = [];
  for (const permanent of selectedPermanents) {
    (permanent as any).tapped = true;
    tappedCreatureNames.push(permanent.card?.name || 'Creature');
  }

  const card = zones.graveyard[cardIndex];
  const cardName = String(card?.name || step.sourceName || 'Card');

  zones.graveyard.splice(cardIndex, 1);
  zones.graveyardCount = zones.graveyard.length;
  zones.hand = zones.hand || [];
  zones.hand.push({ ...card, zone: 'hand' });
  zones.handCount = zones.hand.length;

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  appendEvent(gameId, (game as any).seq ?? 0, 'activateGraveyardAbility', {
    playerId: pid,
    cardId,
    abilityId: String(stepAny?.abilityId || 'tap-creatures-return'),
    tappedCreatureIds: selections,
    creatureType,
    requiredCount,
    destination: 'hand',
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} tapped ${tappedCreatureNames.join(', ')} to return ${cardName} from graveyard to hand.`,
    ts: Date.now(),
  });

  queueTapTriggersForTappedPermanents(io, game, gameId, selections.map((id: any) => String(id)), String(pid));

  broadcastGame(io, game, gameId);
}

/** GENERIC: Attach Equipment to target permanent (after selecting equipment). */
export async function handleAttachEquipmentSelectEquipmentTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const controllerId = String((step as any).attachEquipmentToPermanentController || pid);
  const targetPermanentId = String((step as any).attachEquipmentToPermanentTargetPermanentId || '');
  const sourceName = String((step as any).attachEquipmentToPermanentSourceName || step.sourceName || 'Ability');
  const targetName = String((step as any).attachEquipmentToPermanentTargetName || 'the permanent');
  const equipPermanentId = String(selections[0] || '');

  const attached = await attachEquipmentToPermanentById(
    io,
    game,
    gameId,
    controllerId,
    equipPermanentId,
    targetPermanentId,
    {
      sourceName,
      targetName,
      emitChat: true,
      persistEvent: true,
    },
  );
  if (!attached) {
    return;
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}
