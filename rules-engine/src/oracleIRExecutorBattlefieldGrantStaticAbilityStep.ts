// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyGrantStaticAbilityStep.
// Public entry: applyGrantStaticAbilityStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { tryApplyGrantKeywordsToStackSpell } from './oracleIRExecutorBattlefieldGrantStackSpell';
import { tryApplyAttackTaxThisTurnGrant } from './oracleIRExecutorAttackTaxThisTurn';
import { tryApplyAttackYouProhibitedExceptKeywordsGrant } from './oracleIRExecutorAttackYouProhibitedExceptKeywords';
import { tryApplyBlockTaxThisTurnGrant } from './oracleIRExecutorBlockTaxThisTurn';
import { tryApplyPreventLifeGainThisTurnGrant } from './oracleIRExecutorPreventLifeGainThisTurn';
import { tryApplyUntilEotProtectionOverrideGrant } from './oracleIRExecutorUntilEotProtectionOverride';

export function applyGrantStaticAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const thisTurnLock = tryApplyPreventLifeGainThisTurnGrant(state, step, ctx);
  if (thisTurnLock) return thisTurnLock;
  const attackYouLock = tryApplyAttackYouProhibitedExceptKeywordsGrant(state, step, ctx);
  if (attackYouLock) return attackYouLock;
  const thisTurnAttackTax = tryApplyAttackTaxThisTurnGrant(state, step, ctx);
  if (thisTurnAttackTax) return thisTurnAttackTax;
  const thisTurnBlockTax = tryApplyBlockTaxThisTurnGrant(state, step, ctx);
  if (thisTurnBlockTax) return thisTurnBlockTax;
  const untilEotOverride = tryApplyUntilEotProtectionOverrideGrant(state, step, ctx);
  if (untilEotOverride) return untilEotOverride;
  const stackSpellGrant = tryApplyGrantKeywordsToStackSpell(state, step, ctx);
  if (stackSpellGrant) return stackSpellGrant;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, step.target as any, ctx);
  const directTargets = attachedTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targets = attachedTargets.length > 0 ? attachedTargets : directTargets;
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();

  if (targets.length === 0 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped static ability grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
    ? [...(state as any).staticAbilityGrantEffects]
    : [];
  const staticGrantEffect = {
    id: `${sourceId || sourceName || 'oracle'}:static-grant:${existingStaticGrantEffects.length + 1}`,
    sourceId: sourceId || undefined,
    sourceName: sourceName || undefined,
    controllerId: String(ctx.controllerId || '').trim() || undefined,
    target: step.target,
    abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
    effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
    power: step.power,
    toughness: step.toughness,
    duration: step.duration || 'static',
    raw: step.raw,
  };
  const duplicateStaticGrant = existingStaticGrantEffects.some((entry: any) =>
    String(entry?.sourceId || '').trim() === String(staticGrantEffect.sourceId || '').trim() &&
    String(entry?.raw || '').trim() === step.raw
  );

  if (targets.length === 0) {
    return {
      applied: true,
      state: {
        ...(state as any),
        staticAbilityGrantEffects: duplicateStaticGrant
          ? existingStaticGrantEffects
          : [...existingStaticGrantEffects, staticGrantEffect],
      } as GameState,
      log: [`Registered static ability grant: ${step.raw}`],
    };
  }

  const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
  const grantedAbilities = [
    ...(Array.isArray(step.abilities) ? step.abilities : []),
    ...(Array.isArray(step.effectText) ? step.effectText : []),
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!targetIds.has(permanentId)) return perm;

    const existingGranted = Array.isArray(perm.grantedAbilities) ? [...perm.grantedAbilities] : [];
    for (const ability of grantedAbilities) {
      const normalizedAbility = ability.toLowerCase();
      if (!existingGranted.some(entry => String(entry || '').trim().toLowerCase() === normalizedAbility)) {
        existingGranted.push(normalizedAbility);
      }
    }

    const existingModifiers = Array.isArray(perm.modifiers) ? [...perm.modifiers] : [];
    if (typeof step.power === 'number' || typeof step.toughness === 'number') {
      const power = step.power || 0;
      const toughness = step.toughness || 0;
      const duration = step.duration || 'static';
      const duplicateModifier = existingModifiers.some((modifier: any) =>
        String(modifier?.type || '').trim() === 'powerToughness' &&
        Number(modifier?.power || 0) === power &&
        Number(modifier?.toughness || 0) === toughness &&
        String(modifier?.sourceId || '').trim() === sourceId &&
        String(modifier?.duration || '').trim() === duration
      );
      if (!duplicateModifier) {
        existingModifiers.push({
          type: 'powerToughness',
          power,
          toughness,
          sourceId: sourceId || undefined,
          sourceName: sourceName || undefined,
          duration,
        } as any);
      }
    }

    const grantsHaste = existingGranted.some((ability) => String(ability || '').trim().toLowerCase() === 'haste');

    return {
      ...perm,
      ...(existingGranted.length > 0 ? { grantedAbilities: existingGranted } : {}),
      ...(existingModifiers.length > 0 ? { modifiers: existingModifiers } : {}),
      ...(grantsHaste ? { summoningSickness: false } : {}),
      effectivePower: undefined,
      effectiveToughness: undefined,
    } as BattlefieldPermanent;
  });

  const processedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield: nextBattlefield } as any);

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: processedBattlefield,
      staticAbilityGrantEffects: duplicateStaticGrant
        ? existingStaticGrantEffects
        : [...existingStaticGrantEffects, staticGrantEffect],
    } as GameState,
    log: [`Applied static ability grant to ${targets.length} permanent(s)`],
  };
}

