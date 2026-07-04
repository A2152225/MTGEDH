import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugError, debugWarn } from '../../utils/debug.js';
import { queueEachPlayerMayPutLandOrDrawBatch } from './triggerLandPlayPromptUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { filterHandCreatureCardsOfChosenType } from './chosen-creature-type.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyResolutionParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly players: readonly any[];
  readonly battlefield: readonly any[];
}

export function applyRetiredTriggerLegacyKynaiosLandDrawChoice(
  params: TriggerLegacyResolutionParams & {
    readonly isKynaiosEffect: boolean;
  },
): boolean {
  if (!params.isKynaiosEffect) {
    return false;
  }

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const gameId = (params.ctx as any).gameId || (params.ctx as any).id || params.triggerItem?.gameId;
  if (!gameId || gameId === 'unknown') {
    debugError(1, `[executeTriggerEffect] Kynaios: CRITICAL - Cannot process without gameId (ctx.gameId=${(params.ctx as any).gameId}, ctx.id=${(params.ctx as any).id}, triggerItem.gameId=${params.triggerItem?.gameId}). Trigger will not function correctly.`);
    return true;
  }

  debug(1, `[executeTriggerEffect] Kynaios: Creating resolution steps for ${params.players.length} players, gameId=${gameId}`);

  const kynaiosBatchId = String(params.triggerItem?.id || `kynaios_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  queueEachPlayerMayPutLandOrDrawBatch(params.ctx, {
    sourceController: params.controller,
    sourceName: params.sourceName,
    sourceId: params.triggerItem?.permanentId || params.triggerItem?.sourceId,
    sourceImage: params.triggerItem?.card?.image_uris?.small,
    batchId: kynaiosBatchId,
    triggerItem: params.triggerItem,
  });

  drawCardsFromZone(params.ctx, params.controller, 1);
  debug(1, `[executeTriggerEffect] ${params.sourceName}: ${params.controller} draws 1, created ${params.players.length} resolution steps for land/draw choices (gameId: ${gameId})`);
  return true;
}

function queuePutCreatureFromHandModal(
  params: TriggerLegacyResolutionParams & {
    readonly validCreatures: readonly any[];
    readonly typeDesc: string;
    readonly isOptionalPut: boolean;
    readonly tappedAndAttacking: boolean;
  },
): void {
  const gameId = (params.ctx as any).gameId || (params.state as any).gameId;
  if (!gameId || (params.ctx as any).isReplaying) {
    return;
  }

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.MODAL_CHOICE,
    playerId: params.controller,
    description: `${params.sourceName}: ${params.isOptionalPut ? 'You may put' : 'Put'} a ${params.typeDesc} creature from your hand onto the battlefield${params.tappedAndAttacking ? ' tapped and attacking' : ''}`,
    mandatory: !params.isOptionalPut,
    sourceName: params.sourceName,
    sourceImage: params.triggerItem.value?.imageUrl,
    promptTitle: `Put ${params.typeDesc} onto Battlefield`,
    promptDescription: `Select a ${params.typeDesc} creature card from your hand to put onto the battlefield${params.tappedAndAttacking ? ' tapped and attacking' : ''}.`,
    options: [
      ...(params.isOptionalPut ? [{ id: 'decline', label: 'Decline' }] : []),
      ...params.validCreatures.map((card: any) => ({
        id: card.id,
        label: card.name || 'Unknown Card',
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
      })),
    ],
    minSelections: params.isOptionalPut ? 0 : 1,
    maxSelections: 1,
    putFromHandData: {
      tappedAndAttacking: params.tappedAndAttacking,
      validCardIds: params.validCreatures.map((card: any) => card.id),
    },
  });

  debug(2, `[executeTriggerEffect] ${params.sourceName}: Queued hand selection for ${params.typeDesc} creature (${params.validCreatures.length} valid cards)`);
}

export function applyRetiredTriggerLegacyBelbePortalPutFromHand(
  params: TriggerLegacyResolutionParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/(?:you may )?put a creature card of the chosen type from your hand onto the battlefield/i.test(params.desc)
    || params.desc.includes('search your library')) {
    return false;
  }

  const sourcePermanentId = String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim();
  const sourcePermanent = params.battlefield.find((perm: any) => perm && String(perm.id) === sourcePermanentId);
  const chosenType = String(
    sourcePermanent?.chosenCreatureType || params.triggerItem?.chosenCreatureType || '',
  ).trim();
  const hand = (params.state.zones?.[params.controller] as any)?.hand || [];
  const validCreatures = filterHandCreatureCardsOfChosenType(hand, chosenType);

  if (validCreatures.length === 0) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: No ${chosenType || 'chosen-type'} creature cards in hand`);
    return true;
  }

  queuePutCreatureFromHandModal({
    ...params,
    validCreatures,
    typeDesc: chosenType || 'chosen type',
    isOptionalPut: params.desc.toLowerCase().includes('you may'),
    tappedAndAttacking: false,
  });

  return true;
}

export function applyRetiredTriggerLegacyPutCreatureFromHandOntoBattlefield(
  params: TriggerLegacyResolutionParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const putFromHandPattern = params.desc.match(
    /(?:you may )?put (?:a|an)(?: ([\w,\s]+?))? creature card from your hand onto the battlefield(?: tapped and attacking)?/i,
  );
  if (!putFromHandPattern || params.desc.includes('search your library')) {
    return false;
  }

  const creatureTypeRestriction = String(putFromHandPattern[1] || 'creature').toLowerCase().trim();
  const isTappedAndAttacking = params.desc.includes('tapped and attacking');
  const isOptionalPut = params.desc.toLowerCase().startsWith('you may');

  const allowedTypes: string[] = [];
  if (creatureTypeRestriction.includes(',') || creatureTypeRestriction.includes(' or ')) {
    const typeList = creatureTypeRestriction
      .replace(/,?\s*or\s+/g, ',')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    allowedTypes.push(...typeList);
  } else if (creatureTypeRestriction && creatureTypeRestriction !== 'creature') {
    allowedTypes.push(creatureTypeRestriction);
  }

  const hand = (params.state.zones?.[params.controller] as any)?.hand || [];
  const validCreatures = hand.filter((card: any) => {
    const typeLine = (card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return false;
    if (allowedTypes.length === 0) return true;
    return allowedTypes.some((allowedType) => typeLine.includes(allowedType));
  });

  if (validCreatures.length === 0) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: No valid ${allowedTypes.length > 0 ? allowedTypes.join('/') : 'creature'} cards in hand`);
    return true;
  }

  queuePutCreatureFromHandModal({
    ...params,
    validCreatures,
    typeDesc: allowedTypes.length > 0 ? allowedTypes.join('/') : 'creature',
    isOptionalPut,
    tappedAndAttacking: isTappedAndAttacking,
  });

  return true;
}

export function applyRetiredTriggerLegacyJoinForcesAttack(
  params: TriggerLegacyResolutionParams & {
    readonly description: string;
  },
): boolean {
  if (
    params.triggerItem?.triggerType !== 'join_forces_attack'
    && !(params.desc.includes('join forces') && params.desc.includes('each player may pay'))
  ) {
    return false;
  }

  if (skipRetiredTriggerLegacyHandler(params.desc || params.description, params.sourceName)) {
    return false;
  }

  const turnOrder = params.players.map((p: any) => p.id);
  const gameId = (params.ctx as any).gameId || 'unknown';

  if ((params.ctx as any).isReplaying) {
    debug(2, `[executeTriggerEffect] Join Forces: skipping resolution steps during replay`);
    return true;
  }

  const stepConfigs = params.players.map((p: any) => {
    const playerId = p.id;
    const isInitiator = playerId === params.controller;
    const battlefield = params.state.battlefield || [];
    const untappedLands = battlefield.filter((perm: any) =>
      perm.controller === playerId
      && !perm.tapped
      && (perm.card?.type_line || '').toLowerCase().includes('land'),
    ).length;

    return {
      type: ResolutionStepType.JOIN_FORCES,
      playerId,
      description: `${params.sourceName}: You may pay any amount of mana to contribute to this effect`,
      mandatory: false,
      sourceId: params.triggerItem.permanentId || params.triggerItem.sourceId,
      sourceName: params.sourceName || 'Join Forces Ability',
      sourceImage: params.triggerItem.value?.imageUrl || params.triggerItem.card?.image_uris?.small,
      cardName: params.sourceName || 'Join Forces Ability',
      effectDescription: params.description,
      cardImageUrl: params.triggerItem.value?.imageUrl,
      initiator: params.controller,
      availableMana: untappedLands,
      isInitiator,
    };
  });

  ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    stepConfigs,
    turnOrder,
    params.controller,
  );

  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const persistedSteps = queue.steps
      .filter((step: any) => step?.type === ResolutionStepType.JOIN_FORCES && String((step as any).cardName || '') === String(params.sourceName || 'Join Forces Ability'))
      .map((step: any) => ({
        id: String(step.id),
        type: String(step.type),
        playerId: String(step.playerId),
        description: String(step.description || ''),
        mandatory: step.mandatory !== false,
        sourceId: step.sourceId ? String(step.sourceId) : undefined,
        sourceName: step.sourceName ? String(step.sourceName) : undefined,
        sourceImage: step.sourceImage,
        cardName: step.cardName ? String(step.cardName) : undefined,
        effectDescription: step.effectDescription ? String(step.effectDescription) : undefined,
        cardImageUrl: step.cardImageUrl,
        initiator: step.initiator ? String(step.initiator) : undefined,
        availableMana: Number(step.availableMana || 0),
        isInitiator: step.isInitiator === true,
        priority: Number(step.priority || 0),
      }));

    appendEvent(gameId, Number((params.ctx as any).seq?.value ?? 0), 'joinForcesInitiated', {
      cardName: params.sourceName || 'Join Forces Ability',
      initiator: params.controller,
      steps: persistedSteps,
    });
  } catch (err) {
    debugWarn(1, '[executeTriggerEffect] Failed to persist joinForcesInitiated event:', err);
  }

  debug(1, `[executeTriggerEffect] Join Forces attack trigger from ${params.sourceName} - created ${params.players.length} resolution steps`);
  return true;
}
