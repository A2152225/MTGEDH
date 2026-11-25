/**
 * oracleIRExecutorDamageBoundTargetFallback.ts
 *
 * deal_damage recipients bound at cast/activation time whose target phrase has no dedicated
 * resolver: "target player or planeswalker" (Flamewave Invoker), "each of one or two targets"
 * (Storm of Steel), "N damage divided as you choose among one or two targets" (Chandra's
 * Pyrohelix, Arc Lightning). Division uses ctx.damageDivisionByTargetId when the caller
 * collected one (CR 601.2d); otherwise one target takes everything and several targets split
 * as evenly as possible, earlier targets taking the remainder.
 *
 * Public entry: tryApplyLooseBoundDamageTargets. The caller injects `applyBoundTarget`.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveLooseBoundTargetRecipients } from './oracleIRExecutorBoundTargetLooseFilter';

type DealDamageStep = Extract<OracleEffectStep, { kind: 'deal_damage' }>;

type BoundApply = (
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
) => {
  readonly applied: boolean;
  readonly state?: GameState;
  readonly log?: readonly string[];
  readonly count?: number;
  readonly excessDamageDealtThisWay?: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

export type LooseBoundDamageResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count: number;
  readonly excessDamageDealtThisWay: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

function divideDamage(total: number, ids: readonly string[], ctx: OracleIRExecutionContext): Map<string, number> {
  const chosen = (ctx as any).damageDivisionByTargetId as Record<string, number> | undefined;
  const out = new Map<string, number>();
  if (chosen && typeof chosen === 'object') {
    for (const id of ids) out.set(id, Math.max(0, Math.floor(Number(chosen[id]) || 0)));
    return out;
  }
  // CR 601.2d: each target must be assigned at least 1; without a recorded division split evenly.
  const base = Math.floor(total / Math.max(1, ids.length));
  let remainder = total - base * ids.length;
  for (const id of ids) {
    out.set(id, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

export function tryApplyLooseBoundDamageTargets(args: {
  readonly state: GameState;
  readonly step: DealDamageStep;
  readonly ctx: OracleIRExecutionContext;
  readonly amount: number | null;
  readonly applyBoundTarget: BoundApply;
}): LooseBoundDamageResult | null {
  const { state, step, ctx, amount, applyBoundTarget } = args;
  if (amount === null || amount < 0) return null;
  if ((ctx as any).__looseBoundDamageApplied) return null;
  const targetText = String((step.target as any)?.kind === 'raw' ? (step.target as any).text || '' : '');
  const bound = resolveLooseBoundTargetRecipients(state as any, targetText, ctx);
  if (!bound || bound.recipients.length === 0) return null;
  const divided = String((step as any).division || '') === 'as_you_choose' || /\bdivided as you choose\b/i.test(String(step.raw || ''));
  const ids = bound.recipients.map((r) => r.id);
  const shares = divided ? divideDamage(amount, ids, ctx) : new Map(ids.map((id) => [id, amount] as const));

  let workingState = state;
  const log: string[] = [];
  const damagedIds: string[] = [];
  let total = 0;
  let excess = 0;
  for (const recipient of bound.recipients) {
    const share = shares.get(recipient.id) ?? 0;
    if (share <= 0) continue;
    const perTargetCtx = {
      ...ctx,
      __looseBoundDamageApplied: true,
      selectorContext: {
        ...(ctx.selectorContext || {}),
        chosenObjectIds: undefined,
        targetPlayerId: recipient.isPlayer ? recipient.id : undefined,
        targetPermanentId: recipient.isPlayer ? undefined : recipient.id,
        targetCreatureId: undefined,
      },
      targetPlayerId: recipient.isPlayer ? recipient.id : undefined,
      targetPermanentId: recipient.isPlayer ? undefined : recipient.id,
      targetCreatureId: undefined,
    } as OracleIRExecutionContext;
    const result = applyBoundTarget(
      workingState,
      {
        ...step,
        division: undefined,
        target: { kind: 'raw', text: 'any target' },
        amount: { kind: 'number', value: share },
        whereX: undefined,
      } as unknown as DealDamageStep,
      perTargetCtx,
    );
    if (!result.applied || !result.state) continue;
    workingState = result.state;
    log.push(...(result.log || []));
    total += Number(result.count) || 0;
    excess += Number(result.excessDamageDealtThisWay) || 0;
    damagedIds.push(...(result.lastDamagedBattlefieldPermanentIds || []));
  }
  if (workingState === state && total === 0 && log.length === 0) return null;
  return {
    applied: true,
    state: workingState,
    log,
    count: total,
    excessDamageDealtThisWay: excess,
    ...(damagedIds.length > 0 ? { lastDamagedBattlefieldPermanentIds: damagedIds } : {}),
  };
}

type SplitApplyResult = {
  readonly applied: boolean;
  readonly state?: GameState;
  readonly log?: readonly string[];
  readonly count?: number;
  readonly excessDamageDealtThisWay?: number;
  readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
};

/**
 * "N damage divided as you choose among one or two targets" with two or more chosen targets:
 * single-target resolvers would put everything on the first target, so divide first
 * (CR 601.2d). Fixed or announced-X amounts only.
 */
function tryApplyDividedDamageAmongBoundTargets(
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
  apply: BoundApply,
): LooseBoundDamageResult | null {
  const divided = String((step as any).division || '') === 'as_you_choose' || /\bdivided as you choose\b/i.test(String(step.raw || ''));
  if (!divided) return null;
  const amountSpec: any = step.amount;
  const announcedX = Number(ctx.xValue);
  const amount = amountSpec?.kind === 'number'
    ? Number(amountSpec.value)
    : amountSpec?.kind === 'x' && Number.isFinite(announcedX) ? announcedX : NaN;
  if (!Number.isFinite(amount)) return null;
  const bound = resolveLooseBoundTargetRecipients(state as any, String((step.target as any)?.text || ''), ctx);
  if (!bound || bound.recipients.length < 2) return null;
  return tryApplyLooseBoundDamageTargets({ state, step, ctx, amount, applyBoundTarget: apply });
}

const COMPOUND_RECIPIENT_RE = /^(.+?)\s+and\s+(\d+|x)\s+damage\s+to\s+(.+)$/i;

/**
 * "Char deals 4 damage to any target and 2 damage to you" / "... to target creature and
 * 1 damage to that creature's controller": one source, two amounts, two recipients. Applies
 * the first clause, then the second against the updated state; returns the first failure
 * unchanged so the all-or-nothing gate still sees it. Null when the text is not compound.
 */
/**
 * True for a single "target ..." damage phrase ("target creature", "target creature or planeswalker").
 * Its recipient is the object chosen on cast/activation, so the mass selector / mixed paths (which damage
 * every matching permanent) must not handle it; the bound-target fallback does (CR 115.1, 608.2b).
 */
export function isSingleTargetDamagePhrase(rawText: string): boolean {
  const text = String(rawText || '').trim().toLowerCase();
  return /^target\b/.test(text) && !/\b(?:each|all|and)\b/.test(text);
}

export function tryApplyCompoundOrDividedDamage<R extends SplitApplyResult>(
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
  apply: (state: GameState, step: DealDamageStep, ctx: OracleIRExecutionContext) => R,
): R | null {
  if ((step.target as any)?.kind !== 'raw') return null;
  const divided = tryApplyDividedDamageAmongBoundTargets(state, step, ctx, apply);
  if (divided) return divided as unknown as R;
  const targetText = String((step.target as any).text || '').trim();
  const match = targetText.match(COMPOUND_RECIPIENT_RE);
  if (!match) return null;
  const firstTarget = String(match[1] || '').trim();
  const secondAmountRaw = String(match[2] || '').trim().toLowerCase();
  const secondTarget = String(match[3] || '').trim();
  if (!firstTarget || !secondTarget || /\bdamage\b/i.test(firstTarget)) return null;
  const sourceText = String((step.source as any)?.text || 'this permanent');
  const firstStep = {
    ...step,
    target: { kind: 'raw', text: firstTarget },
    raw: `${sourceText} deals damage to ${firstTarget}`,
  } as unknown as DealDamageStep;
  const secondStep = {
    ...step,
    amount: secondAmountRaw === 'x' ? { kind: 'x' } : { kind: 'number', value: Number(secondAmountRaw) },
    target: { kind: 'raw', text: secondTarget },
    raw: `${sourceText} deals ${secondAmountRaw} damage to ${secondTarget}`,
  } as unknown as DealDamageStep;
  const first = apply(state, firstStep, ctx);
  if (!first.applied || !first.state) return first;
  const second = apply(first.state, secondStep, ctx);
  if (!second.applied || !second.state) return second;
  const damaged = [
    ...(first.lastDamagedBattlefieldPermanentIds || []),
    ...(second.lastDamagedBattlefieldPermanentIds || []),
  ];
  return {
    ...second,
    log: [...(first.log || []), ...(second.log || [])],
    count: (Number(first.count) || 0) + (Number(second.count) || 0),
    excessDamageDealtThisWay: (Number(first.excessDamageDealtThisWay) || 0) + (Number(second.excessDamageDealtThisWay) || 0),
    ...(damaged.length > 0 ? { lastDamagedBattlefieldPermanentIds: damaged } : {}),
  } as R;
}
