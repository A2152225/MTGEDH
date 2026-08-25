/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialDoubleCountersStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import {
  collectBoundIds,
  normalizeRaw,
  normalizeTargetText,
  readPower,
  typeLineHasSubtype,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';
import {
  resolveEnchantedHost,
  resolveSourcePermanent,
} from './oracleIRExecutorSpecialTargetResolve';

export function trySpecialDoubleCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'double_counters' }>,
  ctx: OracleIRExecutionContext
): SpecialTargetStepResult | null {
  const raw = normalizeRaw(step);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const counterName = String(step.counter || '').trim();
  const controllerId = String(ctx.controllerId || 'p1').trim();

  const doubleOnTargets = (targets: readonly BattlefieldPermanent[]): GameState => {
    const targetIds = new Set(targets.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    const nextBattlefield = battlefield.map((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!targetIds.has(id)) return perm;
      const counters = { ...((perm?.counters || {}) as Record<string, number>) };
      for (const [name, rawCount] of Object.entries(counters)) {
        if (counterName && name !== counterName) continue;
        const count = Number(rawCount);
        if (Number.isFinite(count) && count > 0) counters[name] = count * 2;
      }
      return { ...perm, counters };
    });
    return { ...(state as any), battlefield: nextBattlefield } as GameState;
  };

  if (/double the number of \+1\/\+1 counters on enchanted creature/.test(raw)) {
    const host = resolveEnchantedHost(battlefield, ctx);
    if (!host) return null;
    return {
      applied: true,
      state: doubleOnTargets([host]),
      log: ['Doubled +1/+1 counters on enchanted creature'],
    };
  }

  if (/double the number of \+1\/\+1 counters on this permanent if its power is 16 or less/.test(raw)) {
    const source = resolveSourcePermanent(battlefield, ctx);
    if (!source) return null;
    const power = readPower(source) ?? 0;
    if (power > 16) return { applied: true, state, log: ['Skipped doubling counters (power above 16)'] };
    return {
      applied: true,
      state: doubleOnTargets([source]),
      log: ['Doubled +1/+1 counters on this permanent'],
    };
  }

  if (/double the number of each kind of counter on each spider and legendary creature you control/.test(raw)) {
    const targets = battlefield.filter(
      (perm) =>
        permanentMatchesType(perm, 'creature') &&
        String((perm as any)?.controller || '').trim() === controllerId &&
        (typeLineHasSubtype(perm, 'spider') || typeLineHasSubtype(perm, 'legendary'))
    );
    return {
      applied: true,
      state: doubleOnTargets(targets),
      log: [`Doubled counters on ${targets.length} spider/legendary creature(s)`],
    };
  }

  if (/double the number of each kind of counter on any number of target permanents/.test(raw)) {
    const ids = new Set(collectBoundIds(ctx));
    const targets = battlefield.filter((perm) => ids.has(String((perm as any)?.id || '').trim()));
    return {
      applied: true,
      state: doubleOnTargets(targets),
      log: [`Doubled counters on ${targets.length} target permanent(s)`],
    };
  }

  const targetText = normalizeTargetText(step);
  const resolveCounteredCreatureAntecedents = (): BattlefieldPermanent[] => {
    const movedIds = new Set(
      (Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const boundIds = new Set(collectBoundIds(ctx));
    return battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (movedIds.size > 0) return movedIds.has(id);
      if (boundIds.size > 0) return boundIds.has(id) && permanentMatchesType(perm, 'creature');
      return (
        String((perm as any)?.controller || '').trim() === controllerId &&
        permanentMatchesType(perm, 'creature') &&
        Number(((perm as any)?.counters || {})[counterName || '+1/+1'] ?? 0) > 0
      );
    });
  };

  if (
    /^each of those creatures$/.test(targetText) ||
    /^those creatures$/.test(targetText) ||
    /^that creature$/.test(targetText) ||
    /each creature that had a .+ counter put on it this way/.test(targetText) ||
    /double the number of \+1\/\+1 counters on each of those creatures/.test(raw) ||
    /double the number of \+1\/\+1 counters on that creature/.test(raw) ||
    /double the number of \+1\/\+1 counters on each creature that had a .+ counter put on it this way/.test(raw)
  ) {
    const targets =
      /^that creature$/.test(targetText) && Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
        ? battlefield.filter((perm) =>
            ctx.lastMovedBattlefieldPermanentIds!.includes(String((perm as any)?.id || '').trim())
          )
        : resolveCounteredCreatureAntecedents();
    if (targets.length === 0) return null;
    return {
      applied: true,
      state: doubleOnTargets(targets),
      log: [`Doubled ${counterName || 'counter'}(s) on ${targets.length} creature(s)`],
    };
  }

  return null;
}

