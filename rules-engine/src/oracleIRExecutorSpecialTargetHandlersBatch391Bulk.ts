import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { SpecialTargetStepResult } from './oracleIRExecutorSpecialTargetHandlers';
import { applyControllerDamageEqualToCreaturePowerStep } from './oracleIRExecutorPowerBasedDamage';

function normalizeRaw(step: { readonly raw?: string }): string {
  return String(step.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

export function tryBatch391DealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  _amount: number
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);

  // Fight clauses are applied by tryApplyFightDealDamageStep (marks damage both ways).

  // "deals damage equal to that card's mana value" is deliberately absent: it reported a damage total
  // in the log without marking any permanent. The generic deal_damage handler resolves the same
  // object_stat amount from lastMovedCards and actually applies it.

  // "... deals damage to that creature's controller equal to the creature's power" (Boros Fury-Shield,
  // Kaervek's Purge, Cinder Cloud). Previously log-only; now the controller actually loses life.
  // A creature destroyed/sacrificed this way keeps its recorded (last known) power; a creature still on
  // the battlefield uses its current power.
  if (/creature's controller equal to the creature's power|equal to the creature's power to the creature's controller|to that creature's controller equal to the creature's power/.test(raw)) {
    const dealt = applyControllerDamageEqualToCreaturePowerStep(state, step, ctx);
    if (dealt) return dealt;
  }

  return null;
}
