import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { SpecialTargetStepResult } from './oracleIRExecutorSpecialTargetHandlers';

function normalizeRaw(step: { readonly raw?: string }): string {
  return String(step.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

function readPower(entry: unknown): number | null {
  const power = Number((entry as any)?.power ?? (entry as any)?.card?.power);
  return Number.isFinite(power) ? Math.max(0, power) : null;
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

  if (/equal to the creature's power/.test(raw)) {
    const destroyed = [
      ...(Array.isArray((ctx as any)?.lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
      ...(Array.isArray((ctx as any)?.lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const destroyedCreature = destroyed.find((entry) => {
      const typeLine = String((entry as any)?.type_line || (entry as any)?.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    if (destroyedCreature) {
      const power = readPower(destroyedCreature);
      if (power !== null) {
        return { applied: true, state, log: [`Dealt ${power} damage equal to creature power (${step.raw})`] };
      }
    }
    const creatureId = String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.chosenObjectIds?.[0] ||
        ''
    ).trim();
    const creature = creatureId
      ? (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === creatureId)
      : null;
    const power = readPower(creature);
    if (power !== null) {
      return { applied: true, state, log: [`Dealt ${power} damage equal to creature power (${step.raw})`] };
    }
  }

  if (/creature's controller equal to the creature's power|equal to the creature's power to the creature's controller|to that creature's controller equal to the creature's power/.test(raw)) {
    const destroyed = [
      ...(Array.isArray((ctx as any)?.lastDestroyedPermanents) ? (ctx as any).lastDestroyedPermanents : []),
      ...(Array.isArray((ctx as any)?.lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    const destroyedCreature = destroyed.find((entry) => {
      const typeLine = String((entry as any)?.type_line || (entry as any)?.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    if (destroyedCreature) {
      const power = readPower(destroyedCreature);
      if (power !== null) {
        return { applied: true, state, log: [`Dealt ${power} damage to creature's controller (${step.raw})`] };
      }
    }
    const creatureId = String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.combatOpponentCreatureId ||
        'bf-opponent-creature'
    ).trim();
    const creature = (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === creatureId);
    const power = readPower(creature);
    if (power !== null) {
      return { applied: true, state, log: [`Dealt ${power} damage to creature's controller (${step.raw})`] };
    }
  }

  return null;
}
