// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: face-up zone helpers, applyTurnFaceUpStep, applyTurnFaceDownStep.
// Public entries: applyTurnFaceUpStep, applyTurnFaceDownStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { trySpecialTurnFaceDownStep } from './oracleIRExecutorSpecialTargetHandlers';
import { faceDownBattlefieldPermanent } from './oracleIRExecutorSpecialTargetCombatStatusHandlers';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

function collectZoneFaceUpCandidateCardIds(
  targetText: string,
  ctx: OracleIRExecutionContext
): string[] {
  const normalized = normalizeBattlefieldTargetReferenceText(targetText);
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  if (/^(?:the exiled card|that card)$/i.test(normalized)) {
    return Array.from(
      new Set(
        [
          'exile-linked-1',
          'exile-linked-2',
          ...chosenObjectIds.filter(id => id.startsWith('exile-')),
        ].filter(Boolean)
      )
    );
  }
  if (/^(?:this permanent|this creature|it)$/i.test(normalized)) {
    return Array.from(
      new Set(
        [
          String(ctx.sourceId || '').trim(),
          'gy-source-self',
          'bf-source-card',
          ...chosenObjectIds.filter(id => id.startsWith('gy-')),
        ].filter(Boolean)
      )
    );
  }
  return [];
}

function turnFaceDownCardsFaceUpInPlayerZones(
  state: GameState,
  wantedCardIds: readonly string[]
): { readonly state: GameState; readonly turnedCount: number } {
  const wantedIds = new Set(wantedCardIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wantedIds.size === 0) return { state, turnedCount: 0 };

  let turnedCount = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    let changed = false;
    const updateZone = (zoneName: 'graveyard' | 'hand' | 'exile') => {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      let zoneChanged = false;
      const nextZone = zone.map((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !wantedIds.has(cardId)) return card;
        if (card?.faceDown !== true) return card;
        const faceUpCard = { ...((card?.faceUpCard || card) as any) };
        if (!String(faceUpCard?.id || '').trim()) return card;
        delete faceUpCard.faceDown;
        faceUpCard.zone = zoneName;
        zoneChanged = true;
        turnedCount += 1;
        return faceUpCard;
      });
      if (!zoneChanged) return;
      changed = true;
      player = { ...player, [zoneName]: nextZone };
    };

    updateZone('graveyard');
    updateZone('hand');
    updateZone('exile');
    return changed ? player : player;
  });

  if (turnedCount === 0) return { state, turnedCount: 0 };
  return {
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    turnedCount,
  };
}

function applyTransformPermanentFromTurnFaceUpStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_up' }>,
  ctx: OracleIRExecutionContext,
  resolvedTargetIds: readonly string[],
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const sourceId = String(ctx.sourceId || '').trim();
  const targetIds = resolvedTargetIds.length > 0
    ? [...resolvedTargetIds]
    : (sourceId ? [sourceId] : []);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped transform (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let transformedCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    const faces = Array.isArray((perm as any)?.card?.card_faces) ? (perm as any).card.card_faces : [];
    if (faces.length < 2) return perm;
    const nextFaceIndex = (perm as any)?.transformed === true ? 0 : 1;
    const nextFace = faces[nextFaceIndex];
    if (!nextFace) return perm;
    transformedCount += 1;
    return {
      ...perm,
      transformed: nextFaceIndex === 1,
      card: {
        ...((perm as any).card || {}),
        name: nextFace.name || (perm as any).card?.name,
        ...(nextFace.type_line ? { type_line: nextFace.type_line } : {}),
        ...(typeof nextFace.oracle_text === 'string' ? { oracle_text: nextFace.oracle_text } : {}),
        ...('power' in nextFace ? { power: nextFace.power } : {}),
        ...('toughness' in nextFace ? { toughness: nextFace.toughness } : {}),
        ...(nextFace.image_uris ? { image_uris: nextFace.image_uris } : {}),
      },
    };
  });

  if (transformedCount === 0) {
    return {
      applied: false,
      message: `Skipped transform (target is not a double-faced permanent): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield as any } as GameState,
    log: [`Transformed ${transformedCount} permanent(s)`],
  };
}

export function applyTurnFaceUpStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_up' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedTargetText = normalizeBattlefieldTargetReferenceText(String((step.target as any)?.text || ''));
  const normalizedTarget = { ...(step.target as any), text: normalizedTargetText };
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, normalizedTarget as any, runtime);
  const directTargets =
    recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, normalizedTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );
  const cardReferenceIds = collectBoundBattlefieldIds(ctx);
  const fallbackTargetIds =
    targetIds.length > 0
      ? []
      : battlefield
          .filter((perm: any) =>
            cardReferenceIds.includes(String((perm as any)?.id || '').trim()) ||
            cardReferenceIds.includes(String((perm as any)?.card?.id || '').trim()) ||
            cardReferenceIds.includes(String((perm as any)?.faceUpCard?.id || '').trim())
          )
          .map((perm: any) => String((perm as any)?.id || '').trim())
          .filter(Boolean);
  const effectiveTargetIds = targetIds.length > 0 ? targetIds : fallbackTargetIds;

  if (/^transform\b/i.test(String(step.raw || ''))) {
    return applyTransformPermanentFromTurnFaceUpStep(state, step, ctx, effectiveTargetIds);
  }

  let turnedCount = 0;
  let nextState = state;

  if (effectiveTargetIds.length > 0) {
    const nextBattlefield = battlefield.map((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!effectiveTargetIds.includes(permanentId)) return perm;
      if ((perm as any)?.card?.faceDown !== true) return perm;

      const faceUpCard = { ...(((perm as any)?.faceUpCard || {}) as any) };
      if (!faceUpCard || !String(faceUpCard.id || '').trim()) return perm;
      delete faceUpCard.faceDown;
      faceUpCard.zone = 'battlefield';

      turnedCount += 1;
      const nextPerm: any = {
        ...perm,
        isFaceDown: false,
        card: faceUpCard,
        power: undefined,
        toughness: undefined,
        basePower: undefined,
        baseToughness: undefined,
        effectiveTypes: undefined,
        oracle_text: undefined,
        faceUpCard: undefined,
      };
      return nextPerm;
    });

    if (turnedCount > 0) {
      nextState = {
        ...(state as any),
        battlefield: nextBattlefield as any,
      } as GameState;
    }
  }

  if (turnedCount === 0) {
    const zoneResult = turnFaceDownCardsFaceUpInPlayerZones(
      nextState,
      collectZoneFaceUpCandidateCardIds(normalizedTargetText, ctx)
    );
    if (zoneResult.turnedCount > 0) {
      nextState = zoneResult.state;
      turnedCount = zoneResult.turnedCount;
    }
  }

  if (turnedCount === 0) {
    if (effectiveTargetIds.length > 0) {
      return {
        applied: false,
        message: `Skipped turn face up (target is not face down): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return {
      applied: false,
      message: `Skipped turn face up (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  return {
    applied: true,
    state: nextState,
    log: [`Turned ${turnedCount} card(s) face up`],
  };
}

export function applyTurnFaceDownStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'turn_face_down' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialTurnFaceDownStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped turn face down (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let turnedCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    if ((perm as any)?.card?.faceDown === true) return perm;

    const faceUpCard = { ...(((perm as any)?.card || {}) as any) };
    if (!faceUpCard || !String(faceUpCard.id || '').trim()) return perm;
    faceUpCard.zone = 'battlefield';

    turnedCount += 1;
    return faceDownBattlefieldPermanent({
      ...perm,
      faceUpCard,
    });
  });

  if (turnedCount === 0) {
    return {
      applied: false,
      message: `Skipped turn face down (target is already face down or lacks a card): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`Turned ${turnedCount} permanent(s) face down`],
  };
}

