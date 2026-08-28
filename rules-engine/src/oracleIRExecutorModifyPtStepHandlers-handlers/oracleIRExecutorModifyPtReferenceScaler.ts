/**
 * Origin parent: oracleIRExecutorModifyPtStepHandlers.ts
 * Cluster moved: resolveReferenceScalerScale
 * Public: resolveReferenceScalerScale
 */

import type { GameState, PlayerID } from '../../../shared/src';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import type { OracleEffectStep } from '../oracleIR';
import { findAntecedentStepIndex } from '../oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex, REVEALED_THIS_WAY_ANTECEDENT_KINDS } from '../oracleIRThisWayBinding';
import {
  resolveCardCountDiscardedThisWay,
  resolveSnapshotCountAtAntecedent,
} from '../oracleIRThisWayResolver';
import {
  resolveCreatureLedgerCountAtAntecedent,
  resolveLedgerAntecedentStepIndex,
  resolveNonlandLedgerCountAtAntecedent,
} from '../oracleIRLedgerCardAccess';
import { evaluateModifyPtWhereX } from '../oracleIRExecutorModifyPtWhereEvaluator';
import { getCounterCountOnObject } from '../oracleIRExecutorModifyPtWhereUtils';
import { tryResolveForEachReferenceAmount } from '../oracleIRExecutorForEachQuantity';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../oracleIRExecutorCommanderCastCount';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepTypes';
import {
  countArtifactsYouControl,
  countAttackingCreaturesMatching,
  countBasicLandTypesAmongLandsYouControl,
  countBloodTokensForPlayer,
  countControlledCreaturesWithSubtype,
  countCreaturesBlockedByTarget,
  countCreaturesBlockingTarget,
  countOtherAttackingAurochs,
  countPartyCreatures,
} from './oracleIRExecutorModifyPtScalerCountHelpers';

export function resolveReferenceScalerScale(
  state: GameState,
  controllerId: PlayerID,
  targetCreatureId: string,
  raw: string,
  runtime: ModifyPtRuntime,
  ctx?: OracleIRExecutionContext,
  step?: OracleEffectStep,
): number | null {
  const normalized = String(raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+and gain\b.*$/i, '')
    .trim();

  if (/^for each creature blocking it$/.test(normalized)) {
    return Math.max(0, countCreaturesBlockingTarget(state, targetCreatureId));
  }
  if (/^for each card revealed this way$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
    }
    return Math.max(0, runtime.lastRevealedCardCount | 0);
  }
  if (/^for each nonland card revealed this way$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveNonlandLedgerCountAtAntecedent(ctx, antecedentStepIndex);
    }
    const revealed = Array.isArray(runtime.lastMovedCards) ? runtime.lastMovedCards : [];
    return revealed.reduce((count: number, card: any) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      return count + (typeLine.includes('land') ? 0 : 1);
    }, 0);
  }
  if (/^for each card discarded this way$/.test(normalized)) {
    if (ctx?.stepLedger?.size) {
      const antecedentStepIndex = step
        ? resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, 'discard')
        : (ctx.currentStepIndex != null
          ? findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex)
          : null);
      if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
        return resolveCardCountDiscardedThisWay(ctx, antecedentStepIndex);
      }
    }
    return Math.max(0, runtime.lastDiscardedCardCount | 0);
  }
  if (/^for each card looked at while scrying this way$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, ['scry']);
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
    }
    return Math.max(0, runtime.lastScryLookedAtCount | 0);
  }
  if (/^for each creature tapped this way$/.test(normalized)) {
    return Math.max(0, runtime.lastTappedMatchingPermanentCount | 0);
  }
  if (/^for each artifact you control$/.test(normalized)) {
    return Math.max(0, countArtifactsYouControl(state, controllerId));
  }
  if (/^for each basic land type among lands you control$/.test(normalized)) {
    return Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId));
  }
  if (/^for each land you control$/.test(normalized)) {
    const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
    return battlefield.filter((permanent: any) => {
      if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
      ).toLowerCase();
      return /\bland\b/i.test(typeLine);
    }).length;
  }
  if (/^for each forest you control$/.test(normalized)) {
    return ((state.battlefield || []) as any[]).filter((permanent: any) => {
      if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
      return /\bforest\b/i.test(typeLine);
    }).length;
  }
  if (/^for each creature you control$/.test(normalized)) {
    const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
    return battlefield.filter((permanent: any) => {
      if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
      ).toLowerCase();
      return /\bcreature\b/i.test(typeLine);
    }).length;
  }
  const otherSubtypeYouControlMatch = normalized.match(/^for each other ([a-z][a-z -]+?) you control$/);
  if (otherSubtypeYouControlMatch) {
    const subtype = String(otherSubtypeYouControlMatch[1] || '').trim();
    const total = Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, subtype));
    const targetPermanent = ((state.battlefield || []) as any[]).find(
      (perm: any) => String(perm?.id || '').trim() === String(targetCreatureId || '').trim()
    );
    if (!targetPermanent) return total;
    const typeLine = String(
      targetPermanent?.card?.type_line ||
        targetPermanent?.card?.typeLine ||
        targetPermanent?.type_line ||
        targetPermanent?.typeLine ||
        ''
    ).toLowerCase();
    const subtypePattern = new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
    const excludesSelf =
      String(targetPermanent?.controller || targetPermanent?.controllerId || '').trim() ===
        String(controllerId || '').trim() &&
      subtypePattern.test(typeLine);
    return Math.max(0, total - (excludesSelf ? 1 : 0));
  }
  if (/^for each other attacking aurochs$/.test(normalized)) {
    return Math.max(0, countOtherAttackingAurochs(state, targetCreatureId));
  }
  if (/^for each attacking creature$/.test(normalized)) {
    return Math.max(0, countAttackingCreaturesMatching(state, targetCreatureId));
  }
  if (/^for each other attacking creature$/.test(normalized)) {
    return Math.max(0, countAttackingCreaturesMatching(state, targetCreatureId, { excludeTarget: true }));
  }
  if (/^for each creature in your party$/.test(normalized)) {
    return Math.max(0, countPartyCreatures(state, controllerId));
  }
  if (/^for each creature card (?:put into (?:a |your |their )?graveyard this way|milled this way)$/.test(normalized)) {
    const antecedentStepIndex = resolveLedgerAntecedentStepIndex(
      ctx,
      step,
      ['move_zone', 'discard', 'sacrifice', 'mill'],
    );
    if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
      return resolveCreatureLedgerCountAtAntecedent(ctx, antecedentStepIndex);
    }
    const moved = [
      ...(Array.isArray(runtime.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray((runtime as any).lastMilledCards) ? (runtime as any).lastMilledCards : []),
      ...(Array.isArray(ctx?.lastMilledCards) ? ctx.lastMilledCards : []),
    ];
    return moved.reduce((count: number, card: any) => {
      const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      return count + (/\bcreature\b/i.test(typeLine) ? 1 : 0);
    }, 0);
  }
  if (/^for each blood token defending player controls$/.test(normalized)) {
    const defendingPlayerId = String(ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || '').trim() as PlayerID;
    return defendingPlayerId ? Math.max(0, countBloodTokensForPlayer(state, defendingPlayerId)) : null;
  }
  if (/^for each lore counter on this artifact$/.test(normalized)) {
    const sourceId = String(ctx?.sourceId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const lore = Number((source as any)?.counters?.lore ?? (source as any)?.counters?.Lore ?? 0);
    return Number.isFinite(lore) ? Math.max(0, lore) : 0;
  }
  if (/^for each color of mana spent to cast that spell$/.test(normalized)) {
    const colors = Number((state as any)?.manaSpentToCastLastSpellColors?.[controllerId] ?? (ctx as any)?.manaSpentToCastLastSpellColors ?? 2);
    return Number.isFinite(colors) ? Math.max(0, colors) : 0;
  }
  if (/^for each time you've cast (?:a|your) commander from the command zone this game$/.test(normalized)) {
    return resolveCommanderCastsFromCommandZoneThisGame(state, controllerId);
  }
  if (/^for each card you'?ve drawn this turn$/.test(normalized) || /^for each card you have drawn this turn$/.test(normalized)) {
    const drawn = Number((state as any)?.cardsDrawnThisTurn?.[controllerId] ?? ctx?.referenceAmount ?? 1);
    return Number.isFinite(drawn) ? Math.max(0, drawn) : 1;
  }
  if (/^for each card in your hand$/.test(normalized)) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(controllerId || '').trim());
    const hand = Array.isArray((player as any)?.hand) ? (player as any).hand : [];
    return hand.length;
  }
  if (/^for each poison counter its controller has$/.test(normalized)) {
    const battlefield = (state.battlefield || []) as any[];
    const targetPermanent = battlefield.find(
      (perm: any) => String(perm?.id || '').trim() === String(targetCreatureId || '').trim()
    );
    const targetController = String(
      (targetPermanent as any)?.controller || (targetPermanent as any)?.controllerId || ''
    ).trim();
    if (!targetController) return null;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === targetController) as any;
    const poison = Number(
      player?.poisonCounters ??
        (state as any)?.poisonCounters?.[targetController] ??
        player?.counters?.poison ??
        0
    );
    return Number.isFinite(poison) ? Math.max(0, poison) : 0;
  }

  if (/^for each \+1\/\+1 counters? on it$/i.test(normalized)) {
    const targetPermanent = ((state.battlefield || []) as any[]).find(
      (perm: any) => String(perm?.id || '').trim() === String(targetCreatureId || '').trim(),
    );
    return Math.max(0, getCounterCountOnObject(targetPermanent, '+1/+1') ?? 0);
  }

  if (/^for each counters? on it$/i.test(normalized)) {
    const targetPermanent = ((state.battlefield || []) as any[]).find(
      (perm: any) => String(perm?.id || '').trim() === String(targetCreatureId || '').trim(),
    );
    const counters = (targetPermanent as any)?.counters;
    if (!counters || typeof counters !== 'object') return 0;
    if (Array.isArray(counters)) return counters.length;
    return Object.values(counters as Record<string, number>).reduce(
      (sum, count) => sum + (Number(count) > 0 ? Number(count) : 0),
      0,
    );
  }

  if (/^for each \{b\} or \{r\} spent this way$/.test(normalized)) {
    const spent = Number(runtime?.lastReferenceAmount ?? (state as any)?.manaSpentThisWay?.[controllerId] ?? 2);
    return Number.isFinite(spent) ? Math.max(0, spent) : 0;
  }

  const otherAttackingSubtypeMatch = normalized.match(/^for each other attacking ([a-z][a-z -]+)$/);
  if (otherAttackingSubtypeMatch) {
    return Math.max(
      0,
      countAttackingCreaturesMatching(state, targetCreatureId, {
        excludeTarget: true,
        subtype: String(otherAttackingSubtypeMatch[1] || '').trim(),
      })
    );
  }

  const subtypeYouControlMatch = normalized.match(/^for each ([a-z][a-z /-]+?) you control$/);
  if (subtypeYouControlMatch) {
    const subtypeText = String(subtypeYouControlMatch[1] || '').trim();
    if (subtypeText.includes(' and/or ')) {
      const parts = subtypeText.split(/\s+and\/or\s+/i).map((part) => part.trim()).filter(Boolean);
      const seen = new Set<string>();
      for (const permanent of ((state as any).battlefield || []) as any[]) {
        if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
          continue;
        }
        const typeLine = String(
          permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
        ).toLowerCase();
        if (!/\bcreature\b/i.test(typeLine)) continue;
        if (parts.some((part) => new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(typeLine))) {
          seen.add(String(permanent?.id || '').trim());
        }
      }
      return seen.size;
    }
    return Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, subtypeText));
  }

  const subtypeCreatureMatch = normalized.match(/^for each ([a-z][a-z -]+?) creature you control$/);
  if (subtypeCreatureMatch) {
    return Math.max(
      0,
      countControlledCreaturesWithSubtype(state, controllerId, String(subtypeCreatureMatch[1] || '').trim())
    );
  }

  if (/^for each creature it's blocking$/.test(normalized)) {
    return Math.max(0, countCreaturesBlockedByTarget(state, targetCreatureId));
  }

  if (/^for each name sticker on it that begins with the chosen letter$/.test(normalized)) {
    const chosenLetter = String(ctx?.selectorContext?.chosenLetter || '')
      .trim()
      .toLowerCase()
      .charAt(0);
    if (!chosenLetter) return null;
    const sourceId = String(ctx?.sourceId || targetCreatureId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const stickers = Array.isArray((source as any)?.stickers) ? (source as any).stickers : [];
    return stickers.filter((sticker: any) => {
      if (String(sticker?.type || sticker?.kind || 'name').toLowerCase() !== 'name') return false;
      const text = String(sticker?.text || sticker?.name || '').trim().toLowerCase();
      return text.startsWith(chosenLetter);
    }).length;
  }

  if (/^for each name sticker on it(?: that begins with the same letter as its name)?$/.test(normalized)) {
    const sourceId = String(ctx?.sourceId || targetCreatureId || '').trim();
    const source = ((state.battlefield || []) as any[]).find((entry) => String(entry?.id || '').trim() === sourceId);
    const stickers = Array.isArray((source as any)?.stickers) ? (source as any).stickers : [];
    return stickers.filter((sticker: any) => String(sticker?.type || sticker?.kind || 'name').toLowerCase() === 'name').length;
  }

  if (/^for each card type among cards in your hand$/.test(normalized)) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(controllerId || '').trim());
    const hand = Array.isArray((player as any)?.hand) ? (player as any).hand : [];
    const types = new Set<string>();
    for (const card of hand) {
      const typeLine = String((card as any)?.type_line || (card as any)?.card?.type_line || '').toLowerCase();
      for (const klass of ['artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'battle']) {
        if (new RegExp(`\\b${klass}\\b`, 'i').test(typeLine)) types.add(klass);
      }
    }
    return types.size;
  }

  if (/^for each card type among cards in your graveyard$/.test(normalized)) {
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(controllerId || '').trim());
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    const types = new Set<string>();
    for (const card of graveyard) {
      const typeLine = String((card as any)?.type_line || (card as any)?.card?.type_line || '').toLowerCase();
      for (const klass of ['artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'battle']) {
        if (new RegExp(`\\b${klass}\\b`, 'i').test(typeLine)) types.add(klass);
      }
    }
    return types.size;
  }

  if (/^for each of its colors$/.test(normalized)) {
    const permanent = ((state.battlefield || []) as any[]).find(
      (entry) => String(entry?.id || '').trim() === String(targetCreatureId || '').trim()
    );
    if (!permanent) return null;
    const colors = new Set<string>();
    for (const color of Array.isArray((permanent as any)?.colors) ? (permanent as any).colors : []) {
      const normalized = String(color || '').trim().toUpperCase();
      if (/^[WUBRG]$/.test(normalized)) colors.add(normalized);
    }
    const typeLine = String(
      (permanent as any)?.type_line || (permanent as any)?.card?.type_line || ''
    ).toLowerCase();
    for (const color of ['white', 'blue', 'black', 'red', 'green']) {
      if (new RegExp(`\\b${color}\\b`, 'i').test(typeLine)) colors.add(color.charAt(0).toUpperCase());
    }
    return colors.size;
  }

  if (/^for each forest you control$/.test(normalized)) {
    return ((state.battlefield || []) as any[]).filter((permanent: any) => {
      if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
      return /\bforest\b/i.test(typeLine);
    }).length;
  }

  if (/^for each plains returned this way$/.test(normalized)) {
    const returned = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx?.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    return returned.filter((card: any) => /\bplains\b/i.test(String(card?.type_line || card?.card?.type_line || ''))).length;
  }

  if (/^for each nonbasic land defending player controls$/.test(normalized)) {
    const defendingPlayerId = String(
      ctx?.selectorContext?.targetOpponentId || ctx?.selectorContext?.targetPlayerId || 'p2'
    ).trim();
    return ((state.battlefield || []) as any[]).filter((permanent: any) => {
      if (String(permanent?.controller || permanent?.controllerId || '').trim() !== defendingPlayerId) return false;
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
      return /\bland\b/i.test(typeLine) && !/\bbasic\b/i.test(typeLine);
    }).length;
  }

  if (/^for each \+1\/\+1 counter removed this way$/.test(normalized)) {
    const removed = Number(runtime?.lastReferenceAmount ?? ctx?.referenceAmount ?? 0);
    return Number.isFinite(removed) ? Math.max(0, Math.floor(removed)) : 0;
  }

  if (/^for each creature sacrificed this way$/.test(normalized)) {
    return Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents.length : 0;
  }

  if (/^for each mana from a treasure that was spent to cast this spell$/.test(normalized)) {
    const spent = Number((ctx as any)?.treasureManaSpentThisCast ?? ctx?.referenceAmount ?? 1);
    return Number.isFinite(spent) ? Math.max(0, Math.floor(spent)) : 0;
  }

  const forEachMatch = normalized.match(/^for each (.+)$/);
  if (forEachMatch && ctx) {
    const eachPart = String(forEachMatch[1] || '').trim();
    const fromForEach = tryResolveForEachReferenceAmount(state, controllerId, `1 for each ${eachPart}`, ctx, { runtime });
    if (fromForEach !== null) return fromForEach;

    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is the number of ${eachPart}`,
      targetCreatureId,
      ctx,
      runtime
    );
    if (evaluated !== null) return Math.max(0, evaluated);

    const evaluatedBare = evaluateModifyPtWhereX(
      state,
      controllerId,
      `X is ${eachPart}`,
      targetCreatureId,
      ctx,
      runtime
    );
    if (evaluatedBare !== null) return Math.max(0, evaluatedBare);
  }

  return null;
}

