/**
 * oracleIRExecutorDamageExtendedTargetFallback.ts
 *
 * Origin parent: oracleIRExecutorDamageStepHandlers.ts (applyDealDamageStep tail fallback).
 * Cluster: deal_damage recipients that need a player choice rather than a deterministic scan:
 * - "any other target" (Black Panther: "he deals that much damage to any other target")
 * - "each of up to X targets, where X is the number of times he was kicked" (Batroc)
 * and the final unsupported-target result for everything else.
 *
 * Public entry: resolveDamageTargetFallback. The caller injects `applyBoundTarget` (the parent's
 * applyDealDamageStep) so this leaf never imports the parent.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { tryApplyMassDamageRecipients } from './oracleIRExecutorDamageMassRecipientFallback';

type DealDamageStep = Extract<OracleEffectStep, { kind: 'deal_damage' }>;

export type DamageTargetFallbackResult =
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: 'unsupported_target' | 'player_choice_required';
      readonly options?: { readonly classification: 'player_choice' };
    }
  | {
      readonly applied: true;
      readonly state: GameState;
      readonly log: readonly string[];
      readonly count?: number;
      readonly excessDamageDealtThisWay: number;
      readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
    };

export type ApplyBoundDamageTarget = (
  state: GameState,
  step: DealDamageStep,
  ctx: OracleIRExecutionContext,
) => { readonly applied: boolean; readonly state?: GameState; readonly log?: readonly string[]; readonly count?: number; readonly excessDamageDealtThisWay?: number; readonly lastDamagedBattlefieldPermanentIds?: readonly string[] };

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const UP_TO_TARGETS_RE =
  /^(?:each of\s+)?up to\s+(x|\d+|one|two|three|four|five|six)\s+(?:other\s+)?(?:target\s+)?(?:targets?|creatures?|players?)\b(?:,?\s*where x is (.+))?$/i;

function readKickedTimes(state: GameState, ctx: OracleIRExecutionContext): number | null {
  const sourceId = String(ctx.sourceId || '').trim();
  const candidates: any[] = [
    ((state.battlefield || []) as any[]).find((perm) => String(perm?.id || '').trim() === sourceId),
    ((state.stack || []) as any[]).find((item) => String(item?.id || '').trim() === sourceId),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const count =
      candidate?.kickerPaidCount ??
      candidate?.timesKicked ??
      candidate?.kickedTimes ??
      candidate?.card?.kickerPaidCount ??
      candidate?.card?.timesKicked ??
      candidate?.card?.kickedTimes;
    if (typeof count === 'number' && Number.isFinite(count)) return Math.max(0, Math.floor(count));
    if (typeof candidate?.wasKicked === 'boolean') return candidate.wasKicked ? 1 : 0;
  }
  return null;
}

function resolveUpToTargetCount(
  state: GameState,
  ctx: OracleIRExecutionContext,
  countWord: string,
  whereClause: string | undefined,
): number | null {
  const word = String(countWord || '').toLowerCase();
  if (/^\d+$/.test(word)) return Number(word);
  if (NUMBER_WORDS[word] !== undefined) return NUMBER_WORDS[word];
  if (word !== 'x') return null;
  if (whereClause && /^the number of times .+ (?:was|were) kicked$/i.test(whereClause.trim())) {
    return readKickedTimes(state, ctx);
  }
  const announced = Number(ctx.xValue);
  return Number.isFinite(announced) ? Math.max(0, Math.floor(announced)) : null;
}

function chosenTargetIds(ctx: OracleIRExecutionContext): string[] {
  return (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
}

function unsupportedOrChoice(step: DealDamageStep): DamageTargetFallbackResult {
  const text = String((step.target as any)?.text || step.raw || '');
  const needsChoice = /\bany(?:\s+other)?\s+target\b/i.test(text);
  return {
    applied: false,
    message: `Skipped deal damage (unsupported target): ${step.raw}`,
    reason: needsChoice ? 'player_choice_required' : 'unsupported_target',
    ...(needsChoice ? { options: { classification: 'player_choice' as const } } : {}),
  };
}

export function resolveDamageTargetFallback(args: {
  readonly state: GameState;
  readonly step: DealDamageStep;
  readonly ctx: OracleIRExecutionContext;
  /** Damage already resolved by the caller; pinned per target so "its power" is not re-read from the target. */
  readonly amount: number | null;
  readonly applyBoundTarget: ApplyBoundDamageTarget;
}): DamageTargetFallbackResult {
  const { state, step, ctx, applyBoundTarget } = args;
  const targetText = String((step.target as any)?.kind === 'raw' ? (step.target as any).text || '' : '')
    .replace(/\s+/g, ' ')
    .trim();

  const upTo = targetText.match(UP_TO_TARGETS_RE);
  if (upTo) {
    const limit = resolveUpToTargetCount(state, ctx, String(upTo[1] || ''), upTo[2]);
    if (limit === null) return unsupportedOrChoice(step);
    if (limit === 0) {
      return { applied: true, state, log: [`No targets chosen (up to 0): ${step.raw}`], count: 0, excessDamageDealtThisWay: 0 };
    }
    const chosen = chosenTargetIds(ctx).slice(0, limit);
    if (chosen.length === 0) {
      return {
        applied: false,
        message: `Skipped deal damage (requires target choice, up to ${limit}): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    let workingState = state;
    const log: string[] = [];
    const damagedIds: string[] = [];
    let total = 0;
    let excess = 0;
    for (const id of chosen) {
      const isPlayer = (workingState.players || []).some((player: any) => String(player?.id || '').trim() === id);
      const perTargetCtx = {
        ...ctx,
        selectorContext: {
          ...(ctx.selectorContext || {}),
          chosenObjectIds: undefined,
          targetPlayerId: isPlayer ? id : undefined,
          targetPermanentId: isPlayer ? undefined : id,
        },
        targetPlayerId: isPlayer ? id : undefined,
        targetPermanentId: isPlayer ? undefined : id,
      } as OracleIRExecutionContext;
      const result = applyBoundTarget(
        workingState,
        {
          ...step,
          target: { kind: 'raw', text: 'any target' },
          ...(args.amount !== null ? { amount: { kind: 'number', value: args.amount } } : {}),
        } as DealDamageStep,
        perTargetCtx,
      );
      if (!result.applied || !result.state) continue;
      workingState = result.state;
      log.push(...(result.log || []));
      total += Number(result.count) || 0;
      excess += Number(result.excessDamageDealtThisWay) || 0;
      damagedIds.push(...(result.lastDamagedBattlefieldPermanentIds || []));
    }
    return {
      applied: true,
      state: workingState,
      log,
      count: total,
      excessDamageDealtThisWay: excess,
      ...(damagedIds.length > 0 ? { lastDamagedBattlefieldPermanentIds: damagedIds } : {}),
    };
  }

  const massRecipients = tryApplyMassDamageRecipients(args);
  if (massRecipients) return massRecipients;

  return unsupportedOrChoice(step);
}
