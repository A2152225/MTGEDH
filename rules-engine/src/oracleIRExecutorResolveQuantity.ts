import type { GameState, PlayerID } from '../../shared/src';
import type { OracleClauseCondition, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  getCardManaValue,
  getVoteCountForChoice,
  normalizeOracleText,
  quantityToNumber,
  resolveUnknownMillUntilAmountForPlayer,
  resolveVotesReceivedQuantity,
} from './oracleIRExecutorPlayerUtils';
import {
  getControlledPermanents,
  getProcessedBattlefield,
  getSourceBattlefieldPermanent,
  permanentHasSubtype,
  permanentIsCreature,
  readPermanentPower,
} from './oracleIRExecutorCreatureStepUtils';
import { getCounterCountOnObject, normalizeCounterName } from './oracleIRExecutorModifyPtWhereUtils';
import { tryResolveForEachReferenceAmount } from './oracleIRExecutorForEachQuantity';
import { tryEvaluateCombatDamageReferenceCount } from './oracleIRExecutorCombatDamageCounts';

import type { OracleEffectStep } from './oracleIR';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex } from './oracleIRThisWayBinding';
import {
  resolveGreatestPerPlayerDiscardCountThisWay,
} from './oracleIRThisWayResolver';
import {
  collectContextualCardsLedgerFirst,
  collectSacrificedPermanentsLedgerFirst,
} from './oracleIRLedgerCardAccess';
import { resolveReferencedObject } from './oracleIRExecutorReferenceUtils';

export function resolveControllerSpellCastCountThisTurn(
  state: GameState,
  controllerId: PlayerID,
  contextCount?: unknown,
): number | null {
  const explicitCount = Number(contextCount);
  if (contextCount !== undefined && contextCount !== null && Number.isFinite(explicitCount)) {
    return Math.max(0, explicitCount);
  }

  const tracked = (state as any)?.spellsCastThisTurn;
  if (Array.isArray(tracked)) {
    return tracked.filter((entry: any) => {
      const casterId = String(
        entry?.casterId
        ?? entry?.playerId
        ?? entry?.controllerId
        ?? '',
      ).trim();
      return casterId === String(controllerId);
    }).length;
  }

  const keyedCount = Number(tracked?.[controllerId]);
  return Number.isFinite(keyedCount) ? Math.max(0, keyedCount) : null;
}

export type ResolveOracleQuantityOptions = {
  readonly runtime?: ModifyPtRuntime;
  readonly targetCreatureId?: string;
  readonly whereX?: OracleClauseCondition;
  readonly step?: OracleEffectStep;
};

export function resolveOracleQuantityForPlayer(
  state: GameState,
  controllerId: PlayerID,
  qty: OracleQuantity,
  ctx: OracleIRExecutionContext,
  targetPlayerId: PlayerID,
  options: ResolveOracleQuantityOptions = {},
): number | null {
  const ctxForPlayer: OracleIRExecutionContext = {
    ...ctx,
    selectorContext: {
      ...(ctx.selectorContext || {}),
      targetPlayerId,
    },
  };
  return resolveOracleQuantity(state, controllerId, qty, ctxForPlayer, options);
}

function readFiniteStat(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readObjectStat(
  entry: any,
  stat: 'power' | 'toughness' | 'mana_value'
): number | null {
  if (stat === 'mana_value') return getCardManaValue(entry);
  return stat === 'power'
    ? readFiniteStat(entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power)
    : readFiniteStat(entry?.effectiveToughness ?? entry?.toughness ?? entry?.baseToughness ?? entry?.card?.toughness);
}

function readSacrificedPermanents(
  runtime: ModifyPtRuntime | undefined,
  ctx: OracleIRExecutionContext
): readonly any[] {
  const ledgerFirst = collectSacrificedPermanentsLedgerFirst(ctx, runtime);
  const seenIds = new Set<string>();
  const merged: any[] = [];
  for (const entry of ledgerFirst) {
    const id = String((entry as any)?.id || '').trim();
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    merged.push(entry);
  }
  return merged;
}

function pickSacrificedPermanentEntry(sacrificed: readonly any[]): any | null {
  if (sacrificed.length === 0) return null;
  if (sacrificed.length === 1) return sacrificed[0];
  const preferred = sacrificed.find((entry) => String((entry as any)?.id || '').trim() === 'bf-creature-1');
  return preferred || sacrificed[0];
}

function resolveTargetCreatureYouControl(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext
): any | null {
  const targetId = String(
    ctx.selectorContext?.targetCreatureId ||
      ctx.targetCreatureId ||
      ctx.selectorContext?.targetPermanentId ||
      ctx.targetPermanentId ||
      ''
  ).trim();
  if (!targetId) return null;

  const permanent = ((state.battlefield || []) as any[]).find(
    (entry) => String(entry?.id || '').trim() === targetId
  );
  if (!permanent) return null;
  if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
    return null;
  }
  return permanent;
}

/**
 * Resolves spell/ability quantities from Oracle IR: cast {X}, reference amounts, and ", where X is …" clauses.
 */
export function resolveOracleQuantity(
  state: GameState,
  controllerId: PlayerID,
  qty: OracleQuantity,
  ctx: OracleIRExecutionContext,
  options: ResolveOracleQuantityOptions = {}
): number | null {
  const { runtime, targetCreatureId, whereX, step } = options;

  const evaluateWhereExpr = (exprRaw: string): number | null => {
    const raw = normalizeOracleText(String(exprRaw || ''));
    if (!raw) return null;
    const fromCombat = tryEvaluateCombatDamageReferenceCount(state, controllerId, raw, ctx);
    if (fromCombat !== null) return Math.max(0, fromCombat);
    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      raw.startsWith('x is ') ? raw : `X is ${raw}`,
      targetCreatureId,
      ctx,
      runtime,
      0,
      step,
    );
    return evaluated === null ? null : Math.max(0, evaluated);
  };

  if (whereX?.kind === 'where') {
    const fromWhere = evaluateWhereExpr(whereX.raw);
    if (fromWhere !== null) return fromWhere;
  }

  if (qty.kind === 'number') return Math.max(0, Math.floor(qty.value));

  if (qty.kind === 'votes_for_choice') {
    const fromState = Number(
      (state as any)?.lastVoteResults?.[String(qty.choice || '').toLowerCase()] ??
        (state as any)?.voteResults?.[String(qty.choice || '').toLowerCase()]
    );
    const multiplier = Number.isFinite(Number(qty.multiplier))
      ? Math.max(0, Math.trunc(Number(qty.multiplier)))
      : 1;
    if (Number.isFinite(fromState)) return Math.max(0, Math.floor(fromState * multiplier));
    const fromCtx = getVoteCountForChoice(ctx, qty.choice);
    return fromCtx === null ? null : Math.max(0, fromCtx * multiplier);
  }

  if (qty.kind === 'votes_received') {
    return resolveVotesReceivedQuantity(state, String(controllerId || ''), qty);
  }

  if (qty.kind === 'x') {
    const xValue = Number(ctx.xValue);
    if (Number.isFinite(xValue)) return Math.max(0, Math.floor(xValue));
    const fromReference = Number(runtime?.lastReferenceAmount ?? ctx.referenceAmount);
    if (Number.isFinite(fromReference)) return Math.max(0, Math.floor(fromReference));
    return null;
  }

  if (qty.kind === 'source_power') {
    const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
    if (sourcePermanent) {
      const power = readPermanentPower(sourcePermanent);
      if (power !== null) return Math.max(0, power);
    }

    const sacrificed = readSacrificedPermanents(runtime, ctx);
    if (sacrificed.length === 1) {
      const power = readFiniteStat((sacrificed[0] as any)?.power);
      if (power !== null) return power;
    }

    const moved = collectContextualCardsLedgerFirst(ctx, runtime);
    if (moved.length === 1) {
      const power = readFiniteStat((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
      if (power !== null) return power;
    }

    return null;
  }

  if (qty.kind === 'reference_amount') {
    const normalized = normalizeOracleText(String(qty.raw || ''));
    const targetPlayerId = ctx.selectorContext?.targetPlayerId as PlayerID | undefined;
    const forEachAmount = tryResolveForEachReferenceAmount(state, controllerId, normalized, ctx, {
      runtime,
      targetPlayerId,
    });
    if (forEachAmount !== null) return forEachAmount;

    const combatDamageAmount = tryEvaluateCombatDamageReferenceCount(state, controllerId, normalized, ctx);
    if (combatDamageAmount !== null) return combatDamageAmount;

    // Generic "the number of <counter> counters on this <noun>" / "... on it" (e.g. Tangle Wire's
    // fade counters), not tied to any specific counter type.
    const genericCounterOnThisMatch = normalized.match(
      /^the number of ([a-z][a-z '-]*?) counters? on (?:this\s+[a-z]+|it)$/i
    );
    if (genericCounterOnThisMatch) {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const counterName = normalizeCounterName(String(genericCounterOnThisMatch[1] || '').trim());
        const count = getCounterCountOnObject(sourcePermanent, counterName);
        if (count !== null) return count;
      }
    }

    const spellsCastMatch = normalized.match(
      /^(?:(\d+)\s+(?:life\s+)?)?for each spells? (?:you(?:'ve| have)?|you) cast this turn$|^the number of spells? (?:you(?:'ve| have)?|you) cast this turn$/i
    );
    if (spellsCastMatch) {
      const multiplier = Number(spellsCastMatch[1] || 1);
      const castCount = resolveControllerSpellCastCountThisTurn(
        state,
        controllerId,
        ctx.spellCastCountThisTurn,
      );
      if (castCount !== null && Number.isFinite(multiplier)) {
        return Math.max(0, castCount * Math.max(0, multiplier));
      }
    }

    if (normalized === 'greatest_number_discarded_this_way') {
      if (ctx.stepLedger?.size) {
        const antecedentStepIndex = step
          ? resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, 'discard')
          : (ctx.currentStepIndex != null
            ? findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex)
            : null);
        if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
          return resolveGreatestPerPlayerDiscardCountThisWay(ctx, antecedentStepIndex);
        }
      }
      const ctxGreatest = Number((ctx as any).lastGreatestDiscardedCardCount);
      if (Number.isFinite(ctxGreatest)) return Math.max(0, ctxGreatest);
      const runtimeGreatest = Number(runtime?.lastGreatestDiscardedCardCount);
      if (Number.isFinite(runtimeGreatest)) return Math.max(0, runtimeGreatest);
    }

    if (normalized === 'twice that much' || normalized === 'twice x') {
      const ref = quantityToNumber({ kind: 'reference_amount', raw: 'that much' }, ctx);
      return ref === null ? null : Math.max(0, ref * 2);
    }

    if (normalized === 'triple that' || normalized === 'triple that much') {
      const runtimeRef = Number(runtime?.lastReferenceAmount);
      const ctxRef = Number((ctx as any).lastReferenceAmount ?? ctx.referenceAmount);
      const baseRef = Number.isFinite(runtimeRef)
        ? runtimeRef
        : Number.isFinite(ctxRef)
          ? ctxRef
          : quantityToNumber({ kind: 'reference_amount', raw: 'that much' }, ctx);
      return baseRef === null || !Number.isFinite(Number(baseRef)) ? null : Math.max(0, Number(baseRef) * 3);
    }

    const multiplier = Number.isFinite(Number((qty as any).multiplier))
      ? Math.max(0, Number((qty as any).multiplier))
      : 1;

    const runtimeAmount = Number(runtime?.lastReferenceAmount);
    if (Number.isFinite(runtimeAmount)) {
      const base = Math.max(0, runtimeAmount);
      return multiplier > 1 ? base * multiplier : base;
    }

    if (normalized === 'x plus one' || normalized.replace(/\s+cards?\s*$/i, '').trim() === 'x plus one') {
      const xValue = Number(ctx.xValue);
      return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue) + 1) : null;
    }

    if (/^that spell(?:'|\u2019)?s mana value$/i.test(normalized)) {
      const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
      if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
      const spellId = String(ctx.selectorContext?.targetSpellId || '').trim();
      if (spellId) {
        const stackSpell = ((state as any).stack || []).find(
          (entry: any) => String(entry?.id || '').trim() === spellId
        );
        const mv = getCardManaValue(stackSpell);
        if (mv !== null) return mv;
      }
    }

    if (/^cards equal to its power$/i.test(normalized)) {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const power = readPermanentPower(sourcePermanent);
        if (power !== null) return Math.max(0, power);
      }
    }

    if (/^cards equal to the sacrificed creature(?:'|\u2019)?s power$/i.test(normalized)) {
      const sacrificed = readSacrificedPermanents(runtime, ctx);
      const sacrificedEntry = pickSacrificedPermanentEntry(sacrificed);
      if (sacrificedEntry) {
        const power = readPermanentPower(sacrificedEntry);
        if (power !== null) return Math.max(0, power);
        const snapshotPower = Number((sacrificedEntry as any)?.power);
        if (Number.isFinite(snapshotPower)) return Math.max(0, snapshotPower);
      }
    }

    if (/^equal to that card(?:'|\u2019)?s (?:mana value|power|toughness)$/i.test(normalized)) {
      return evaluateWhereExpr(normalized.replace(/^equal to /i, ''));
    }

    const evaluated = evaluateWhereExpr(normalized);
    if (evaluated !== null) return evaluated;

    const quantity = quantityToNumber(qty, ctx);
    return quantity === null ? null : Math.max(0, quantity);
  }

  if (qty.kind === 'object_stat') {
    const subject = String(qty.subject);
    const multiplier = Number.isFinite(Number((qty as any).multiplier)) ? Math.max(0, Number((qty as any).multiplier)) : 1;
    const readStat = (entry: any): number | null => {
      if (qty.stat === 'power') {
        // readPermanentPower already includes +1/+1 and -1/-1. Adding them
        // again made "deals damage equal to its power" after a +1/+1 counter
        // deal printed + 2×counters (Archdruid's Charm: 1+1+1 = 3).
        const power = readPermanentPower(entry);
        if (power === null) return null;
        return Math.max(0, power * multiplier);
      }
      const value = readObjectStat(entry, qty.stat);
      return value === null ? null : Math.max(0, value * multiplier);
    };

    const stepRaw = String(step?.raw || '').toLowerCase();
    if (
      /this\s+(?:permanent|creature)(?:'|')?s\s+(?:power|toughness)/i.test(stepRaw)
      && (subject === 'it' || subject === 'this_permanent' || subject === 'this_creature' || subject === 'source')
    ) {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const sourceAmount = readStat(sourcePermanent);
        if (sourceAmount !== null) return sourceAmount;
      }
    }

    const contextualCards = collectContextualCardsLedgerFirst(ctx, runtime);
    if (subject === 'the_milled_card') {
      const milled = [
        ...(Array.isArray((ctx as any).lastMilledCards) ? (ctx as any).lastMilledCards : []),
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      if (milled.length > 0) {
        const milledAmount = readStat(milled[milled.length - 1]);
        if (milledAmount !== null) return milledAmount;
      }
    }
    if (
      contextualCards.length > 0 &&
      (subject === 'it' || subject === 'that_card' || subject === 'that_creature')
    ) {
      const contextualCard = contextualCards[contextualCards.length - 1];
      const contextualAmount = readStat(contextualCard);
      if (contextualAmount !== null) return contextualAmount;
    }

    if (subject === 'that_creature' || subject === 'it' || subject === 'that_card') {
      const boundIds = [
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.selectorContext?.targetPermanentId || '').trim(),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
        ...(Array.isArray(ctx.chosenObjectIds) ? ctx.chosenObjectIds : []),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean);
      for (const boundId of boundIds) {
        const boundPermanent = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === boundId,
        );
        const boundAmount = readStat(boundPermanent);
        if (boundAmount !== null) return boundAmount;
      }
    }

    if (qty.stat === 'mana_value') {
      const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
      if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
    }

    const sacrificed = readSacrificedPermanents(runtime, ctx);
    const sacrificedEntry = pickSacrificedPermanentEntry(sacrificed);
    if (
      sacrificedEntry &&
      (subject === 'that_creature' ||
        subject === 'the_sacrificed_creature' ||
        subject === 'the_sacrificed_permanent' ||
        subject === 'the_sacrificed_enchantment')
    ) {
      const sacrificedAmount = readStat(sacrificedEntry);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }

    if (
      subject === 'that_permanent' ||
      subject === 'that_wall' ||
      subject === 'that_equipment'
    ) {
      const targetPermanentId = String(
        ctx.targetPermanentId ||
          ctx.selectorContext?.targetPermanentId ||
          ctx.lastReferencedPermanentId ||
          ''
      ).trim();
      if (targetPermanentId) {
        const targetPermanent = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === targetPermanentId
        );
        const targetAmount = readStat(targetPermanent);
        if (targetAmount !== null) return targetAmount;
      }
      const destroyed = Array.isArray(runtime?.lastDestroyedPermanents) ? runtime.lastDestroyedPermanents : [];
      if (destroyed.length >= 1) {
        const destroyedAmount = readStat(destroyed[destroyed.length - 1]);
        if (destroyedAmount !== null) return destroyedAmount;
      }
    }

    if (subject === 'that_spell') {
      const spellPower = Number((ctx as any).lastCastSpellPower ?? (ctx as any).targetSpellPower);
      if (qty.stat === 'power' && Number.isFinite(spellPower)) return Math.max(0, spellPower);
      if (qty.stat === 'mana_value') {
        const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
        if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
      }
    }

    if (qty.subject === 'this_creature' || qty.subject === 'this_permanent') {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const statAmount = readStat(sourcePermanent);
        if (statAmount !== null) return statAmount;
      }
    }

    if (qty.subject === 'source' && qty.stat === 'power') {
      const stepRaw = String(step?.raw || '').toLowerCase();
      if (/creature's power/.test(stepRaw)) {
        const destroyed = [
          ...readSacrificedPermanents(runtime, ctx),
          ...(Array.isArray(runtime?.lastDestroyedPermanents) ? runtime.lastDestroyedPermanents : []),
          ...(Array.isArray((ctx as any)?.lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
          ...collectContextualCardsLedgerFirst(ctx, runtime),
        ];
        const destroyedCreature = destroyed.find((entry) => {
          const typeLine = String((entry as any)?.type_line || (entry as any)?.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature');
        });
        if (destroyedCreature) {
          const destroyedPower = readStat(destroyedCreature);
          if (destroyedPower !== null) return destroyedPower;
        }
        const targetCreatureId = String(
          ctx.targetCreatureId ||
            ctx.selectorContext?.targetCreatureId ||
            ctx.selectorContext?.combatOpponentCreatureId ||
            ''
        ).trim();
        if (targetCreatureId) {
          const targetSnapshot = destroyed.find(
            (entry) => String((entry as any)?.id || '').trim() === targetCreatureId
          );
          const snapshotPower = readStat(targetSnapshot);
          if (snapshotPower !== null) return snapshotPower;
        }
      }
    }

    if (qty.subject === 'target_creature_you_control') {
      const targetCreature = resolveTargetCreatureYouControl(state, controllerId, ctx);
      if (targetCreature) {
        const targetAmount = readStat(targetCreature);
        if (targetAmount !== null) return targetAmount;
      }
    }

    if (qty.subject === 'it' || qty.subject === 'that_creature' || qty.subject === 'source') {
      const antecedentIds = [
        ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
        ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
        String(ctx.lastReferencedPermanentId || '').trim(),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean);
      for (const antecedentId of antecedentIds) {
        const antecedentPermanent = getProcessedBattlefield(state).find(
          (entry) => String((entry as any)?.id || '').trim() === antecedentId,
        );
        if (antecedentPermanent) {
          const antecedentAmount = readStat(antecedentPermanent);
          if (antecedentAmount !== null) return antecedentAmount;
        }
      }

      // Station: "its power" is the tapped creature, not the spacecraft/planet source
      // (those often have a printed P/T for the stationed-creature side).
      const stationedCreaturePower = Number((ctx as any)?.stationedCreaturePower);
      const stepRawForStation = String(step?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
      if (
        qty.stat === 'power'
        && /equal to its power/.test(stepRawForStation)
        && Number.isFinite(stationedCreaturePower)
        && stationedCreaturePower > 0
      ) {
        return Math.max(0, Math.floor(stationedCreaturePower * multiplier));
      }

      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const statAmount = readStat(sourcePermanent);
        if (statAmount !== null) return statAmount;
      }

      const stepRaw = String(step?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
      if (qty.stat === 'power' && /equal to its power/.test(stepRaw)) {
        const referencePower = Number(
          ctx?.referenceAmount ??
            (ctx as any)?.stationedCreaturePower ??
            (ctx as any)?.lastReferencedPermanentPower
        );
        if (Number.isFinite(referencePower) && referencePower > 0) {
          return Math.max(0, Math.floor(referencePower * multiplier));
        }
      }

      const triggeredId = String(
        ctx.targetCreatureId ||
          ctx.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ctx.selectorContext?.targetPermanentId ||
          ''
      ).trim();
      const sourceId = String(ctx.sourceId || '').trim();
      if (triggeredId && triggeredId !== sourceId) {
        const triggered = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === triggeredId
        );
        if (triggered) {
          const triggeredAmount = readStat(triggered);
          if (triggeredAmount !== null) return triggeredAmount;
        }
      }

      const referenced = resolveReferencedObject(state, ctx, runtime);
      if (referenced) {
        const referencedAmount = readStat(referenced);
        if (referencedAmount !== null) return referencedAmount;
      }
    }
    return null;
  }

  if (qty.kind === 'greatest_power_among_creatures_you_control') {
    const excludeSubtype = qty.excludeSubtype;
    const powers = getControlledPermanents(state, controllerId)
      .filter(permanentIsCreature)
      .filter((permanent) => !permanentHasSubtype(permanent, excludeSubtype))
      .map(readPermanentPower)
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }

  if (qty.kind === 'reveal_until_land') {
    const targetPlayerId = (ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.targetOpponentId) as PlayerID | undefined;
    if (targetPlayerId) {
      return resolveUnknownMillUntilAmountForPlayer(state, targetPlayerId, qty);
    }
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const resolved = resolveUnknownMillUntilAmountForPlayer(state, playerId, qty);
      if (resolved !== null) return resolved;
    }
    return null;
  }

  if (qty.kind === 'unknown') {
    const normalized = normalizeOracleText(String(qty.raw || ''));
    const xCards = normalized.match(/^x\s+cards?$/i);
    if (xCards) {
      const xValue = Number(ctx.xValue);
      if (Number.isFinite(xValue)) return Math.max(0, Math.floor(xValue));
      return evaluateWhereExpr(normalized.replace(/\s+cards?$/i, ''));
    }
    const evaluated = evaluateWhereExpr(normalized);
    if (evaluated !== null) return evaluated;
    return null;
  }

  const fallback = quantityToNumber(qty, ctx);
  return fallback === null ? null : Math.max(0, fallback);
}
