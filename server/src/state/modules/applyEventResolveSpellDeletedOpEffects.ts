/**
 * Extracted from applyEvent.ts resolveSpell case.
 * Cluster: deleted categorize resolve opcodes still arrive on applyEvent/replay
 * with a spec + chosen targets. resolveSpell() now always returns [].
 * Public entry: effectsFromDeletedResolveSpellSpec
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { EngineEffect, TargetRef } from '../../rules-engine/targeting.js';
import { isCategorizeOpcodeDeletedFromResolveSpell } from './oracleIrSpellLegacyRouting.js';

const DELETED_DAMAGE_OPS = new Set([
  'DAMAGE_TARGET',
  'DAMAGE_TARGET_PLAYER',
  'ANY_TARGET_DAMAGE',
  'DAMAGE_EACH',
  'DAMAGE_EACH_OPPONENT',
  'DAMAGE_EACH_PLAYER',
]);

function damageAmountFromSpec(spec: any): number {
  return Math.max(0, Number(spec?.amount ?? 0));
}

function effectsForChosenDamageTargets(
  chosen: readonly TargetRef[],
  amount: number,
): EngineEffect[] {
  if (amount <= 0) return [];
  const effects: EngineEffect[] = [];
  for (const target of chosen || []) {
    const kind = String((target as any)?.kind || '');
    const id = String((target as any)?.id || '');
    if (!id) continue;
    if (kind === 'player') {
      effects.push({ kind: 'DamagePlayer', playerId: id as PlayerID, amount });
    } else if (kind === 'permanent') {
      effects.push({ kind: 'DamagePermanent', id, amount });
    }
  }
  return effects;
}

/**
 * Rebuild EngineEffects for categorize ops deleted from resolveSpell.
 * applyEvent's existing DamagePlayer switch applies Mindskinner-style replacements.
 */
export function effectsFromDeletedResolveSpellSpec(
  spec: any,
  chosen: readonly TargetRef[],
  _state: any,
  _caster: PlayerID,
): EngineEffect[] {
  const op = String(spec?.op || '');
  if (!op || !isCategorizeOpcodeDeletedFromResolveSpell(op)) {
    return [];
  }
  if (!DELETED_DAMAGE_OPS.has(op)) {
    return [];
  }
  return effectsForChosenDamageTargets(chosen || [], damageAmountFromSpec(spec));
}
