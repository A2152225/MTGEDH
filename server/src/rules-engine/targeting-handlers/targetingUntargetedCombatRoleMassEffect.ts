/**
 * Origin: server/src/rules-engine/target-availability.ts
 * Cluster: untargeted mass effects whose affected set is attacking / blocking
 *   creatures (Aetherize, Aetherspouts). These never say "target", so
 *   requiresTargeting() would otherwise treat them as always playable.
 * Public: inferUntargetedCombatRoleMassEffect,
 *   battlefieldHasUntargetedCombatRole,
 *   evaluateUntargetedCombatRoleMassEffectLegality
 */
import { matchesTriggeredCombatRole } from '../../state/modules/triggeredAbilityBattlefieldTargetMatch.js';

export type UntargetedCombatRole = 'attacking' | 'blocking' | 'attacking_or_blocking';

/**
 * Detect oracle whose affected set is all/each attacking and/or blocking creatures.
 * Targeted combat spells ("target attacking creature") stay on parseTargetRequirements.
 */
export function inferUntargetedCombatRoleMassEffect(oracleText?: string): UntargetedCombatRole | null {
  const t = String(oracleText || '').toLowerCase();
  if (!t.trim()) return null;
  if (/\btarget\b/.test(t)) return null;

  const attackingOrBlocking =
    /\b(?:all|each)\s+attacking\s+or\s+blocking\s+creatures?\b/.test(t)
    || /\bfor\s+each\s+attacking\s+or\s+blocking\s+creature\b/.test(t);
  if (attackingOrBlocking) return 'attacking_or_blocking';

  const attacking =
    /\b(?:all|each)\s+attacking\s+creatures?\b/.test(t)
    || /\bfor\s+each\s+attacking\s+creature\b/.test(t);
  const blocking =
    /\b(?:all|each)\s+blocking\s+creatures?\b/.test(t)
    || /\bfor\s+each\s+blocking\s+creature\b/.test(t);
  if (attacking && blocking) return 'attacking_or_blocking';
  if (attacking) return 'attacking';
  if (blocking) return 'blocking';
  return null;
}

export function battlefieldHasUntargetedCombatRole(state: any, role: UntargetedCombatRole): boolean {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((permanent: any) => matchesTriggeredCombatRole(permanent, role));
}

/**
 * null = oracle is not this family (caller should keep its default).
 * otherwise true/false for whether any affected combat-role permanent exists.
 */
export function evaluateUntargetedCombatRoleMassEffectLegality(
  state: any,
  oracleText: string | undefined,
  conservative: boolean,
): boolean | null {
  const role = inferUntargetedCombatRoleMassEffect(oracleText);
  if (!role) return null;
  if (!Array.isArray(state?.battlefield)) return conservative;
  return battlefieldHasUntargetedCombatRole(state, role);
}
