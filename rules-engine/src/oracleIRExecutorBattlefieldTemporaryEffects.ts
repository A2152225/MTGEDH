// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyTemporaryEffectToPermanents.
// Public entry: applyTemporaryEffectToPermanents.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export function applyTemporaryEffectToPermanents(
  state: GameState,
  targets: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext,
  effect: {
    readonly descriptions: readonly string[];
    readonly grantedAbilities?: readonly string[];
    readonly expiresAt: 'end_of_turn' | 'next_upkeep' | 'leaves_battlefield';
    readonly expiresOnControllerTurn?: PlayerID;
    readonly mustBlockAttackerId?: string;
  }
): GameState {
  const targetIdSet = new Set(targets.map(target => String((target as any)?.id || '').trim()).filter(Boolean));
  if (targetIdSet.size === 0) return state;

  const normalizedGrantedAbilities = Array.isArray(effect.grantedAbilities)
    ? effect.grantedAbilities.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];

  const nextBattlefield = ((state.battlefield || []) as BattlefieldPermanent[]).map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIdSet.has(permanentId)) return perm;

    const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
      ? [...(perm as any).temporaryEffects]
      : [];
    const existingGrantedAbilities = Array.isArray((perm as any)?.grantedAbilities)
      ? [...(perm as any).grantedAbilities]
      : [];

    for (const description of effect.descriptions) {
      existingEffects.push({
        id: `${permanentId}:temp:${existingEffects.length + 1}:${description.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        description,
        expiresAt: effect.expiresAt,
        ...(effect.expiresOnControllerTurn ? { expiresOnControllerTurn: effect.expiresOnControllerTurn } : {}),
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceName: String(ctx.sourceName || '').trim() || undefined,
        ...(effect.mustBlockAttackerId ? { mustBlockAttackerId: effect.mustBlockAttackerId } : {}),
        ...(normalizedGrantedAbilities.length > 0 ? { grantedAbilities: normalizedGrantedAbilities } : {}),
      } as any);
    }

    for (const ability of normalizedGrantedAbilities) {
      if (!existingGrantedAbilities.includes(ability)) {
        existingGrantedAbilities.push(ability);
      }
    }

    const grantsHaste =
      normalizedGrantedAbilities.includes('haste')
      || effect.descriptions.some((description) => /\bhaste\b/i.test(String(description || '')));

    let untilEndOfTurn = (perm as any).untilEndOfTurn
      ? { ...(perm as any).untilEndOfTurn }
      : undefined;
    if (effect.expiresAt === 'end_of_turn' && normalizedGrantedAbilities.length > 0) {
      const grantedAbilitiesToRemove = Array.isArray(untilEndOfTurn?.grantedAbilitiesToRemove)
        ? [...untilEndOfTurn.grantedAbilitiesToRemove]
        : [];
      for (const ability of normalizedGrantedAbilities) {
        const canonical = ability.charAt(0).toUpperCase() + ability.slice(1);
        if (!grantedAbilitiesToRemove.some((entry: unknown) => String(entry || '').toLowerCase() === ability)) {
          grantedAbilitiesToRemove.push(canonical);
        }
      }
      untilEndOfTurn = { ...(untilEndOfTurn || {}), grantedAbilitiesToRemove };
    }

    const justChangedController = Array.isArray((state as any)?.controlChangeEffects)
      && (state as any).controlChangeEffects.some(
        (entry: any) => String(entry?.permanentId || '').trim() === permanentId,
      );

    return {
      ...perm,
      ...(existingEffects.length > 0 ? { temporaryEffects: existingEffects } : {}),
      ...(existingGrantedAbilities.length > 0 ? { grantedAbilities: existingGrantedAbilities } : {}),
      ...(untilEndOfTurn ? { untilEndOfTurn } : {}),
      // Control-change already stamped summoning sickness; haste lets them attack
      // despite that flag (combat checks haste). Clearing it here would disagree
      // with Act of Treason / Reins of Power server semantics.
      ...(grantsHaste && !justChangedController ? { summoningSickness: false } : {}),
    } as any;
  });

  return { ...(state as any), battlefield: nextBattlefield } as GameState;
}

