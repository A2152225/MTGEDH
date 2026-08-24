/**
 * Origin parent: stackExecuteTriggerChosenTypeUtils.ts
 *
 * Cluster: "create a token that's a copy of that creature. That token gains haste.
 * Exile it at the beginning of the next end step." (Molten Echoes / Kindred Charge
 * trigger clauses). Generic chosen-type copy riders — not card-name routing.
 *
 * Public entry: tryResolveCopyThatCreatureHasteExile
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { createCopyTokensOfCard } from './counters_tokens.js';

function isCopyThatCreatureHasteExileEffect(text: string): boolean {
  const lower = String(text || '').toLowerCase();
  if (!/create a token that(?:'s| is) a copy of that creature/.test(lower)) return false;
  if (!/\bgains? haste\b/.test(lower)) return false;
  return /\bexile (?:it|them|that token|those tokens)\b/.test(lower)
    && /\bnext end step\b/.test(lower);
}

function resolveCopiedCreatureId(triggerItem: any): string {
  return String(
    triggerItem?.interveningIfSubjectPermanentId
    || triggerItem?.targetPermanentId
    || triggerItem?.effectData?.enteringPermanentId
    || (Array.isArray(triggerItem?.chosenObjectIds) ? triggerItem.chosenObjectIds[0] : '')
    || '',
  ).trim();
}

export function tryResolveCopyThatCreatureHasteExile(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  effectText: string,
  triggerItem: any,
): boolean {
  if (!isCopyThatCreatureHasteExileEffect(effectText)) return false;

  const sourceId = resolveCopiedCreatureId(triggerItem);
  const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  const sourcePermanent = sourceId
    ? battlefield.find((perm: any) => String(perm?.id || '') === sourceId)
    : undefined;
  const sourceCard = sourcePermanent?.card;
  if (!sourceCard) {
    debug(2, `[tryResolveCopyThatCreatureHasteExile] ${sourceName}: no bound creature to copy`);
    return true;
  }

  const createdIds = createCopyTokensOfCard(ctx, controller, sourceCard, 1);
  if (createdIds.length === 0) return true;

  const state = (ctx as any).state;
  const currentTurn = Number(state.turnNumber ?? 0) || 0;
  const currentPhase = String(state.phase ?? '').toLowerCase();
  const currentStepUpper = String(state.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

  state.pendingExileAtNextEndStep = Array.isArray(state.pendingExileAtNextEndStep)
    ? state.pendingExileAtNextEndStep
    : [];

  for (const tokenId of createdIds) {
    const token = (state.battlefield || []).find((perm: any) => perm?.id === tokenId);
    if (token) {
      token.tempAbilities = Array.isArray(token.tempAbilities) ? token.tempAbilities : [];
      if (!token.tempAbilities.some((ability: unknown) => String(ability).toLowerCase() === 'haste')) {
        token.tempAbilities.push('haste');
      }
      token.summoningSickness = false;
    }

    if (!state.pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === tokenId)) {
      state.pendingExileAtNextEndStep.push({
        permanentId: tokenId,
        fireAtTurnNumber,
        sourceName,
        createdBy: controller,
      });
    }
  }

  debug(2, `[tryResolveCopyThatCreatureHasteExile] ${sourceName}: copied ${sourceCard.name || sourceId} with haste`);
  return true;
}
