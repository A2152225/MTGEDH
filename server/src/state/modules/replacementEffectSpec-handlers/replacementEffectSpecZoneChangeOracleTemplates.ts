// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleZoneChangeReplacementTemplate +
//   ORACLE_ZONE_CHANGE_REPLACEMENT_TEMPLATES +
//   collectOraclePatternZoneChangeReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternZoneChangeReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleZoneChangeReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern zone-change replacements (Phase 5.2 — no card-name routing). */
const ORACLE_ZONE_CHANGE_REPLACEMENT_TEMPLATES: readonly OracleZoneChangeReplacementTemplate[] = [
  {
    templateId: 'graveyard-to-exile-from-anywhere',
    oracleMustIncludeAll: ['would be put into a graveyard from anywhere', 'exile it instead'],
    oracleMustExcludeAny: [
      'shuffle it into',
      'shuffle this card into',
      'shuffle that card into',
      'shuffles their graveyard into',
    ],
    spec: {
      event: 'zone-change',
      match: { destinationZone: 'graveyard' },
      instead: { redirectZone: 'exile' },
      effectId: 'graveyard-to-exile-replacement',
      reason: 'graveyard_to_exile_replacement',
    },
  },
  {
    templateId: 'creature-die-exile-instead',
    oracleMustIncludeAll: ['if a creature would die', 'exile it instead'],
    spec: {
      event: 'zone-change',
      match: { destinationZone: 'graveyard', objectTypeLineIncludes: 'creature' },
      instead: { redirectZone: 'exile' },
      effectId: 'creature-die-exile-instead',
      reason: 'creature_die_exile_instead',
    },
  },
];

export function collectOraclePatternZoneChangeReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || !(perm as { card?: unknown }).card) continue;
    const permRecord = perm as {
      id?: string;
      controller?: string;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card));
    if (!oracle) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    for (const template of ORACLE_ZONE_CHANGE_REPLACEMENT_TEMPLATES) {
      if (!template.oracleMustIncludeAll.every((phrase) => oracle.includes(phrase))) continue;
      if (template.oracleMustExcludeAny?.some((phrase) => oracle.includes(phrase))) continue;
      specs.push({
        ...template.spec,
        id: `${sourcePermanentId}:${template.templateId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
      });
    }
  }

  return specs;
}
