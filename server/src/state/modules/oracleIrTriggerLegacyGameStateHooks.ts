import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { transformPermanentToFace } from './day-night.js';
import { tryResolveThassasOracleWin } from './game-state-effects.js';
import { queueInitiativeVentureTrigger, resolveVentureProgress } from './triggerVentureUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyGameStateHookParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly triggerSourceId: string;
}

export function applyRetiredTriggerLegacyGameStateOracleHooks(
  params: TriggerLegacyGameStateHookParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  let initiativeTriggeredThisEffect = false;

  if (params.desc.includes('become the monarch') || params.desc.includes('you become the monarch')) {
    (params.state as any).monarch = params.controller;
  }

  if (params.desc.includes('take the initiative') || params.desc.includes('you take the initiative')) {
    (params.state as any).initiative = params.controller;
    initiativeTriggeredThisEffect = true;
    queueInitiativeVentureTrigger(params.ctx, params.controller, params.triggerSourceId);
  }

  if (!initiativeTriggeredThisEffect && /\bventure into undercity\b/.test(params.desc)) {
    resolveVentureProgress(params.ctx, params.controller, params.sourceName, params.triggerSourceId, 'undercity');
    return true;
  }

  if (/\bventure into the dungeon\b/.test(params.desc)) {
    resolveVentureProgress(params.ctx, params.controller, params.sourceName, params.triggerSourceId, 'dungeon');
    return true;
  }

  if (params.desc.includes("you get the city's blessing")) {
    (params.state as any).cityBlessing = (params.state as any).cityBlessing || {};
    (params.state as any).cityBlessing[String(params.controller)] = true;
  }

  const thassaConditionalWin = /if x is greater than or equal to the number of cards in your library.*you win the game/i.test(params.desc);
  if (thassaConditionalWin || String(params.sourceName || '').toLowerCase().includes("thassa's oracle")) {
    tryResolveThassasOracleWin(params.ctx, params.controller, params.sourceName);
  } else if (params.desc.includes('you win the game') && !(params.state as any).gameOver) {
    (params.state as any).winner = params.controller;
    (params.state as any).gameOver = true;
    (params.state as any).winCondition = `${params.sourceName}: you win the game`;
  }

  if (params.desc.includes('transform')) {
    const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
    const triggerPermanentId = String(params.triggerItem?.permanentId || params.triggerItem?.sourceId || '').trim();
    const sourceNameCandidates = new Set(
      [
        String(params.sourceName || '').trim().toLowerCase(),
        String(params.triggerItem?.sourceName || '').trim().toLowerCase(),
      ].filter(Boolean),
    );

    const permanent = battlefield.find((perm: any) => {
      if (!perm) return false;
      if (triggerPermanentId && String(perm.id || '') === triggerPermanentId) return true;
      const name = String(perm.card?.name || '').trim().toLowerCase();
      return sourceNameCandidates.has(name);
    });

    if (permanent) {
      transformPermanentToFace(permanent, 1);
      return true;
    }
  }

  return false;
}
