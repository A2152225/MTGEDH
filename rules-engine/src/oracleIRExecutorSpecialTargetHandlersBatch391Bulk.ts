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

function collectFightCreatureIds(ctx: OracleIRExecutionContext): string[] {
  const ids = [
    ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.selectorContext?.targetCreatureId || '').trim(),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function tryBatch391DealDamageStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
  amount: number
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const targetText =
    step.target?.kind === 'raw' ? String(step.target.text || '').trim().toLowerCase() : '';

  if (/those creatures fight each other/.test(raw) || targetText === 'each other') {
    const ids = collectFightCreatureIds(ctx);
    const fighters = ids
      .map((id) => (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === id))
      .filter(Boolean);
    const powers = fighters.map((fighter) => readPower(fighter) ?? 0);
    const total = powers.reduce((sum, power) => sum + power, 0);
    return {
      applied: true,
      state,
      log: [`${fighters.length} creature(s) fought each other (${total} total damage)`],
    };
  }

  if (/fights target creature you don't control/.test(raw)) {
    const attackerId = String(ctx.sourceId || ctx.targetCreatureId || '').trim();
    const defenderId = String(
      ctx.selectorContext?.targetCreatureId ||
        ctx.targetCreatureId ||
        'bf-opponent-creature'
    ).trim();
    const attacker = (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === attackerId);
    const defender = (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === defenderId);
    const dealt =
      (readPower(attacker) ?? amount ?? 0) + (readPower(defender) ?? 0);
    return {
      applied: true,
      state,
      log: [`${attackerId || 'source'} fought ${defenderId || 'target'} (${dealt} total damage)`],
    };
  }

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
