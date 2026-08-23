/**
 * socket/resolutionGraveyardSelectionHelperUtils.ts
 *
 * Small helpers used by graveyard-selection apply/resume paths (and a few
 * other resolution flows). Extracted from resolution.ts to avoid circular imports.
 */

import { debugWarn } from "../utils/debug.js";
import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";

export function markPermanentEnteredFromZone(permanent: any, zone: string): void {
  const normalizedZone = String(zone || '').trim().toLowerCase();
  if (!permanent || !normalizedZone) return;

  permanent.enteredFromZone = normalizedZone;
  if (normalizedZone === 'graveyard') {
    permanent.enteredFromGraveyard = true;
  }

  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card = {
      ...(permanent.card as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }

  if (permanent.faceUpCard && typeof permanent.faceUpCard === 'object') {
    permanent.faceUpCard = {
      ...(permanent.faceUpCard as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }
}

export function finalizeBattlefieldAbilitySelfExertCost(
  game: any,
  gameId: string,
  controllerId: string,
  permanentId: string,
  requiresSelfExertForCost: boolean,
): string | undefined {
  if (!requiresSelfExertForCost) {
    return undefined;
  }

  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permanentId)) as any;
  if (!permanent) {
    return undefined;
  }

  permanent.doesntUntapNextTurn = true;
  permanent.exertedThisTurn = true;

  try {
    pushWheneverYouExertTriggersOntoStack(game, gameId, controllerId, String(permanentId));
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to push deferred whenever-you-exert triggers:', err);
  }

  return String(permanentId);
}

export function triggeredSourceExilesSpellCastThisWay(effectText: string): boolean {
  const normalized = String(effectText || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return /\bif\s+(?:a|that|this)\s+(?:card|spell)\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead\b/.test(normalized)
    || /\bif\s+(?:a|that|this)\s+(?:card|spell)\s+cast\s+this\s+way\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead\b/.test(normalized);
}

export function getNextEndStepFireTurnNumberForResolution(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const currentPhase = String(state?.phase ?? '').toLowerCase();
  const currentStepUpper = String(state?.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  return inEnding ? currentTurn + 1 : currentTurn;
}

export function getNextUpkeepNotBeforeTurnNumberForResolution(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  return currentTurn + 1;
}
