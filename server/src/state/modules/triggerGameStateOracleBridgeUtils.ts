import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../context.js';
import { transformPermanentToFace } from './day-night.js';
import { tryResolveThassasOracleWin } from './game-state-effects.js';
import { queueInitiativeVentureTrigger, resolveVentureProgress } from './triggerVentureUtils.js';

function normalizeEffectText(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
}

function collectEffectText(
  result: OracleIRExecutionResult,
  effectText?: string,
): string {
  const parts = [
    effectText,
    ...(result.appliedSteps || []).map((step) => String((step as any).raw || '')),
    ...(result.skippedSteps || []).map((step) => String((step as any).raw || '')),
  ].filter(Boolean);
  return normalizeEffectText(parts.join(' '));
}

function appliedStepKinds(result: OracleIRExecutionResult): Set<string> {
  return new Set(
    (result.appliedSteps || []).map((step: OracleEffectStep) => String(step.kind || '')),
  );
}

/**
 * Post-IR server bridge for monarch/initiative/venture/win/transform/city's blessing
 * (replaces legacy body hook; runs only for trigger resolution).
 */
export function bridgeGameStateOracleEffectsAfterOracleIR(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly sourceId?: string;
    readonly triggerItem?: any;
    readonly effectText?: string;
  },
): void {
  if (!params.triggerItem || (ctx as any).isReplaying) return;

  const desc = collectEffectText(result, params.effectText);
  const kinds = appliedStepKinds(result);
  const triggerSourceId = String(
    params.sourceId
    || params.triggerItem?.permanentId
    || params.triggerItem?.sourceId
    || params.triggerItem?.source
    || '',
  ).trim();

  if (!kinds.has('become_monarch') && (desc.includes('become the monarch') || desc.includes('you become the monarch'))) {
    state.monarch = params.controller;
  }

  const tookInitiative = kinds.has('take_initiative')
    || desc.includes('take the initiative')
    || desc.includes('you take the initiative');
  if (tookInitiative) {
    if (state.initiative !== params.controller) {
      state.initiative = params.controller;
    }
    if (triggerSourceId) {
      queueInitiativeVentureTrigger(ctx, params.controller, triggerSourceId);
    }
  }

  if (!tookInitiative && /\bventure into undercity\b/.test(desc)) {
    resolveVentureProgress(ctx, params.controller, params.sourceName, triggerSourceId, 'undercity');
    return;
  }

  if (!kinds.has('venture_into_dungeon') && /\bventure into the dungeon\b/.test(desc)) {
    resolveVentureProgress(ctx, params.controller, params.sourceName, triggerSourceId, 'dungeon');
    return;
  }

  if (desc.includes("you get the city's blessing")) {
    state.cityBlessing = state.cityBlessing || {};
    state.cityBlessing[String(params.controller)] = true;
  }

  const thassaConditionalWin = /if x is greater than or equal to the number of cards in your library.*you win the game/i.test(desc);
  if (!kinds.has('win_game')) {
    if (thassaConditionalWin || String(params.sourceName || '').toLowerCase().includes("thassa's oracle")) {
      tryResolveThassasOracleWin(ctx, params.controller, params.sourceName);
    } else if (desc.includes('you win the game') && !state.gameOver) {
      state.winner = params.controller;
      state.gameOver = true;
      state.winCondition = `${params.sourceName}: you win the game`;
    }
  }

  if (!desc.includes('transform')) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const triggerPermanentId = String(
    params.triggerItem?.permanentId || params.triggerItem?.sourceId || '',
  ).trim();
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
    transformPermanentToFace(permanent, 1, ctx);
  }
}
