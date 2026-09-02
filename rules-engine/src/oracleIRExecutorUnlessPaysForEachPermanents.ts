/**
 * Origin parent: oracleIRExecutorMainLoopLateSteps.ts
 * Cluster: Heroism / Giant Albatross “for each [permanent], … unless its controller pays”
 *   plus Whirlwind Denial per-stack-object iteration and Winter's Chill “those creatures”.
 * Public: resolveUnlessPaysForEachPermanentIds, resolveUnlessPaysForEachStackObjectIds,
 *   bindUnlessPaysForEachContext, bindUnlessPaysForEachStackContext, stripUnlessPaysChoiceFromContext
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorMainLoopLateSteps.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { isAttackingPermanent, permanentIsCreature } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';

function permanentHasColor(permanent: unknown, colorWord: string): boolean {
  const wanted = String(colorWord || '').trim().toLowerCase();
  const code: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' };
  const colors = getColorsFromObject(permanent).map((entry) => String(entry || '').toLowerCase());
  if (colors.includes(wanted)) return true;
  const pip = code[wanted];
  return Boolean(pip && colors.includes(pip));
}

function sourceIdOf(ctx: OracleIRExecutionContext): string {
  return String(ctx.sourceId || '').trim();
}

function dealtDamageToSourceThisTurn(permanent: unknown, sourceId: string): boolean {
  if (!sourceId) return false;
  const perm = permanent as {
    dealtCombatDamageTo?: unknown;
    damagedPermanentIds?: unknown;
    combatDamageDealtTo?: unknown;
  };
  const bags = [perm.dealtCombatDamageTo, perm.damagedPermanentIds, perm.combatDamageDealtTo];
  for (const bag of bags) {
    if (bag instanceof Set && bag.has(sourceId)) return true;
    if (Array.isArray(bag) && bag.some((entry) => String(entry || '').trim() === sourceId)) return true;
  }
  return false;
}

function matchesForEachText(
  permanent: unknown,
  eachText: string,
  ctx: OracleIRExecutionContext,
): boolean {
  const normalized = normalizeOracleText(eachText);
  if (!normalized || !permanentIsCreature(permanent as any)) return false;

  const attackingColor = normalized.match(/^attacking (white|blue|black|red|green) creature$/i);
  if (attackingColor) {
    return isAttackingPermanent(permanent) && permanentHasColor(permanent, String(attackingColor[1] || ''));
  }
  if (/^attacking creature$/i.test(normalized)) {
    return isAttackingPermanent(permanent);
  }
  if (/^creature that dealt damage to this creature this turn$/i.test(normalized)) {
    return dealtDamageToSourceThisTurn(permanent, sourceIdOf(ctx));
  }
  if (/^(?:of )?those creatures$/i.test(normalized)) {
    const wanted = new Set(
      [
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.targetPermanentId || '').trim(),
      ]
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    const id = String((permanent as { id?: string })?.id || '').trim();
    return Boolean(id && wanted.has(id));
  }
  return false;
}

export function resolveUnlessPaysForEachPermanentIds(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_mana' | 'unless_pays_life' }>,
  ctx: OracleIRExecutionContext,
): string[] | null {
  const eachText = String((step as { forEachPermanentText?: string }).forEachPermanentText || '').trim();
  if (!eachText) return null;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const sourceId = sourceIdOf(ctx);
  return battlefield
    .filter((perm) => {
      const id = String((perm as { id?: string })?.id || '').trim();
      if (!id || (sourceId && id === sourceId)) return false;
      return matchesForEachText(perm, eachText, ctx);
    })
    .map((perm) => String((perm as { id?: string }).id || '').trim())
    .filter(Boolean);
}

export function bindUnlessPaysForEachContext(
  ctx: OracleIRExecutionContext,
  permanentId: string,
): OracleIRExecutionContext {
  const id = String(permanentId || '').trim();
  return {
    ...ctx,
    targetCreatureId: id,
    targetPermanentId: id,
    selectorContext: {
      ...(ctx.selectorContext || {}),
      targetCreatureId: id,
      targetPermanentId: id,
    },
  };
}

export function resolveUnlessPaysForEachStackObjectIds(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_mana' | 'unless_pays_life' }>,
  ctx: OracleIRExecutionContext,
): string[] | null {
  if (!(step as { forEachOpponentStackObjects?: boolean }).forEachOpponentStackObjects) return null;
  const stack = Array.isArray((state as { stack?: unknown[] }).stack)
    ? ((state as { stack: any[] }).stack)
    : [];
  const sourceId = sourceIdOf(ctx);
  const controllerId = String(ctx.controllerId || '').trim();
  return stack
    .filter((item) => {
      const id = String(item?.id || '').trim();
      if (!id || (sourceId && id === sourceId)) return false;
      const itemController = String(item?.controller || item?.controllerId || '').trim();
      return Boolean(itemController) && itemController !== controllerId;
    })
    .map((item) => String(item?.id || '').trim())
    .filter(Boolean);
}

export function bindUnlessPaysForEachStackContext(
  ctx: OracleIRExecutionContext,
  stackItemId: string,
): OracleIRExecutionContext {
  const id = String(stackItemId || '').trim();
  return {
    ...ctx,
    targetSpellId: id,
    selectorContext: {
      ...(ctx.selectorContext || {}),
      targetSpellId: id,
    },
  };
}

export function stripUnlessPaysChoiceFromContext(
  ctx: OracleIRExecutionContext,
): OracleIRExecutionContext {
  const selector = { ...(ctx.selectorContext || {}) } as Record<string, unknown>;
  delete selector.unlessPaysManaChoice;
  delete selector.unlessPaysLifeChoice;
  delete selector.unlessPaysManaAmount;
  return {
    ...ctx,
    unlessPaysManaChoice: undefined,
    unlessPaysLifeChoice: undefined,
    unlessPaysManaAmount: undefined,
    selectorContext: selector,
  };
}
