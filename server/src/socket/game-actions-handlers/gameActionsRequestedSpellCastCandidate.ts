/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: turning a cast request into the shared castable-spell
 * candidate it refers to - graveyard cast permission gating, free-cast intent
 * and graveyard metadata stamped onto the candidate, and the delegated
 * graveyard cast ability (flashback / jump-start / retrace / escape).
 *
 * Public entry symbols: getRequestedSpellCastCandidate,
 * applySharedCandidateFreeCastIntent, applySharedGraveyardCandidateMetadata,
 * getDelegatedGraveyardCastAbilityId, buildManaCostStringFromParsedCost.
 */
import { getCastableSpellCandidates, type SharedSpellCastCandidate } from "../../state/modules/can-respond.js";
import {
  isFreeCastIntent,
  preferCandidateByCastPermissionId,
  resolveCastPermissionId,
  stampCastPermissionId,
  stampFreeCastIntent,
} from "../../state/modules/castIntent.js";
import { stringifyParsedManaCost } from "../../state/modules/mana-check.js";

export function buildManaCostStringFromParsedCost(parsedCost?: {
  generic?: number;
  colors?: Record<string, number>;
  hybrids?: Array<Array<string>>;
  hasX?: boolean;
}): string {
  if (!parsedCost || typeof parsedCost !== 'object') return '';
  return stringifyParsedManaCost({
    ...parsedCost,
    hybrid: Array.isArray(parsedCost.hybrids) ? parsedCost.hybrids : [],
  });
}

function isMainPhaseForSharedSpellGate(state: any): boolean {
  const step = String(state?.step || '').toUpperCase();
  return step === 'MAIN1' || step === 'MAIN2' || step === 'MAIN' || step === 'MAIN_1' || step === 'MAIN_2' || step.includes('MAIN');
}

function canCastRequestedSpellFromGraveyard(
  game: any,
  playerId: string,
  cardId: string,
  selectedSpellCard: any,
  selectedFaceIndex?: number,
): boolean {
  return Boolean(getRequestedSpellCastCandidate(game, playerId, cardId, selectedSpellCard, selectedFaceIndex));
}

export function getRequestedSpellCastCandidate(
  game: any,
  playerId: string,
  cardId: string,
  selectedSpellCard: any,
  selectedFaceIndex?: number,
  castPermissionId?: string,
  sourceZone: 'graveyard' | 'exile' | 'library' | 'hand' = 'graveyard',
): SharedSpellCastCandidate | undefined {
  const state = game?.state;
  if (!state || !playerId || !cardId) return undefined;

  const candidateMode = isMainPhaseForSharedSpellGate(state)
    && (!Array.isArray(state.stack) || state.stack.length === 0)
    && String(state.turnPlayer || '') === String(playerId)
      ? 'main'
      : 'response';

  const sharedCandidates = getCastableSpellCandidates({
    state,
    libraries: game?.libraries,
  } as any, playerId as any, {
    mode: candidateMode,
    allowUnknownCostFallback: false,
  });

  const matchingCandidates = sharedCandidates.filter((candidate) => {
    if (candidate.sourceZone !== sourceZone) return false;
    if (String(candidate.card?.id || '') !== String(cardId)) return false;
    if (selectedFaceIndex !== undefined && Number(candidate.castCard?.faceIndex ?? -1) !== Number(selectedFaceIndex)) {
      return false;
    }
    if (selectedSpellCard?.name && candidate.castCard?.name) {
      return String(candidate.castCard.name) === String(selectedSpellCard.name);
    }
    return true;
  });

  return preferCandidateByCastPermissionId(matchingCandidates, castPermissionId);
}

export function applySharedCandidateFreeCastIntent(
  sourceCard: any,
  castCard: any,
  candidate: SharedSpellCastCandidate | undefined,
): boolean {
  if (!candidate || !isFreeCastIntent(candidate as any)) return false;
  const targets = [sourceCard, castCard].filter((target) => target && typeof target === 'object');
  for (const target of targets) {
    stampFreeCastIntent(target as any, candidate as any, { force: true });
  }
  return true;
}

export function applySharedGraveyardCandidateMetadata(
  sourceCard: any,
  castCard: any,
  candidate: SharedSpellCastCandidate,
): void {
  const targets = [sourceCard, castCard].filter((target) => target && typeof target === 'object');
  const isKeywordGraveyardCast = candidate.sourceZone === 'graveyard'
    && ['flashback', 'jump-start', 'retrace', 'escape', 'harmonize', 'mayhem'].includes(String(candidate.castMethod || ''));
  const castPermissionId = resolveCastPermissionId(candidate);

  for (const target of targets) {
    if (candidate.sourceZone === 'graveyard') {
      (target as any).castFromGraveyard = true;
    }

    if (isKeywordGraveyardCast) {
      (target as any).castWithAbility = candidate.castMethod;
    } else {
      delete (target as any).castWithAbility;
    }

    if (isKeywordGraveyardCast && candidate.manaCost) {
      (target as any).graveyardCastManaCost = candidate.manaCost;
    } else {
      delete (target as any).graveyardCastManaCost;
    }

    if (candidate.exileAfterResolution === true) {
      (target as any).exileAfterResolution = true;
    } else {
      delete (target as any).exileAfterResolution;
    }

    if (candidate.leaveBattlefieldReplacementDestination === 'exile') {
      (target as any).leaveBattlefieldReplacementDestination = 'exile';
    } else {
      delete (target as any).leaveBattlefieldReplacementDestination;
    }

    if (candidate.leaveBattlefieldReplacementSourceName) {
      (target as any).leaveBattlefieldReplacementSourceName = candidate.leaveBattlefieldReplacementSourceName;
    } else {
      delete (target as any).leaveBattlefieldReplacementSourceName;
    }

    if (typeof candidate.leaveBattlefieldReplacementLifeGain === 'number' && candidate.leaveBattlefieldReplacementLifeGain > 0) {
      (target as any).leaveBattlefieldReplacementLifeGain = candidate.leaveBattlefieldReplacementLifeGain;
    } else {
      delete (target as any).leaveBattlefieldReplacementLifeGain;
    }

    if (candidate.sourceGrantedAdditionalCost) {
      (target as any).sourceGrantedAdditionalCost = { ...candidate.sourceGrantedAdditionalCost };
    } else {
      delete (target as any).sourceGrantedAdditionalCost;
    }

    stampCastPermissionId(target as any, castPermissionId || undefined);

    if (candidate.graveyardPermissionSourceName) {
      (target as any).graveyardPermissionSourceName = candidate.graveyardPermissionSourceName;
    } else {
      delete (target as any).graveyardPermissionSourceName;
    }

    if (candidate.graveyardPermissionCostMode) {
      (target as any).graveyardPermissionCostMode = candidate.graveyardPermissionCostMode;
    } else {
      delete (target as any).graveyardPermissionCostMode;
    }
  }

  applySharedCandidateFreeCastIntent(sourceCard, castCard, candidate);
}

export function getDelegatedGraveyardCastAbilityId(candidate?: SharedSpellCastCandidate): 'flashback' | 'jump-start' | 'retrace' | 'escape' | undefined {
  if (!candidate || candidate.sourceZone !== 'graveyard') {
    return undefined;
  }

  return candidate.castMethod === 'flashback'
    || candidate.castMethod === 'jump-start'
    || candidate.castMethod === 'retrace'
    || candidate.castMethod === 'escape'
    ? candidate.castMethod
    : undefined;
}
