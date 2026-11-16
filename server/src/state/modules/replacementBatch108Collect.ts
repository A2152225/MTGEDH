// server/src/state/modules/replacementBatch108Collect.ts
// B108 replacement collect: die-to-library (Gravebane / Nissa's Chosen) and
// creature-combat-damage prevent-and-counter (Ironscale Hydra).
// Hooked from zone-change and damage-prevention oracle templates — not from
// replacementEffectSpec.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseCreatureCombatDamageToThisPreventAndPlusCounter,
  parseIfThisWouldDiePutOnLibrary,
} from './batch108Parsers.js';

function asSpec(spec: object): ReplacementEffectSpec {
  return spec as unknown as ReplacementEffectSpec;
}

function battlefieldOf(state: unknown): any[] {
  return Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? ((state as { battlefield: unknown[] }).battlefield as any[])
    : [];
}

export function collectBatch108ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const base = {
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
  const libraryPos = parseIfThisWouldDiePutOnLibrary(text);
  if (libraryPos) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:die-to-library-${libraryPos}`,
      event: 'zone-change',
      match: { objectIsSource: true, fromZone: 'battlefield', toZone: 'graveyard' },
      instead: { redirectZone: 'library', libraryPosition: libraryPos },
      effectId: `die-to-library-${libraryPos}`,
      reason: `die_to_library_${libraryPos}`,
      metadata: { libraryPosition: libraryPos },
    }));
  }
  if (parseCreatureCombatDamageToThisPreventAndPlusCounter(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:creature-combat-damage-prevent-plus-counter`,
      event: 'damage',
      match: { combatDamageOnly: true, damageSourceIsCreature: true, receivingPermanentIsSource: true },
      instead: { prevent: true, addCounters: { '+1/+1': 1 } },
      effectId: 'creature-combat-damage-prevent-plus-counter',
      reason: 'creature_combat_damage_prevent_plus_counter',
      metadata: { addPlusOnePlusOne: 1 },
    }));
  }
  return specs;
}

export function collectBatch108ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  for (const perm of battlefieldOf(state)) {
    if (!perm || typeof perm !== 'object' || !perm.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    if (!sourcePermanentId) continue;
    const oracle = readCardOracleText(perm.card) || String(perm.oracle_text || '');
    if (!oracle) continue;
    specs.push(...collectBatch108ReplacementSpecs(oracle, {
      sourcePermanentId,
      sourceController: String(perm.controller || '').trim(),
      sourceName: String(perm.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function collectBatch108ZoneChangeReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return collectBatch108ReplacementSpecsFromState(state).filter((spec) => spec.event === 'zone-change');
}

export function collectBatch108DamagePreventionSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return collectBatch108ReplacementSpecsFromState(state).filter((spec) => spec.event === 'damage');
}
