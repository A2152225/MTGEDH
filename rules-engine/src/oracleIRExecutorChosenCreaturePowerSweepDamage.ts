/**
 * Origin parent: rules-engine/src/oracleIRExecutorSpecialTargetRegenerateDamageHandlers.ts
 * Cluster: chosen/targeted creature deals damage equal to its power to each
 *   other creature. Generic deal_damage excludeSourceId only drops
 *   ctx.sourceId (the spell), so the chosen creature would also take the
 *   sweep.
 * Public: tryChosenCreaturePowerSweepDealDamageStep
 * Leaf must not import oracleIR.ts or oracleIRExecutorSpecialTargetRegenerateDamageHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  addDamageToPermanentLikeCreatureFromSource,
  isExecutorCreature,
} from './oracleIRExecutorPermanentUtils';
import {
  collectBoundIds,
  normalizeRaw,
  normalizeTargetText,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';

function sourceText(step: Extract<OracleEffectStep, { kind: 'deal_damage' }>): string {
  const source = (step as { source?: { kind?: string; text?: string } }).source;
  if (source && source.kind === 'raw') {
    return String(source.text || '')
      .replace(/\u2019/g, "'")
      .trim()
      .toLowerCase();
  }
  return '';
}

function isChosenCreaturePowerSweep(
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
): boolean {
  const raw = normalizeRaw(step);
  const target = normalizeTargetText(step);
  const source = sourceText(step);
  if (target !== 'each other creature') return false;
  if (source && source !== 'it' && source !== 'target creature you control') return false;
  return /deals?\s+damage\s+equal\s+to\s+its\s+power/.test(raw);
}

function resolveSweepSourceCreatureId(
  state: GameState,
  ctx: OracleIRExecutionContext,
): string {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const candidates = [
    ...collectBoundIds(ctx),
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
  ].filter(Boolean);
  for (const candidateId of candidates) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '').trim() === candidateId);
    if (permanent && isExecutorCreature(permanent)) return candidateId;
  }
  return '';
}

export function tryChosenCreaturePowerSweepDealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  amount: number,
): SpecialTargetStepResult | null {
  if (!isChosenCreaturePowerSweep(step)) return null;
  // fightEarly calls this with amount 0 before quantity resolution.
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const sourceCreatureId = resolveSweepSourceCreatureId(state, ctx);
  if (!sourceCreatureId) {
    return {
      applied: false,
      message: `Skipped chosen-creature power sweep (no bound source creature): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  let damageDealt = 0;
  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String(permanent?.id || '').trim();
    if (!permanentId || permanentId === sourceCreatureId || !isExecutorCreature(permanent)) {
      return permanent;
    }
    damageDealt += amount;
    return addDamageToPermanentLikeCreatureFromSource(permanent, amount, sourceCreatureId);
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield,
    } as GameState,
    log: [`${sourceCreatureId} dealt ${amount} damage to each other creature`],
    count: damageDealt,
  };
}
