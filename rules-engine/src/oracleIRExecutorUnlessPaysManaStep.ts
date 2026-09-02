/**
 * Origin parent: oracleIRExecutorPlayerStepHandlers.ts
 * Cluster: evaluateUnlessPaysManaStep (variable unless-pay taxes, manaOptions, bound stack/permanent ids).
 * Public: evaluateUnlessPaysManaStep
 * Leaf must not import oracleIRExecutorPlayerStepHandlers.ts.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { UnlessPaysManaResult } from './oracleIRExecutorPlayerStepTypes';
import { normalizeOracleManaCostString } from './oracleIRExecutorManaUtils';
import { parseEnergyCostAmount, parseSupportedManaCostString } from './oracleIRExecutorPlayerGraveyardPermissionHelpers';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { resolveUnlessPaysManaCostString } from './oracleIRExecutorUnlessPaysManaAmount';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool } from './types/mana';

function readUnlessPaysManaChoice(
  ctx: OracleIRExecutionContext,
): 'pay' | 'decline' | undefined {
  if (ctx.unlessPaysManaChoice === 'pay' || ctx.unlessPaysManaChoice === 'decline') {
    return ctx.unlessPaysManaChoice;
  }
  if (ctx.selectorContext?.unlessPaysManaChoice === 'pay' || ctx.selectorContext?.unlessPaysManaChoice === 'decline') {
    return ctx.selectorContext.unlessPaysManaChoice;
  }
  if (ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline') {
    return ctx.unlessPaysLifeChoice;
  }
  if (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline') {
    return ctx.selectorContext.unlessPaysLifeChoice;
  }
  return undefined;
}

function isZeroManaCost(manaCost: {
  generic: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}): boolean {
  return manaCost.generic === 0
    && manaCost.white === 0
    && manaCost.blue === 0
    && manaCost.black === 0
    && manaCost.red === 0
    && manaCost.green === 0
    && manaCost.colorless === 0;
}

function tryPayManaLabel(
  state: GameState,
  payerId: PlayerID,
  manaLabel: string,
  xValue: number,
): { readonly canPay: boolean; readonly remainingPool?: any; readonly parsed: boolean } {
  const manaCost = parseSupportedManaCostString(manaLabel, xValue);
  if (!manaCost) return { canPay: false, parsed: false };
  if (isZeroManaCost(manaCost)) return { canPay: true, parsed: true };
  const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
  const currentPool = manaPoolRecord[payerId] || createEmptyManaPool();
  const payment = payManaCost(currentPool, manaCost);
  return {
    canPay: Boolean(payment.success && payment.remainingPool),
    remainingPool: payment.remainingPool,
    parsed: true,
  };
}

export function evaluateUnlessPaysManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_mana' }>,
  ctx: OracleIRExecutionContext,
): UnlessPaysManaResult {
  const players = resolvePlayers(state, step.who, ctx);
  const boundSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  const boundPermanentId = String(
    ctx.targetPermanentId
      || ctx.targetCreatureId
      || ctx.selectorContext?.targetPermanentId
      || ctx.sourceId
      || '',
  ).trim();
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          manaCost: step.mana,
          ...(boundSpellId ? { targetSpellId: boundSpellId } : {}),
          ...(boundPermanentId ? { targetPermanentId: boundPermanentId } : {}),
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find((player) => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const manaOptions = (Array.isArray(step.manaOptions) ? step.manaOptions : [])
    .map((entry) => normalizeOracleManaCostString(String(entry || '').trim()))
    .filter(Boolean);
  const resolvedMana = resolveUnlessPaysManaCostString(state, step, ctx);
  if (!resolvedMana && !manaOptions.length && (step.manaAmountRaw || step.whereX || step.forEachOpponentStackObjects)) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const chosenAmountRaw = String(
    ctx.unlessPaysManaAmount
      ?? ctx.selectorContext?.unlessPaysManaAmount
      ?? '',
  ).trim();
  const chosenAmount = chosenAmountRaw ? normalizeOracleManaCostString(chosenAmountRaw) : '';
  const resolvedManaLabel = (chosenAmount && manaOptions.includes(chosenAmount))
    ? chosenAmount
    : (resolvedMana || manaOptions[0] || step.mana);
  const manaCost = parseSupportedManaCostString(resolvedManaLabel, Number(ctx.xValue));
  if (!manaCost) {
    const energyAmount = parseEnergyCostAmount(resolvedManaLabel || String(step.mana || ''));
    if (energyAmount > 0) {
      return {
        applied: false,
        message: `Skipped unless-pays-mana step (energy payment choice required): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            payerId,
            manaCost: resolvedManaLabel || step.mana,
            energyAmount,
            ...(boundSpellId ? { targetSpellId: boundSpellId } : {}),
            ...(boundPermanentId ? { targetPermanentId: boundPermanentId } : {}),
          },
        },
      };
    }
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  if (isZeroManaCost(manaCost) && manaOptions.length === 0) {
    return {
      applied: true,
      shouldApplyNestedSteps: false,
      paidManaAmount: resolvedManaLabel,
      log: [`Resolved unless-pays-mana step (payer paid ${resolvedManaLabel}): ${step.raw}`],
    };
  }

  const explicitChoice = readUnlessPaysManaChoice(ctx);
  const xValue = Number(ctx.xValue);
  const bindingMeta = {
    payerId,
    manaCost: resolvedManaLabel,
    ...(manaOptions.length > 0 ? { manaOptions } : {}),
    ...(boundSpellId ? { targetSpellId: boundSpellId } : {}),
    ...(boundPermanentId ? { targetPermanentId: boundPermanentId } : {}),
  };

  if (manaOptions.length > 1) {
    const affordable = manaOptions.filter((label) => tryPayManaLabel(state, payerId, label, xValue).canPay);
    if (!explicitChoice) {
      return {
        applied: false,
        message: `Skipped unless-pays-mana step (opponent choice required): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice', metadata: bindingMeta },
      };
    }
    if (explicitChoice === 'decline' || affordable.length === 0) {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-mana step (payer declined or cannot pay ${manaOptions.join(' or ')}): ${step.raw}`],
      };
    }
    if (explicitChoice === 'pay') {
      const payLabel = (chosenAmount && manaOptions.includes(chosenAmount) && affordable.includes(chosenAmount))
        ? chosenAmount
        : (affordable.length === 1 ? affordable[0] : '');
      if (!payLabel) {
        return {
          applied: false,
          message: `Skipped unless-pays-mana step (opponent choice required): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice', metadata: bindingMeta },
        };
      }
      const paid = tryPayManaLabel(state, payerId, payLabel, xValue);
      if (!paid.canPay || !paid.remainingPool) {
        return {
          applied: true,
          shouldApplyNestedSteps: true,
          log: [`Resolved unless-pays-mana step (payer cannot pay ${payLabel}): ${step.raw}`],
        };
      }
      const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
      manaPoolRecord[payerId] = paid.remainingPool;
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        paidManaAmount: payLabel,
        state: { ...(state as any), manaPool: manaPoolRecord } as any,
        log: [`Resolved unless-pays-mana step (payer chose to pay ${payLabel}): ${step.raw}`],
      };
    }
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice', metadata: bindingMeta },
    };
  }

  const manaPoolRecord: Record<PlayerID, any> = { ...((((state as any).manaPool || {}) as any) || {}) };
  const currentPool = manaPoolRecord[payerId] || createEmptyManaPool();
  const payment = payManaCost(currentPool, manaCost);
  const canPayMana = Boolean(payment.success && payment.remainingPool);

  if (!explicitChoice) {
    return {
      applied: false,
      message: `Skipped unless-pays-mana step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: bindingMeta,
      },
    };
  }

  if (canPayMana && explicitChoice === 'pay') {
    manaPoolRecord[payerId] = payment.remainingPool;
    return {
      applied: true,
      shouldApplyNestedSteps: false,
      paidManaAmount: resolvedManaLabel,
      state: { ...(state as any), manaPool: manaPoolRecord } as any,
      log: [`Resolved unless-pays-mana step (payer chose to pay ${resolvedManaLabel}): ${step.raw}`],
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-mana step (payer ${explicitChoice === 'pay' ? 'cannot pay' : 'declined to pay'} ${resolvedManaLabel}): ${step.raw}`],
  };
}
