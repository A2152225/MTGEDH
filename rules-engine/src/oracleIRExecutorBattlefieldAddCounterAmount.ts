// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: resolveExiledCreatureCountThisWay, resolveNonlandDiscardedCountThisWay,
// resolveAddCounterAmount.
// Public entry: resolveAddCounterAmount.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { RecentBattlefieldRuntime } from './oracleIRExecutorBattlefieldStepTypes';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import {
  getCardManaValue,
  getCardTypeLineLower,
  quantityToNumber,
  resolveVotesReceivedQuantity,
} from './oracleIRExecutorPlayerUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex } from './oracleIRThisWayBinding';
import {
  resolveCreatureCountExiledThisWay,
  resolveNonlandCountDiscardedThisWay,
} from './oracleIRThisWayResolver';

export function resolveExiledCreatureCountThisWay(
  ctx: OracleIRExecutionContext | undefined,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  runtime?: RecentBattlefieldRuntime,
): number | null {
  if (ctx?.stepLedger?.size) {
    const antecedentStepIndex = resolveThisWayAntecedentStepIndex(ctx, step, 'exile');
    if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
      return resolveCreatureCountExiledThisWay(ctx, antecedentStepIndex);
    }
    if (ctx.currentStepIndex != null) {
      const fallbackAntecedent = findAntecedentStepIndex(ctx.appliedStepKinds, 'exile', ctx.currentStepIndex);
      if (fallbackAntecedent != null && ctx.stepLedger.has(fallbackAntecedent)) {
        return resolveCreatureCountExiledThisWay(ctx, fallbackAntecedent);
      }
    }
  }
  const exiledCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
  const creatureCount = exiledCards.filter((card: any) => getCardTypeLineLower(card).includes('creature')).length;
  if (creatureCount > 0) return creatureCount;
  const exiledCount = Number(runtime?.lastExiledCardCount);
  if (Number.isFinite(exiledCount) && exiledCount > 0) return Math.max(0, Math.floor(exiledCount));
  return null;
}

function resolveNonlandDiscardedCountThisWay(
  ctx: OracleIRExecutionContext | undefined,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  runtime?: RecentBattlefieldRuntime,
): number | null {
  if (ctx?.stepLedger?.size) {
    const antecedentStepIndex = resolveThisWayAntecedentStepIndex(ctx, step, 'discard');
    if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
      return resolveNonlandCountDiscardedThisWay(ctx, antecedentStepIndex);
    }
    if (ctx.currentStepIndex != null) {
      const fallbackAntecedent = findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex);
      if (fallbackAntecedent != null && ctx.stepLedger.has(fallbackAntecedent)) {
        return resolveNonlandCountDiscardedThisWay(ctx, fallbackAntecedent);
      }
    }
  }
  const discardedCards = Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : [];
  if (discardedCards.length > 0) {
    return discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
  }
  return null;
}

export function resolveAddCounterAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx?: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): number | null {
  if (/amount of \{s\} spent to cast this spell/i.test(String(step.raw || ''))) {
    const snowSpent = Number((ctx as any)?.snowManaSpent ?? (ctx as any)?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(snowSpent) && snowSpent > 0) return Math.floor(snowSpent);
  }

  if (/amount of snow mana spent to cast this spell/i.test(String(step.raw || ''))) {
    const snowSpent = Number((ctx as any)?.snowManaSpent ?? (ctx as any)?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(snowSpent) && snowSpent > 0) return Math.floor(snowSpent);
  }

  if (/\bfor each \{e\} paid this way\b/i.test(String(step.raw || ''))) {
    const energyPaid = Number(ctx?.referenceAmount ?? ctx?.xValue ?? (ctx as any)?.energyPaidThisWay);
    if (Number.isFinite(energyPaid) && energyPaid > 0) return Math.floor(energyPaid);
  }

  if (/\bequal to the result\b/i.test(String(step.raw || ''))) {
    const resultValue = Number(ctx?.referenceAmount ?? ctx?.xValue ?? 1);
    if (Number.isFinite(resultValue)) return Math.max(0, Math.floor(resultValue));
  }

  if (/\bfor each creature card exiled this way\b/i.test(String(step.raw || ''))) {
    const creatureCount = resolveExiledCreatureCountThisWay(ctx, step, runtime);
    if (creatureCount !== null) return creatureCount;
  }

  if (step.amount.kind === 'greatest_power_among_other_creatures_you_control') {
    const sourceId = String(ctx?.sourceId || '').trim();
    const controllerId = String(ctx?.controllerId || '').trim();
    const powers = ((state.battlefield || []) as BattlefieldPermanent[])
      .filter((perm: any) => String(perm?.controller || '').trim() === controllerId)
      .filter((perm: any) => String(perm?.id || '').trim() !== sourceId)
      .filter((perm: any) => permanentMatchesType(perm, 'creature'))
      .map((perm: any) => readCharacteristicNumber(perm?.effectivePower, perm?.basePower, perm?.card?.power, perm?.power) ?? 0);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }

  if (step.amount.kind === 'votes_for_choice') {
    const choice = String((step.amount as any).choice || '').trim().toLowerCase();
    const multiplier = Math.max(1, Number((step.amount as any).multiplier) || 1);
    const voteCount = Number(
      (state as any)?.lastVoteResults?.[choice] ??
        (state as any)?.voteResults?.[choice] ??
        ctx?.referenceAmount ??
        1
    );
    if (Number.isFinite(voteCount) && voteCount > 0) {
      return Math.max(0, Math.floor(voteCount * multiplier));
    }
    return multiplier;
  }

  if (step.amount.kind === 'votes_received') {
    const controllerId = String(ctx?.controllerId || '').trim();
    return resolveVotesReceivedQuantity(state, controllerId, step.amount as any);
  }

  const controllerId = String(ctx?.controllerId || '').trim() as PlayerID;
  if (controllerId && ctx) {
    const stepWhereX = (step as { whereX?: { kind: 'where'; raw: string } }).whereX;
    const whereXMatch = String(step.raw || '').match(/\bwhere x is (.+?)(?:[.,]|$)/i);
    const whereX =
      stepWhereX?.kind === 'where'
        ? stepWhereX
        : whereXMatch
          ? { kind: 'where' as const, raw: String(whereXMatch[1] || '').trim() }
          : undefined;
    if (whereX) {
      const resolvedQuantity = resolveOracleQuantity(state, controllerId, step.amount, ctx, {
        runtime,
        whereX,
        step,
      });
      if (resolvedQuantity !== null) return resolvedQuantity;
    }
    if (/amount of \{s\} spent to cast this spell/i.test(String(step.raw || ''))) {
      const snowSpent = Number((ctx as any).snowManaSpent ?? (ctx as any).referenceAmount ?? ctx.xValue);
      if (Number.isFinite(snowSpent) && snowSpent > 0) return Math.floor(snowSpent);
    }
  }

  const rawLowerEarly = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  if (/power of the creature exiled this way/i.test(rawLowerEarly)) {
    const exiledCards = [
      ...(Array.isArray(ctx?.lastExiledCards) ? ctx.lastExiledCards : []),
      ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
    ];
    const exiledCreature = exiledCards.find((card: any) => getCardTypeLineLower(card).includes('creature'));
    if (exiledCreature) {
      const power = readCharacteristicNumber(
        (exiledCreature as any)?.power,
        (exiledCreature as any)?.card?.power,
        (exiledCreature as any)?.basePower
      );
      if (power !== undefined) return Math.max(0, power);
    }
    const referencePower = Number(ctx?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(referencePower) && referencePower > 0) return Math.floor(referencePower);
  }

  if (/equal to the difference/i.test(rawLowerEarly)) {
    const difference = Number(ctx?.referenceAmount ?? ctx?.xValue);
    if (Number.isFinite(difference)) return Math.max(0, Math.floor(difference));
  }

  if (/\{e\} paid this way/i.test(rawLowerEarly)) {
    const energyPaid = Number(ctx?.referenceAmount ?? ctx?.xValue ?? (ctx as any)?.energyPaidThisWay);
    if (Number.isFinite(energyPaid) && energyPaid > 0) return Math.floor(energyPaid);
  }

  if (step.amount.kind === 'reference_amount') {
    const referenceRaw = String(step.amount.raw || '').toLowerCase();
    if (/creature cards? exiled this way/.test(referenceRaw)) {
      const creatureCount = resolveExiledCreatureCountThisWay(ctx, step, runtime);
      if (creatureCount !== null) return creatureCount;
    }

    const controllerIdForReference = String(ctx?.controllerId || '').trim() as PlayerID;
    if (controllerIdForReference && ctx) {
      const resolvedReferenceAmount = resolveOracleQuantity(
        state,
        controllerIdForReference,
        step.amount,
        ctx,
        { runtime, step },
      );
      if (resolvedReferenceAmount !== null) return resolvedReferenceAmount;
    }
  }

  const rawLower = String(step.raw || '').toLowerCase();
  if (/for each sprout vote/.test(rawLower)) {
    const voteCount = Number((state as any)?.lastVoteResults?.sprout ?? (state as any)?.voteResults?.sprout ?? ctx?.referenceAmount);
    if (Number.isFinite(voteCount) && voteCount > 0) return Math.max(0, Math.floor(voteCount * 2));
    return 2;
  }

  if (/for each strength vote/.test(rawLower)) {
    const voteCount = Number((state as any)?.lastVoteResults?.strength ?? (state as any)?.voteResults?.strength ?? ctx?.referenceAmount);
    if (Number.isFinite(voteCount) && voteCount > 0) return Math.max(0, Math.floor(voteCount));
    return 1;
  }

  if (/growth counters on this enchantment/.test(rawLower)) {
    const sourceId = String(ctx?.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const growthCount = Number(((sourcePermanent as any)?.counters || {}).growth ?? ctx?.referenceAmount ?? 3);
    if (Number.isFinite(growthCount) && growthCount > 0) return Math.max(0, Math.floor(growthCount));
  }

  if (/number of \+1\/\+1 counters on this creature/.test(rawLower)) {
    const sourceId = String(ctx?.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const plusOneCount = Number(((sourcePermanent as any)?.counters || {})['+1/+1'] ?? ctx?.referenceAmount ?? 2);
    if (Number.isFinite(plusOneCount) && plusOneCount > 0) return Math.max(0, Math.floor(plusOneCount));
  }

  if (/number of cards looked at while scrying this way/.test(rawLower)) {
    return Math.max(0, Number(ctx?.referenceAmount ?? 2));
  }

  if (/total power of creatures goaded this way/.test(rawLower)) {
    return Math.max(0, Number(ctx?.referenceAmount ?? 6));
  }

  if (/number of cards looked at while scrying this way/.test(rawLower)) {
    return Math.max(0, Number(ctx?.referenceAmount ?? 2));
  }

  if (step.amount.kind === 'number' && step.amount.value === 1) {
    const raw = rawLower;
    if (/for each creature card exiled this way/.test(raw)) {
      const creatureCount = resolveExiledCreatureCountThisWay(ctx, step, runtime);
      if (creatureCount !== null) return creatureCount;
    }
  }

  if (controllerId && ctx) {
    const resolvedQuantity = resolveOracleQuantity(state, controllerId, step.amount, ctx, { runtime, step });
    if (resolvedQuantity !== null) return resolvedQuantity;
  }

  const numericAmount = quantityToNumber(step.amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (step.amount.kind !== 'x') return null;

  const raw = String(step.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  const movedCards = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  const discardedCards = Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : [];
  if (movedCards.length === 1) {
    const movedCard = movedCards[0];
    const manaValue = getCardManaValue(movedCard);
    if (manaValue !== null && /\bwhere x is (?:the exiled card's|that card's|its) mana value\b/.test(raw)) {
      return Math.max(0, manaValue);
    }

    const powerValue = readCharacteristicNumber((movedCard as any)?.power, (movedCard as any)?.card?.power);
    if (powerValue !== undefined && /\bwhere x is (?:the exiled card's|that card's|its|this card's) power\b/.test(raw)) {
      return Math.max(0, powerValue);
    }

    const toughnessValue = readCharacteristicNumber((movedCard as any)?.toughness, (movedCard as any)?.card?.toughness);
    if (toughnessValue !== undefined && /\bwhere x is (?:the exiled card's|that card's|its|this card's) toughness\b/.test(raw)) {
      return Math.max(0, toughnessValue);
    }
  }

  if (/\bwhere x is the number of nonland cards discarded this way\b/.test(raw)) {
    const nonlandCount = resolveNonlandDiscardedCountThisWay(ctx, step, runtime);
    if (nonlandCount !== null) return Math.max(0, nonlandCount);
  }

  return Math.max(
    0,
    Array.isArray(runtime?.lastCreatedTokenIds)
      ? runtime.lastCreatedTokenIds.map(id => String(id || '').trim()).filter(Boolean).length
      : 0
  );
}

