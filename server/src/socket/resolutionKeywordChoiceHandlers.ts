/**
 * socket/resolutionKeywordChoiceHandlers.ts
 *
 * Keyword-choice resolution step handlers and shared helpers for
 * Riot / Unleash / Fabricate / Tribute / Mentor / Exploit / Modular /
 * Soulshift / Haunt (and exert/exploit stack push helpers).
 *
 * Extracted from resolution.ts to keep the main socket resolution module smaller.
 * Extort payment + X-value selection stay in resolution.ts (payment / cast coupling).
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import {
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import {
  broadcastGame,
  getPlayerName,
} from "./util.js";
import { uid, cardManaValue } from "../state/utils.js";
import { debugWarn } from "../utils/debug.js";
import type { GameContext } from "../state/context.js";
import { inferTriggeredAbilityTargetMetadata } from "../state/modules/inferTriggeredAbilityTargetMetadata.js";
import {
  extractControlledExploitTriggeredEffects,
  extractSelfExploitTriggeredEffects,
  pushSingleExploitRewardTrigger,
} from "../state/modules/exploitKeywordTriggerUtils.js";
import { queueSelfETBTriggersForPermanent } from "../state/modules/triggerEtbEntryEffects.js";
import { triggerETBEffectsForPermanent } from "../state/modules/triggerEtbPermanentEffects.js";
import { applyHauntExileToTarget } from "../state/modules/hauntKeywordUtils.js";
import { updateCounters } from "../state/modules/counters_tokens.js";

export function extractResolutionChoiceId(selections: any): string | null {
  if (typeof selections === 'string') return selections;
  if (Array.isArray(selections)) {
    if (selections.length === 0) return null;
    const first = selections[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      return String((first as any).optionId ?? (first as any).choice ?? (first as any).id ?? (first as any).value ?? '').trim() || null;
    }
    return null;
  }
  if (selections && typeof selections === 'object') {
    return String((selections as any).optionId ?? (selections as any).choice ?? (selections as any).id ?? (selections as any).value ?? '').trim() || null;
  }
  return null;
}

function findKeywordChoicePermanent(game: any, step: ResolutionStep): any | null {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const permanentId = String((step as any)?.permanentId || step.sourceId || '').trim();
  if (!permanentId) return null;
  return battlefield.find((permanent: any) => String(permanent?.id || '') === permanentId) || null;
}

export function emitKeywordChoiceChat(io: Server, gameId: string, sourceName: string, message: string): void {
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}_${Math.random()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${message}`,
    ts: Date.now(),
  });
}

export function appendKeywordPromptResolveEvent(
  gameId: string,
  game: any,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  payload: Record<string, any> = {},
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'keywordPromptResolve', {
      playerId: String(response.playerId || step.playerId || ''),
      resolvedStepId: String((step as any).id || ''),
      stepType: String(step.type || ''),
      sourceId: String(step.sourceId || ''),
      permanentId: String((step as any).permanentId || step.sourceId || ''),
      sourceName: String(step.sourceName || ''),
      cancelled: Boolean(response.cancelled),
      ...payload,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist keyword prompt resolve event:', err);
  }
}

export function cloneResolutionPermanentSnapshot(permanent: any): any {
  if (!permanent || typeof permanent !== 'object') {
    return undefined;
  }

  return {
    ...permanent,
    ...(permanent.card && typeof permanent.card === 'object'
      ? { card: { ...permanent.card } }
      : null),
    ...(permanent.counters && typeof permanent.counters === 'object'
      ? { counters: { ...permanent.counters } }
      : null),
  };
}

export function getResolutionSourcePermanentSnapshot(game: any, stepData: any, sourcePermanentId?: string): any {
  if (stepData?.sourcePermanentSnapshot && typeof stepData.sourcePermanentSnapshot === 'object') {
    return cloneResolutionPermanentSnapshot(stepData.sourcePermanentSnapshot);
  }

  const normalizedSourceId = String(sourcePermanentId || '').trim();
  if (!normalizedSourceId) {
    return undefined;
  }

  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const sourcePermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === normalizedSourceId);
  return cloneResolutionPermanentSnapshot(sourcePermanent);
}

export function buildTriggeredAbilitySourceContext(sourcePermanentSnapshot: any): Record<string, any> {
  if (!sourcePermanentSnapshot || typeof sourcePermanentSnapshot !== 'object') {
    return {};
  }

  return {
    ...(sourcePermanentSnapshot.card && typeof sourcePermanentSnapshot.card === 'object'
      ? { card: { ...(sourcePermanentSnapshot.card as any) } }
      : null),
    sourcePermanentSnapshot,
  };
}

function pushExploitTriggeredEffectOntoStack(
  game: any,
  gameId: string,
  sourceForMetadata: any,
  sourceSnapshot: any,
  controllerId: string,
  sourceName: string,
  trigger: { fullText: string; effectText: string },
  options?: {
    exploitedPermanentId?: string;
    exploitedPermanentName?: string;
    exploitedPermanentSnapshot?: any;
  },
): void {
  if ((game as any)?.isReplaying) {
    return;
  }

  const ctx = {
    gameId,
    state: game.state,
    zones: game.state?.zones,
    libraries: (game as any).libraries,
    commandZone: (game.state as any).commandZone || {},
    applyEvent: typeof (game as any).applyEvent === 'function' ? (game as any).applyEvent.bind(game) : undefined,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : undefined,
    seq: (game as any).seq,
    isReplaying: false,
  } as unknown as GameContext;

  pushSingleExploitRewardTrigger(ctx, gameId, trigger, {
    sourceForMetadata,
    sourceSnapshot,
    controllerId,
    sourceName,
    exploitedPermanentId: options?.exploitedPermanentId,
    exploitedPermanentName: options?.exploitedPermanentName,
    exploitedPermanentSnapshot: options?.exploitedPermanentSnapshot,
    persistEvent: true,
  });
}

export function pushExertTriggeredAbilityOntoStack(
  game: any,
  gameId: string,
  sourcePermanent: any,
  controllerId: string,
  rewardDescription: string,
  targets?: string[],
  options?: {
    boundGraveyardCardId?: string;
    boundGraveyardOwnerId?: string;
    preselectedTargetsPersisted?: boolean;
  },
): void {
  if ((game as any)?.isReplaying) {
    return;
  }

  const sourceSnapshot = cloneResolutionPermanentSnapshot(sourcePermanent);
  const sourceForMetadata = sourcePermanent || sourceSnapshot;
  const sourceName = String(sourcePermanent?.card?.name || sourceSnapshot?.card?.name || 'Exert').trim() || 'Exert';
  const defendingPlayerId = String(sourcePermanent?.attacking || sourceSnapshot?.attacking || '').trim();
  const metadata = inferTriggeredAbilityTargetMetadata(rewardDescription, {
    gameState: game.state,
    controllerId,
    sourceName,
    sourcePermanent: sourceForMetadata,
  });
  const normalizedTargets = Array.isArray(targets)
    ? targets.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const exertedPermanentId = String(sourcePermanent?.id || sourceSnapshot?.id || '').trim();
  const effectData = {
    ...(exertedPermanentId ? { exertedPermanentId } : null),
    ...(sourceName ? { exertedPermanentName: sourceName } : null),
    ...(sourceSnapshot && typeof sourceSnapshot === 'object' ? { exertedPermanentSnapshot: sourceSnapshot } : null),
  } as Record<string, any>;
  const triggerId = uid('trigger');
  const payload = {
    triggerId,
    sourceId: String(sourcePermanent?.id || sourceSnapshot?.id || ''),
    ...(sourcePermanent?.id || sourceSnapshot?.id ? { permanentId: String(sourcePermanent?.id || sourceSnapshot?.id || '') } : null),
    sourceName,
    controllerId,
    description: rewardDescription,
    triggerType: 'exert',
    effect: rewardDescription,
    mandatory: true,
    ...(normalizedTargets.length > 0 ? { targets: normalizedTargets } : null),
    ...(options?.preselectedTargetsPersisted === true ? { preselectedTargetsPersisted: true } : null),
    ...(typeof metadata.requiresTarget === 'boolean' ? { requiresTarget: metadata.requiresTarget } : null),
    ...(metadata.targetType ? { targetType: metadata.targetType } : null),
    ...(metadata.targetConstraint ? { targetConstraint: metadata.targetConstraint } : null),
    ...(metadata.requiresTarget === true && normalizedTargets.length === 0 ? { needsTargetSelection: true } : null),
    ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
    ...(metadata.targetDestination ? { targetDestination: metadata.targetDestination } : null),
    ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
    ...(metadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
    ...(metadata.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
    ...(metadata.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
    ...(metadata.targetAction ? { targetAction: metadata.targetAction } : null),
    ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
    ...(Array.isArray(metadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: metadata.targetFilterRequiredTypeWords } : null),
    ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
    ...(metadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
    ...(typeof metadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: metadata.targetFilterExactManaValue } : null),
    ...(typeof metadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: metadata.targetFilterMinManaValue } : null),
    ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
    ...(typeof metadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: metadata.targetTotalPowerLimit } : null),
    ...(metadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
    ...(metadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
    ...(typeof metadata.minTargets === 'number' ? { minTargets: metadata.minTargets } : null),
    ...(typeof metadata.maxTargets === 'number' ? { maxTargets: metadata.maxTargets } : null),
    ...(defendingPlayerId && !defendingPlayerId.startsWith('perm_') ? { defendingPlayer: defendingPlayerId } : null),
    ...(options?.boundGraveyardCardId ? { boundGraveyardCardId: String(options.boundGraveyardCardId) } : null),
    ...(options?.boundGraveyardOwnerId ? { boundGraveyardOwnerId: String(options.boundGraveyardOwnerId) } : null),
    ...(Object.keys(effectData).length > 0 ? { effectData } : null),
    ...(sourcePermanent?.card && typeof sourcePermanent.card === 'object' ? { card: { ...sourcePermanent.card } } : null),
    ...(sourceSnapshot && typeof sourceSnapshot === 'object' ? { sourcePermanentSnapshot: sourceSnapshot } : null),
  } as any;

  if (typeof (game as any).applyEvent === 'function') {
    (game as any).applyEvent({
      type: 'pushTriggeredAbility',
      ...payload,
    });
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', payload);
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist exert trigger pushTriggeredAbility:', err);
  }
}

export function matchesRequiredTypeWords(typeLineRaw: string, requiredWords: readonly any[]): boolean {
  const typeLine = String(typeLineRaw || '').toLowerCase();
  const words = (requiredWords || [])
    .map((typeWord) => String(typeWord || '').trim().toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return true;
  // "Angel or Human" is OR of groups; groups themselves are AND of words.
  if (words.includes('or')) {
    const groups: string[][] = [[]];
    for (const word of words) {
      if (word === 'or') groups.push([]);
      else groups[groups.length - 1].push(word);
    }
    return groups
      .filter((group) => group.length > 0)
      .some((group) => group.every((word) => typeLine.includes(word)));
  }
  return words.every((word) => typeLine.includes(word));
}

function matchesTriggeredGraveyardTargetForExert(card: any, metadata: ReturnType<typeof inferTriggeredAbilityTargetMetadata>): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (!typeLine) {
    return false;
  }

  if (metadata.targetFilterPermanentOnly === true) {
    const isPermanent = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some((typeWord) => typeLine.includes(typeWord));
    if (!isPermanent) {
      return false;
    }
  }

  if (Array.isArray(metadata.targetFilterTypes) && metadata.targetFilterTypes.length > 0) {
    const matchesIncludedType = metadata.targetFilterTypes.some((typeWord) => typeLine.includes(String(typeWord || '').toLowerCase()));
    if (!matchesIncludedType) {
      return false;
    }
  }

  if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {
    if (!matchesRequiredTypeWords(typeLine, metadata.targetFilterRequiredTypeWords)) {
      return false;
    }
  }

  if (Array.isArray(metadata.targetFilterExcludeTypes) && metadata.targetFilterExcludeTypes.length > 0) {
    const matchesExcludedType = metadata.targetFilterExcludeTypes.some((typeWord) => typeLine.includes(String(typeWord || '').toLowerCase()));
    if (matchesExcludedType) {
      return false;
    }
  }

  const manaValue = cardManaValue(card);
  if (typeof metadata.targetFilterExactManaValue === 'number' && Number.isFinite(metadata.targetFilterExactManaValue) && manaValue !== metadata.targetFilterExactManaValue) {
    return false;
  }
  if (typeof metadata.targetFilterMinManaValue === 'number' && Number.isFinite(metadata.targetFilterMinManaValue) && manaValue < metadata.targetFilterMinManaValue) {
    return false;
  }
  if (typeof metadata.targetFilterMaxManaValue === 'number' && Number.isFinite(metadata.targetFilterMaxManaValue) && manaValue > metadata.targetFilterMaxManaValue) {
    return false;
  }

  return true;
}

export function buildExertTriggeredGraveyardSelectionData(game: any, controllerId: string, sourcePermanent: any, rewardDescription: string) {
  const sourceName = String(sourcePermanent?.card?.name || 'Exert').trim() || 'Exert';
  const metadata = inferTriggeredAbilityTargetMetadata(rewardDescription, {
    gameState: game.state,
    controllerId,
    sourceName,
    sourcePermanent,
  });

  if (metadata.requiresTarget !== true || String(metadata.targetZone || '').toLowerCase() !== 'graveyard') {
    return null;
  }

  const targetDestination = String(metadata.targetDestination || '').toLowerCase();
  if (targetDestination !== 'battlefield' && targetDestination !== 'hand' && targetDestination !== 'library_top' && targetDestination !== 'library_bottom') {
    return null;
  }

  const zones = (game.state?.zones || {}) as Record<string, any>;
  const graveyardScope = String(metadata.targetGraveyardScope || 'your').toLowerCase();
  const graveyardOwners = graveyardScope === 'any'
    ? Object.keys(zones).filter((playerId) => Array.isArray(zones[playerId]?.graveyard) && zones[playerId].graveyard.length > 0)
    : graveyardScope === 'opponent'
      ? Object.keys(zones).filter((playerId) => String(playerId) !== String(controllerId) && Array.isArray(zones[playerId]?.graveyard) && zones[playerId].graveyard.length > 0)
      : [String(controllerId)];

  const validTargets = graveyardOwners
    .flatMap((graveyardOwner) => {
      const graveyard = Array.isArray(zones[graveyardOwner]?.graveyard) ? zones[graveyardOwner].graveyard : [];
      return graveyard
        .filter((card: any) => matchesTriggeredGraveyardTargetForExert(card, metadata))
        .map((card: any) => ({
          id: String(card?.id || ''),
          name: String(card?.name || card?.id || 'Card'),
          typeLine: String(card?.type_line || ''),
          manaCost: String(card?.mana_cost || ''),
          imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
          zoneOwnerId: String(graveyardOwner),
        }));
    })
    .filter((card: any) => Boolean(card.id));

  return {
    metadata,
    validTargets,
    graveyardOwners,
  };
}

export function handleRiotChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const choiceId = String(extractResolutionChoiceId(response.selections) || '').trim().toLowerCase();
  const permanent = findKeywordChoicePermanent(game, step);
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'riot', choiceId });
  if (!permanent || !choiceId) {
    debugWarn(1, `[Resolution] Riot choice could not be applied for step ${step.id}`);
    return;
  }

  const sourceName = String(step.sourceName || permanent.card?.name || 'Riot');
  if (choiceId === 'counter') {
    updateCounters(game as any, String(permanent.id), { '+1/+1': 1 });
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} chose a +1/+1 counter for ${permanent.card?.name || 'the creature'}.`
    );
  } else if (choiceId === 'haste') {
    const grantedAbilities = Array.isArray((permanent as any).grantedAbilities)
      ? (permanent as any).grantedAbilities
      : ((permanent as any).grantedAbilities = []);
    if (!grantedAbilities.some((ability: any) => String(ability || '').toLowerCase() === 'haste')) {
      grantedAbilities.push('Haste');
    }
    permanent.summoningSickness = false;
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} chose haste for ${permanent.card?.name || 'the creature'}.`
    );
  } else {
    debugWarn(1, `[Resolution] Unsupported riot choice "${choiceId}" for step ${step.id}`);
    return;
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export function handleUnleashChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const choiceId = String(extractResolutionChoiceId(response.selections) || '').trim().toLowerCase();
  const permanent = findKeywordChoicePermanent(game, step);
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'unleash', choiceId });
  if (!permanent || !choiceId) {
    debugWarn(1, `[Resolution] Unleash choice could not be applied for step ${step.id}`);
    return;
  }

  const sourceName = String(step.sourceName || permanent.card?.name || 'Unleash');
  if (choiceId === 'counter') {
    updateCounters(game as any, String(permanent.id), { '+1/+1': 1 });
    (permanent as any).unleashed = true;
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} unleashed ${permanent.card?.name || 'the creature'} with a +1/+1 counter.`
    );
  } else if (choiceId === 'none') {
    (permanent as any).unleashed = false;
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} chose not to unleash ${permanent.card?.name || 'the creature'}.`
    );
  } else {
    debugWarn(1, `[Resolution] Unsupported unleash choice "${choiceId}" for step ${step.id}`);
    return;
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export async function handleFabricateChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const choiceId = String(extractResolutionChoiceId(response.selections) || '').trim().toLowerCase();
  const permanent = findKeywordChoicePermanent(game, step);
  const amount = Math.max(1, Number((step as any).value || 1));
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'fabricate', choiceId, amount });
  if (!permanent || !choiceId) {
    debugWarn(1, `[Resolution] Fabricate choice could not be applied for step ${step.id}`);
    return;
  }

  const sourceName = String(step.sourceName || permanent.card?.name || 'Fabricate');

  if (choiceId === 'counters') {
    updateCounters(game as any, String(permanent.id), { '+1/+1': amount });
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} put ${amount} +1/+1 counter${amount === 1 ? '' : 's'} on ${permanent.card?.name || 'the creature'}.`
    );
  } else if (choiceId === 'tokens') {
    const { createToken } = await import('../state/modules/counters_tokens.js');
    createToken(
      {
        state: game.state,
        bumpSeq: () => game.bumpSeq?.(),
        libraries: (game as any).libraries,
        commandZone: (game as any).commandZone || {},
        gameId,
      } as any,
      response.playerId as any,
      'Servo',
      amount,
      1,
      1,
      {
        typeLine: 'Token Artifact Creature — Servo',
        isArtifact: true,
      }
    );
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} created ${amount} 1/1 Servo token${amount === 1 ? '' : 's'}.`
    );
  } else {
    debugWarn(1, `[Resolution] Unsupported fabricate choice "${choiceId}" for step ${step.id}`);
    return;
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export async function handleTributeChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const choiceId = String(extractResolutionChoiceId(response.selections) || '').trim().toLowerCase();
  const permanent = findKeywordChoicePermanent(game, step);
  const amount = Math.max(1, Number((step as any).value || 1));
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'tribute', choiceId, amount });
  if (!permanent || !choiceId) {
    debugWarn(1, `[Resolution] Tribute choice could not be applied for step ${step.id}`);
    return;
  }

  const sourceName = String(step.sourceName || permanent.card?.name || 'Tribute');
  const controllerId = String((permanent as any).controller || response.playerId || '').trim();

  const applyTributeOutcome = (wasPaid: boolean) => {
    (permanent as any).tributePaid = wasPaid;
    (permanent as any).tributeWasPaid = wasPaid;
    if ((permanent as any).card && typeof (permanent as any).card === 'object') {
      (permanent as any).card.tributePaid = wasPaid;
      (permanent as any).card.tributeWasPaid = wasPaid;
    }
  };

  if (choiceId === 'pay') {
    updateCounters(game as any, String(permanent.id), { '+1/+1': amount });
    applyTributeOutcome(true);
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} paid tribute and put ${amount} +1/+1 counter${amount === 1 ? '' : 's'} on ${permanent.card?.name || 'the creature'}.`
    );
  } else if (choiceId === 'decline') {
    applyTributeOutcome(false);
    emitKeywordChoiceChat(
      io,
      gameId,
      sourceName,
      `${getPlayerName(game, response.playerId)} declined tribute for ${permanent.card?.name || 'the creature'}.`
    );
  } else {
    debugWarn(1, `[Resolution] Unsupported tribute choice "${choiceId}" for step ${step.id}`);
    return;
  }

  const tributeCtx = {
    state: game.state,
    gameId,
    inactive: new Set(),
    libraries: (game as any).libraries,
    players: game.state?.players || [],
    bumpSeq: () => game.bumpSeq?.(),
    commandZone: (game as any).commandZone || {},
  } as any;

  queueSelfETBTriggersForPermanent(tributeCtx, permanent, controllerId as any);
  triggerETBEffectsForPermanent(tributeCtx, permanent, controllerId as any, false);

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export function handleMentorTargetResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const targetId = String(extractResolutionChoiceId(response.selections) || '').trim();
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'mentor', targetId });
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const sourcePermanent = findKeywordChoicePermanent(game, step);
  const targetPermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === targetId) || null;
  const validTargetIds = new Set(
    (Array.isArray((step as any)?.targets) ? (step as any).targets : [])
      .map((target: any) => String(target?.id || '').trim())
      .filter(Boolean)
  );

  if (!sourcePermanent || !targetPermanent || !targetId || !validTargetIds.has(targetId)) {
    debugWarn(1, `[Resolution] Mentor target could not be applied for step ${step.id}`);
    return;
  }

  updateCounters(game as any, String(targetPermanent.id), { '+1/+1': 1 });

  const sourceName = String(step.sourceName || sourcePermanent.card?.name || 'Mentor');
  emitKeywordChoiceChat(
    io,
    gameId,
    sourceName,
    `${getPlayerName(game, response.playerId)} put a +1/+1 counter on ${targetPermanent.card?.name || 'the target creature'} with mentor.`
  );

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export async function handleExploitChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const selectedPermanentId = String(extractResolutionChoiceId(response.selections) || '').trim();
  if (response.cancelled) {
    appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'exploit', selectedPermanentId });
    return;
  }

  const sourcePermanent = findKeywordChoicePermanent(game, step);
  const sourceSnapshot = cloneResolutionPermanentSnapshot(sourcePermanent);
  const controllerId = String(step.playerId || response.playerId || '').trim();
  const validCreatureIds = new Set(
    (Array.isArray((step as any)?.creatures) ? (step as any).creatures : [])
      .map((creature: any) => String(creature?.id || '').trim())
      .filter(Boolean)
  );
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const selectedPermanent = battlefield.find((permanent: any) => String(permanent?.id || '').trim() === selectedPermanentId) || null;
  const sourceName = String(step.sourceName || sourcePermanent?.card?.name || sourceSnapshot?.card?.name || 'Exploit');

  if (!selectedPermanentId || !validCreatureIds.has(selectedPermanentId) || !selectedPermanent) {
    debugWarn(1, `[Resolution] Exploit choice could not be applied for step ${step.id}`);
    return;
  }

  const ctx = {
    gameId,
    state: game.state,
    zones: game.state?.zones,
    libraries: (game as any).libraries,
    commandZone: (game.state as any).commandZone || {},
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
  } as unknown as GameContext;

  const { movePermanentToGraveyard } = await import('../state/modules/counters_tokens.js');
  const moved = movePermanentToGraveyard(ctx, selectedPermanentId, true);
  if (!moved) {
    debugWarn(1, `[Resolution] Exploit sacrifice failed for step ${step.id}`);
    return;
  }

  emitKeywordChoiceChat(
    io,
    gameId,
    sourceName,
    `${getPlayerName(game, controllerId)} sacrificed ${selectedPermanent?.card?.name || 'a creature'} for exploit.`
  );

  const currentBattlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const currentSourcePermanent = currentBattlefield.find((permanent: any) => String(permanent?.id || '').trim() === String((step as any)?.permanentId || step.sourceId || '').trim()) || null;
  const sourceCard = currentSourcePermanent?.card || sourceSnapshot?.card;
  const exploitTriggers = extractSelfExploitTriggeredEffects(sourceCard, sourceName);
  const exploitedPermanentSnapshot = cloneResolutionPermanentSnapshot(selectedPermanent);
  const exploitedPermanentName = String(selectedPermanent?.card?.name || exploitedPermanentSnapshot?.card?.name || '').trim();

  for (const trigger of exploitTriggers) {
    pushExploitTriggeredEffectOntoStack(
      game,
      gameId,
      currentSourcePermanent,
      sourceSnapshot,
      controllerId,
      sourceName,
      trigger,
      {
        exploitedPermanentId: selectedPermanentId,
        ...(exploitedPermanentName ? { exploitedPermanentName } : null),
        ...(exploitedPermanentSnapshot && typeof exploitedPermanentSnapshot === 'object'
          ? { exploitedPermanentSnapshot }
          : null),
      },
    );
  }

  const exploitWatchers = currentBattlefield.filter((permanent: any) => String(permanent?.controller || '').trim() === controllerId);
  for (const watcher of exploitWatchers) {
    const watcherName = String(watcher?.card?.name || watcher?.id || 'Exploit');
    const watcherTriggers = extractControlledExploitTriggeredEffects(watcher?.card);
    for (const trigger of watcherTriggers) {
      pushExploitTriggeredEffectOntoStack(
        game,
        gameId,
        watcher,
        cloneResolutionPermanentSnapshot(watcher),
        controllerId,
        watcherName,
        trigger,
        {
          exploitedPermanentId: selectedPermanentId,
          ...(exploitedPermanentName ? { exploitedPermanentName } : null),
          ...(exploitedPermanentSnapshot && typeof exploitedPermanentSnapshot === 'object'
            ? { exploitedPermanentSnapshot }
            : null),
        },
      );
    }
  }

  appendKeywordPromptResolveEvent(gameId, game, step, response, {
    keyword: 'exploit',
    selectedPermanentId,
    sourceName,
    sourceId: String((step as any)?.permanentId || step.sourceId || '').trim(),
    permanentId: String((step as any)?.permanentId || step.sourceId || '').trim(),
    sourcePermanentSnapshot: cloneResolutionPermanentSnapshot(currentSourcePermanent || sourceSnapshot),
    exploitedPermanentName,
    exploitedPermanentSnapshot,
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export function handleModularChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const targetId = String(extractResolutionChoiceId(response.selections) || '').trim();
  const amount = Math.max(1, Number((step as any).value || 1));
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'modular', targetId, amount });
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const targetPermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === targetId) || null;
  const validTargetIds = new Set(
    (Array.isArray((step as any)?.targets) ? (step as any).targets : [])
      .map((target: any) => String(target?.id || '').trim())
      .filter(Boolean)
  );
  if (!targetPermanent || !targetId || !validTargetIds.has(targetId)) {
    debugWarn(1, `[Resolution] Modular choice could not be applied for step ${step.id}`);
    return;
  }

  updateCounters(game as any, String(targetPermanent.id), { '+1/+1': amount });

  const sourceName = String(step.sourceName || 'Modular');
  emitKeywordChoiceChat(
    io,
    gameId,
    sourceName,
    `${getPlayerName(game, response.playerId)} moved ${amount} +1/+1 counter${amount === 1 ? '' : 's'} onto ${targetPermanent.card?.name || 'the artifact creature'} with modular.`
  );

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export function handleSoulshiftTargetResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const selectedCardId = String(extractResolutionChoiceId(response.selections) || '').trim();
  appendKeywordPromptResolveEvent(gameId, game, step, response, { keyword: 'soulshift', selectedCardId });
  const validTargetIds = new Set(
    (Array.isArray((step as any)?.spirits) ? (step as any).spirits : [])
      .map((target: any) => String(target?.id || '').trim())
      .filter(Boolean)
  );
  const playerId = String(step.playerId || response.playerId || '').trim();
  const zones = ((game.state as any).zones = (game.state as any).zones || {});
  const playerZones = (zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
    library: [],
    libraryCount: 0,
  });
  playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

  const graveyardIndex = playerZones.graveyard.findIndex((card: any) => String(card?.id || '') === selectedCardId);
  if (!selectedCardId || !validTargetIds.has(selectedCardId) || graveyardIndex < 0) {
    debugWarn(1, `[Resolution] Soulshift target could not be applied for step ${step.id}`);
    return;
  }

  const [selectedCard] = playerZones.graveyard.splice(graveyardIndex, 1);
  playerZones.hand.push(selectedCard);
  playerZones.handCount = playerZones.hand.length;
  playerZones.graveyardCount = playerZones.graveyard.length;

  const sourceName = String(step.sourceName || 'Soulshift');
  emitKeywordChoiceChat(
    io,
    gameId,
    sourceName,
    `${getPlayerName(game, response.playerId)} returned ${selectedCard?.name || 'a Spirit card'} from the graveyard to their hand with soulshift.`
  );

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export function handleHauntTargetResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const selectedPermanentId = String(extractResolutionChoiceId(response.selections) || '').trim();
  const hauntCardId = String((step as any)?.hauntCardId || step.sourceId || '').trim();
  const ownerId = String((step as any)?.ownerId || response.playerId || step.playerId || '').trim();
  appendKeywordPromptResolveEvent(gameId, game, step, response, {
    keyword: 'haunt',
    selectedPermanentId,
    hauntCardId,
    ownerId,
  });
  const validTargetIds = new Set(
    (Array.isArray((step as any)?.targets) ? (step as any).targets : [])
      .map((target: any) => String(target?.id || '').trim())
      .filter(Boolean)
  );
  if (!selectedPermanentId || !validTargetIds.has(selectedPermanentId) || !hauntCardId || !ownerId) {
    debugWarn(1, `[Resolution] Haunt target could not be applied for step ${step.id}`);
    return;
  }

  const applied = applyHauntExileToTarget(game.state, {
    ownerId,
    hauntCardId,
    targetPermanentId: selectedPermanentId,
    sourceName: String(step.sourceName || ''),
  });
  if (!applied.applied) {
    debugWarn(1, `[Resolution] Haunt exile failed for step ${step.id}`);
    return;
  }

  const sourceName = String(step.sourceName || 'Haunt');
  const targetName = String(
    (Array.isArray((step as any)?.targets) ? (step as any).targets : [])
      .find((target: any) => String(target?.id || '') === selectedPermanentId)?.name
    || 'a creature',
  );
  emitKeywordChoiceChat(
    io,
    gameId,
    sourceName,
    `${getPlayerName(game, response.playerId)} exiled ${applied.card?.name || sourceName} haunting ${targetName}.`
  );

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

