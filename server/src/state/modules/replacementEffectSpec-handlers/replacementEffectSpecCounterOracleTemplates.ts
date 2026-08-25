// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleCounterReplacementTemplate + ORACLE_COUNTER_REPLACEMENT_TEMPLATES
//   + collectOraclePatternCounterReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternCounterReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleCounterReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern counter-placement replacements (no card-name routing). */
const ORACLE_COUNTER_REPLACEMENT_TEMPLATES: readonly OracleCounterReplacementTemplate[] = [
  {
    templateId: 'permanent-counters-double-you-control',
    oracleMustIncludeAll: [
      'counters on a permanent you control',
      'twice that many of those counters',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'permanent-counters-double',
      reason: 'permanent_counters_double',
    },
  },
  {
    templateId: 'p1p1-counters-plus-one-you-control',
    oracleMustIncludeAll: [
      '+1/+1 counters would be put',
      'that many plus one',
    ],
    spec: {
      event: 'counter-placement',
      match: {
        counterTypeIncludes: '+1/+1',
        targetControllerIsSourceController: true,
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'p1p1-counters-plus-one',
      reason: 'p1p1_counters_plus_one',
    },
  },
  {
    templateId: 'any-counters-plus-one-artifact-or-creature-you-control',
    oracleMustIncludeAll: [
      'counters would be put on an artifact or creature you control',
      'that many plus one',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: true },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'any-counters-plus-one',
      reason: 'any_counters_plus_one',
    },
  },
  {
    templateId: 'p1p1-counters-double-creature-you-control',
    oracleMustIncludeAll: [
      '+1/+1 counters would be put',
      'twice that many',
      'creature you control',
    ],
    spec: {
      event: 'counter-placement',
      match: {
        counterTypeIncludes: '+1/+1',
        targetControllerIsSourceController: true,
      },
      instead: { modify: 'double' },
      effectId: 'p1p1-counters-double',
      reason: 'p1p1_counters_double',
    },
  },
  {
    templateId: 'p1p1-counters-double-any-creature',
    oracleMustIncludeAll: [
      '+1/+1 counters would be put on a creature',
      'twice that many',
    ],
    oracleMustExcludeAny: ['you control'],
    spec: {
      event: 'counter-placement',
      match: { counterTypeIncludes: '+1/+1' },
      instead: { modify: 'double' },
      effectId: 'p1p1-counters-double-global',
      reason: 'p1p1_counters_double_global',
    },
  },
  {
    templateId: 'you-put-counters-double',
    oracleMustIncludeAll: [
      'if you would put one or more counters',
      'twice that many of each of those kinds',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'you-put-counters-double',
      reason: 'you_put_counters_double',
    },
  },
  {
    templateId: 'opponent-put-counters-halve',
    oracleMustIncludeAll: [
      'if an opponent would put one or more counters',
      'half that many of each of those kinds',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: false },
      instead: { modify: 'halve' },
      effectId: 'opponent-put-counters-halve',
      reason: 'opponent_put_counters_halve',
    },
  },
];

export function collectOraclePatternCounterReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card)).toLowerCase();
    if (!oracle) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    for (const template of ORACLE_COUNTER_REPLACEMENT_TEMPLATES) {
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
