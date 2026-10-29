/**
 * Origin parent: rules-engine/src/oracleIRExecutorMainLoop.ts
 * Cluster: each_player_choose_then_sacrifice_rest (Planetary Annihilation family).
 *   Halt when any chooser must pick which permanents to keep. When every chooser
 *   controls at most the printed count, nothing is sacrificed and later steps continue.
 * Public: applyEachPlayerChooseThenSacrificeRestStep,
 *   chooseThenSacrificeRestRequiresChoice, chooserPlayerIdsForSacrificeRest,
 *   playersWhoMustChooseForSacrificeRest, permanentMatchesChooseThenSacrificeKeepTypes
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorMainLoop.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

type SacrificeRestStep = Extract<OracleEffectStep, { kind: 'each_player_choose_then_sacrifice_rest' }>;

export function permanentMatchesChooseThenSacrificeKeepTypes(
  permanent: { readonly card?: { readonly type_line?: string }; readonly type_line?: string },
  keepTypes: readonly string[],
): boolean {
  if (keepTypes.includes('permanent')) return true;
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return keepTypes.some((typeWord) => new RegExp(`\\b${typeWord}s?\\b`, 'i').test(typeLine));
}

function readTargetPlayerId(ctx: OracleIRExecutionContext): string {
  const selector = ctx.selectorContext as { targetPlayerId?: string; thatPlayerId?: string } | undefined;
  return String(
    ctx.targetPlayerId || ctx.thatPlayerId || selector?.targetPlayerId || selector?.thatPlayerId || '',
  ).trim();
}

export function chooserPlayerIdsForSacrificeRest(
  state: GameState,
  step: SacrificeRestStep,
  ctx: OracleIRExecutionContext,
): string[] {
  const players = (Array.isArray(state.players) ? state.players : [])
    .filter((player: any) => player && !player.hasLost)
    .map((player: any) => String(player?.id || '').trim())
    .filter(Boolean);
  const controllerId = String(ctx.controllerId || '').trim();
  switch (step.choosers.kind) {
    case 'each_opponent':
      return players.filter((playerId) => playerId !== controllerId);
    case 'target_player':
    case 'target_opponent': {
      const targetId = readTargetPlayerId(ctx);
      return targetId ? [targetId] : [];
    }
    case 'raw': {
      if (/that player/i.test(String(step.choosers.text || ''))) {
        const targetId = readTargetPlayerId(ctx);
        return targetId ? [targetId] : [];
      }
      return players;
    }
    case 'each_player':
    default:
      return players;
  }
}

function matchingCountForPlayer(state: GameState, playerId: string, keepTypes: readonly string[]): number {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controller || '').trim() !== playerId) return false;
    return permanentMatchesChooseThenSacrificeKeepTypes(permanent, keepTypes);
  }).length;
}

export function playersWhoMustChooseForSacrificeRest(
  state: GameState,
  step: SacrificeRestStep,
  ctx: OracleIRExecutionContext,
): string[] {
  return chooserPlayerIdsForSacrificeRest(state, step, ctx).filter((playerId) => {
    const count = matchingCountForPlayer(state, playerId, step.keepTypes);
    if (step.upTo) return count > 0;
    return count > step.keepCount;
  });
}

export function chooseThenSacrificeRestRequiresChoice(
  state: GameState,
  step: SacrificeRestStep,
  ctx: OracleIRExecutionContext,
): boolean {
  const chooserIds = chooserPlayerIdsForSacrificeRest(state, step, ctx);
  if (chooserIds.length === 0 && step.choosers.kind !== 'each_player') return true;
  return playersWhoMustChooseForSacrificeRest(state, step, ctx).length > 0;
}

export function applyEachPlayerChooseThenSacrificeRestStep(
  state: GameState,
  step: SacrificeRestStep,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  if (chooseThenSacrificeRestRequiresChoice(state, step, ctx)) {
    const typeLabel = step.keepTypes.join(' or ');
    const amount = step.upTo ? `up to ${step.keepCount}` : String(step.keepCount);
    return {
      applied: false,
      message: `Each chooser must choose ${amount} ${typeLabel} they control before the rest are sacrificed: ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }
  return {
    applied: true,
    state,
    log: [`No permanents sacrificed; each chooser controls at most ${step.keepCount} matching permanents: ${step.raw}`],
  };
}
