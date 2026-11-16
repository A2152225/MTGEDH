// server/src/state/modules/replacementBatch96DamageReplacements.ts
// B96: "Double all damage equipped creature would deal." (Mjölnir)
// and "If damage would be dealt to ~, instead that damage is dealt, but all
// other damage already dealt to him is healed." (Wolverine).
// Public: collectBatch96DamageReplacementSpecs, collectBatch96DamageReplacementSpecsFromState,
// applyBatch96DamageSideEffects, applyWolverineMarkedDamageHeal.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import type { GameContext } from './context.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const MJOLNIR_RE = /double all damage equipped creature would deal/i;
const WOLVERINE_RE = /if damage would be dealt to (?:this creature|~|[^\n]+), instead that damage is dealt, but all other damage already dealt to (?:him|her|them|it) is healed/i;

export function parseBatch96DamageReplacementKind(oracle: string): string[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const kinds: string[] = [];
  if (MJOLNIR_RE.test(text)) kinds.push('equipped-creature-double-damage');
  if (WOLVERINE_RE.test(text)) kinds.push('damage-dealt-heal-other-marked');
  return kinds;
}

export function collectBatch96DamageReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch96DamageReplacementKind(oracle).map((kind) => {
    if (kind === 'equipped-creature-double-damage') {
      return {
        id: `${source.sourcePermanentId}:equipped-creature-double-damage`,
        event: 'damage' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { damageSourceIsEquippedBySource: true } as any,
        instead: { modify: 'double' as const },
        effectId: 'equipped-creature-double-damage',
        reason: 'equipped_creature_double_damage',
      } as ReplacementEffectSpec;
    }
    return {
      id: `${source.sourcePermanentId}:damage-dealt-heal-other-marked`,
      event: 'damage' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { damageTargetIsSource: true } as any,
      instead: { modify: 'add_flat' as const, amount: 0, sideEffect: 'heal_other_marked_damage' },
      effectId: 'damage-dealt-heal-other-marked',
      reason: 'damage_dealt_heal_other_marked',
    } as ReplacementEffectSpec;
  });
}

export function collectBatch96DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch96DamageReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

/** Clear previously marked damage; the incoming damage is still dealt. */
export function applyWolverineMarkedDamageHeal(permanent: any): void {
  if (!permanent || typeof permanent !== 'object') return;
  permanent.damage = 0;
  permanent.markedDamage = 0;
  permanent.damageMarkedThisTurn = 0;
}

function findEquippedBy(state: any, equipmentId: string): any | undefined {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const eq = battlefield.find((p: any) => String(p?.id || '') === String(equipmentId || ''));
  const attachedTo = String(eq?.attachedTo || eq?.equippedCreatureId || eq?.attachedToId || '');
  if (!attachedTo) return undefined;
  return battlefield.find((p: any) => String(p?.id || '') === attachedTo);
}

export function applyBatch96DamageSideEffects(
  ctx: GameContext,
  damageAmount: number,
  _damageDealer: string,
  _damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  _isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state: any = (ctx as any)?.state || ctx;
  const specs = collectBatch96DamageReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const source = battlefield.find((p: any) => String(p?.id || '') === String(damageSourcePermanentId || ''));
  const target = battlefield.find((p: any) => String(p?.id || '') === String(targetPermanentId || ''))
    || (eventTargetFromSpecs(battlefield, specs, targetPermanentId));
  let amount = Math.max(0, Math.floor(Number(damageAmount) || 0));
  const modifiers: string[] = [];

  for (const spec of specs) {
    if (spec.effectId === 'equipped-creature-double-damage') {
      const equipped = findEquippedBy(state, String(spec.sourcePermanentId));
      if (!equipped || String(equipped.id) !== String(source?.id || '')) continue;
      amount *= 2;
      modifiers.push(`${spec.sourceName}: double damage`);
    }
    if (spec.effectId === 'damage-dealt-heal-other-marked') {
      if (!target || String(target.id) !== String(spec.sourcePermanentId)) continue;
      applyWolverineMarkedDamageHeal(target);
      modifiers.push(`${spec.sourceName}: heal other marked damage`);
    }
  }

  if (!modifiers.length) return null;
  return { amount, modifiers };
}

function eventTargetFromSpecs(battlefield: any[], _specs: ReplacementEffectSpec[], targetPermanentId?: string): any | undefined {
  if (!targetPermanentId) return undefined;
  return battlefield.find((p: any) => String(p?.id || '') === String(targetPermanentId));
}
