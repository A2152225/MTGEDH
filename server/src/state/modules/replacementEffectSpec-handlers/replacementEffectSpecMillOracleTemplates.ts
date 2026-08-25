// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleMillReplacementTemplate + ORACLE_MILL_REPLACEMENT_TEMPLATES
//   + collectOraclePatternMillReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternMillReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleMillReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern mill replacements (Bruvac / Water Crystal family; no card-name routing). */
const ORACLE_MILL_REPLACEMENT_TEMPLATES: readonly OracleMillReplacementTemplate[] = [
  {
    templateId: 'opponent-mill-double',
    oracleMustIncludeAll: [
      'if an opponent would mill',
      'twice that many',
    ],
    spec: {
      event: 'mill',
      match: { millingPlayerIsSourceController: true, targetIsOpponent: true },
      instead: { modify: 'double' },
      effectId: 'opponent-mill-double',
      reason: 'opponent_mill_double',
    },
  },
  {
    templateId: 'opponent-mill-plus-four',
    oracleMustIncludeAll: [
      'if an opponent would mill',
      'that many cards plus four',
    ],
    spec: {
      event: 'mill',
      match: { millingPlayerIsSourceController: true, targetIsOpponent: true },
      instead: { modify: 'add_flat', value: 4 },
      effectId: 'opponent-mill-plus-four',
      reason: 'opponent_mill_plus_four',
    },
  },
];

export function collectOraclePatternMillReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_MILL_REPLACEMENT_TEMPLATES) {
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
