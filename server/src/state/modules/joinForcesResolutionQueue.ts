import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { listLivingGamePlayers } from './priorityEligibility.js';

export function isJoinForcesEffectText(effectText: string): boolean {
  const lower = String(effectText || '').toLowerCase();
  return (
    lower.includes('join forces')
    && lower.includes('each player')
    && lower.includes('may pay')
  );
}

export function isJoinForcesTriggerEffect(triggerItem: any, effectText: string): boolean {
  if (String(triggerItem?.triggerType || '') === 'join_forces_attack') {
    return true;
  }
  return isJoinForcesEffectText(effectText);
}

function countUntappedLandsForPlayer(battlefield: readonly any[], playerId: string): number {
  return battlefield.filter((perm: any) =>
    String(perm?.controller || '') === playerId
    && !perm?.tapped
    && String(perm?.card?.type_line || '').toLowerCase().includes('land'),
  ).length;
}

function serializeJoinForcesSteps(
  steps: readonly any[],
  cardName: string,
): Array<Record<string, unknown>> {
  return steps
    .filter((step: any) =>
      step?.type === ResolutionStepType.JOIN_FORCES
      && String(step?.cardName || '') === cardName,
    )
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
      oracleIrResumeStepsJson: step.oracleIrResumeStepsJson
        ? String(step.oracleIrResumeStepsJson)
        : undefined,
      oracleIrControllerId: step.oracleIrControllerId ? String(step.oracleIrControllerId) : undefined,
      oracleIrSourceId: step.oracleIrSourceId ? String(step.oracleIrSourceId) : undefined,
      oracleIrSourceName: step.oracleIrSourceName ? String(step.oracleIrSourceName) : undefined,
    }));
}

export function queueJoinForcesResolutionSteps(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    cardName: string;
    sourceId?: string;
    sourceName?: string;
    sourceImage?: string;
    effectDescription: string;
    cardImageUrl?: string;
    logPrefix?: string;
    oracleIrResumeStepsJson?: string;
    oracleIrControllerId?: string;
    oracleIrSourceId?: string;
    oracleIrSourceName?: string;
  },
): boolean {
  const state = (ctx as any).state;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;

  const cardName = String(params.cardName || 'Join Forces').trim() || 'Join Forces';
  const controller = params.controller;
  const players = listLivingGamePlayers(ctx);
  if (players.length === 0) return false;

  const existingQueue = ResolutionQueueManager.getQueue(gameId);
  const alreadyQueued = (existingQueue.steps || []).some(
    (step: any) =>
      String(step?.type || '') === String(ResolutionStepType.JOIN_FORCES)
      && String(step?.cardName || '') === cardName,
  );
  if (alreadyQueued) {
    debug(2, `[${params.logPrefix || 'joinForces'}] ${cardName} already queued JOIN_FORCES; skip duplicate`);
    return true;
  }

  if ((ctx as any).isReplaying) {
    debug(2, `[${params.logPrefix || 'joinForces'}] skipping resolution steps during replay`);
    return true;
  }

  const turnOrder = players.map((player: any) => player.id);
  const battlefield = state.battlefield || [];
  const resumeJson = String(params.oracleIrResumeStepsJson || '').trim();
  const resumeFields = resumeJson
    ? {
        oracleIrResumeStepsJson: resumeJson,
        oracleIrControllerId: String(params.oracleIrControllerId || controller).trim() || undefined,
        oracleIrSourceId: String(params.oracleIrSourceId || params.sourceId || '').trim() || undefined,
        oracleIrSourceName: String(params.oracleIrSourceName || params.sourceName || cardName).trim() || undefined,
      }
    : {};

  const stepConfigs = players.map((player: any) => {
    const playerId = String(player.id || '').trim() as PlayerID;
    return {
      type: ResolutionStepType.JOIN_FORCES,
      playerId,
      description: `${cardName}: You may pay any amount of mana to contribute to this effect`,
      mandatory: false,
      sourceId: params.sourceId,
      sourceName: params.sourceName || cardName,
      sourceImage: params.sourceImage,
      cardName,
      effectDescription: params.effectDescription,
      cardImageUrl: params.cardImageUrl,
      initiator: controller,
      availableMana: countUntappedLandsForPlayer(battlefield, playerId),
      isInitiator: playerId === controller,
      ...resumeFields,
    };
  });

  ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    stepConfigs,
    turnOrder,
    controller,
  );

  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const persistedSteps = serializeJoinForcesSteps(queue.steps, cardName);
    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'joinForcesInitiated', {
      cardName,
      initiator: controller,
      steps: persistedSteps,
    });
  } catch (err) {
    debugWarn(1, `[${params.logPrefix || 'joinForces'}] Failed to persist joinForcesInitiated event:`, err);
  }

  debug(
    1,
    `[${params.logPrefix || 'joinForces'}] ${cardName} created ${players.length} JOIN_FORCES resolution steps`,
  );
  return true;
}

export function applyJoinForcesPaidManaPowerPump(
  battlefield: any[],
  params: {
    cardName: string;
    totalContributions: number;
    effectDescription?: string;
    sourcePermanentId?: string;
  },
): boolean {
  const lower = String(params.effectDescription || '').toLowerCase();
  if (!lower.includes('total amount of mana paid') || !/\+\s*x\s*\/\s*\+0/i.test(lower)) {
    return false;
  }

  const cardNameLower = String(params.cardName || '').toLowerCase();
  const permanent = params.sourcePermanentId
    ? battlefield.find((entry: any) => String(entry?.id || '') === String(params.sourcePermanentId))
    : battlefield.find((entry: any) => String(entry?.card?.name || '').toLowerCase() === cardNameLower);
  if (!permanent) return false;

  permanent.temporaryPTMods = permanent.temporaryPTMods || [];
  permanent.temporaryPTMods.push({
    power: Math.max(0, Math.floor(Number(params.totalContributions) || 0)),
    toughness: 0,
    until: 'end_of_turn',
  });
  return true;
}
