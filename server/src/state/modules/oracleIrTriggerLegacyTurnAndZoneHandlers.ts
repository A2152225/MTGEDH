import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { addExtraTurn } from './turn.js';
import { queuePlayableFromExileChoiceStep } from './triggerPlayableFromExileUtils.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyTurnAndZoneParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly description: string;
  readonly desc?: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyExtraTurnAfterThisOne(
  params: Pick<TriggerLegacyTurnAndZoneParams, 'ctx' | 'controller' | 'sourceName' | 'description'>,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.description, params.sourceName)) {
    return false;
  }

  if (!/^(?:you\s+)?take\s+an\s+extra\s+turn\s+after\s+this\s+one\.?$/i.test(String(params.description || '').trim())) {
    return false;
  }

  addExtraTurn(params.ctx, String(params.controller), params.sourceName || 'Extra turn trigger');
  debug(2, `[executeTriggerEffect] Extra turn granted to ${params.controller} by ${params.sourceName}`);
  return true;
}

export function applyRetiredTriggerLegacyGainControlOfTargetOpponent(
  params: Pick<TriggerLegacyTurnAndZoneParams, 'ctx' | 'controller' | 'sourceName' | 'description' | 'triggerItem' | 'state'>,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.description, params.sourceName)) {
    return false;
  }

  if (!String(params.description || '').toLowerCase().includes('gain control of target opponent')) {
    return false;
  }

  const targets = params.triggerItem.targets || [];
  if (targets.length === 0) {
    return true;
  }

  const targetOpponentId = targets[0];
  const stateAny = params.state as any;
  stateAny.controlledPlayerNextTurn = stateAny.controlledPlayerNextTurn || {};
  stateAny.controlledPlayerNextTurn[targetOpponentId] = params.controller;

  addExtraTurn(params.ctx, targetOpponentId, params.sourceName || 'Emrakul, the Promised End (drawback)');
  debug(2, `[executeTriggerEffect] Emrakul, the Promised End cast trigger: player ${params.controller} will control ${targetOpponentId} next turn`);
  return true;
}

export function applyRetiredTriggerLegacyExileTargetPlayerGraveyard(
  params: Pick<TriggerLegacyTurnAndZoneParams, 'desc' | 'triggerItem' | 'state'>,
): boolean {
  const desc = String(params.desc || '');
  if (skipRetiredTriggerLegacyHandler(desc, '')) {
    return false;
  }

  if (!desc.includes('exile') || !desc.includes('graveyard') || !desc.includes('target player')) {
    return false;
  }

  const targetPlayerId = String(Array.isArray(params.triggerItem?.targets) ? params.triggerItem.targets[0] || '' : '').trim();
  if (!targetPlayerId) {
    return true;
  }

  const zones = params.state.zones = params.state.zones || {};
  const targetZones = zones[targetPlayerId] = zones[targetPlayerId] || {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };

  const graveyardCards = Array.isArray(targetZones.graveyard) ? targetZones.graveyard : [];
  const exileZone = Array.isArray(targetZones.exile) ? targetZones.exile : [];

  if (graveyardCards.length === 0) {
    return true;
  }

  for (const card of graveyardCards) {
    exileZone.push({ ...card, zone: 'exile' });
  }

  targetZones.graveyard = [];
  targetZones.graveyardCount = 0;
  targetZones.exile = exileZone;
  targetZones.exileCount = exileZone.length;
  return true;
}

export function applyRetiredTriggerLegacyExileTopTwoPlayableChoice(
  params: TriggerLegacyTurnAndZoneParams,
): boolean {
  const desc = String(params.desc || '');
  if (skipRetiredTriggerLegacyHandler(desc, params.sourceName)) {
    return false;
  }

  const currentTurn = Number((params.state as any).turnNumber ?? 0) || 0;

  if (
    /^exile the top two cards of your library\.\s*choose one of them\.\s*you may play that card this turn\.?$/i.test(desc)
  ) {
    return queuePlayableFromExileChoiceStep(params.ctx, String(params.controller || ''), params.sourceName, 2, {
      playableUntilTurn: currentTurn,
      playWindowText: 'this turn',
    });
  }

  if (
    /^exile the top two cards of your library\.\s*choose one of them\.\s*until the end of your next turn, you may play that card\.?$/i.test(desc)
  ) {
    return queuePlayableFromExileChoiceStep(params.ctx, String(params.controller || ''), params.sourceName, 2, {
      playableUntilTurn: currentTurn + 1,
      playWindowText: 'until the end of your next turn',
    });
  }

  return false;
}
