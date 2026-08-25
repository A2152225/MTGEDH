// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: resolvePopulatePlayerId, buildPopulateTargetChoiceOption,
// resolveExploreTargetId, findBattlefieldPermanent, readPermanentName,
// isLandCard, getCardTypeLine.
// Public entry symbols: resolvePopulatePlayerId, buildPopulateTargetChoiceOption,
// resolveExploreTargetId, findBattlefieldPermanent, readPermanentName,
// isLandCard, getCardTypeLine.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { ChoiceOption } from '../choiceEventsTypes';
import type { OracleEffectStep } from '../oracleIR';
import { resolveSingleCreatureTargetId } from '../oracleIRExecutorCreatureStepUtils';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { resolvePlayers } from '../oracleIRExecutorPlayerUtils';

export function resolvePopulatePlayerId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!oracleStep || String((oracleStep as any).kind || '') !== 'populate') {
    return undefined;
  }

  const players = resolvePlayers(state, (oracleStep as any).who, ctx);
  return players.length === 1 ? String(players[0]) : undefined;
}

export function buildPopulateTargetChoiceOption(token: any): ChoiceOption {
  const id = String(token?.id || '').trim();
  const name = String(token?.card?.name || token?.name || id || 'Creature Token');
  return {
    id,
    label: name,
    description: 'Creature token',
    imageUrl: token?.imageUrl || token?.card?.imageUrl || token?.card?.image_uris?.normal,
  };
}

export function resolveExploreTargetId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!oracleStep || String((oracleStep as any).kind || '') !== 'explore' || !(oracleStep as any).target) {
    return undefined;
  }

  return resolveSingleCreatureTargetId(state, (oracleStep as any).target, ctx);
}

export function findBattlefieldPermanent(state: GameState, permanentId: string): any | undefined {
  return (((state as any).battlefield || []) as any[])
    .find(permanent => String(permanent?.id || '').trim() === permanentId);
}

export function readPermanentName(permanent: any, fallbackId: string): string {
  return String(permanent?.card?.name || permanent?.name || fallbackId || 'Creature');
}

export function isLandCard(card: any): boolean {
  return getCardTypeLine(card).includes('land');
}

export function getCardTypeLine(card: any): string {
  return String(card?.type_line || card?.card?.type_line || '').toLowerCase();
}
