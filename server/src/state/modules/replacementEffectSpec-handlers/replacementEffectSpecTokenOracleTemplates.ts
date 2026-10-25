// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleTokenReplacementTemplate + ORACLE_TOKEN_REPLACEMENT_TEMPLATES
//   + collectOraclePatternTokenReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternTokenReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleTokenReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern token-creation replacements (no card-name routing). */
const ORACLE_TOKEN_REPLACEMENT_TEMPLATES: readonly OracleTokenReplacementTemplate[] = [
  {
    templateId: 'controller-creature-token-triple',
    oracleMustIncludeAll: [
      'creature tokens would be created under your control',
      'three times that many',
    ],
    spec: {
      event: 'token-creation',
      match: { creatingPlayerIsSourceController: true, tokenIsCreature: true },
      instead: { modify: 'triple' },
      effectId: 'controller-creature-token-triple',
      reason: 'controller_creature_token_triple',
    },
  },
  {
    templateId: 'controller-token-double-would-be-created',
    oracleMustIncludeAll: [
      'tokens would be created under your control',
      'twice that many',
    ],
    oracleMustExcludeAny: ['three times'],
    spec: {
      event: 'token-creation',
      match: { creatingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'controller-token-double',
      reason: 'controller_token_double',
    },
  },
  {
    templateId: 'controller-token-double-create-one-or-more',
    oracleMustIncludeAll: [
      'create one or more tokens under your control',
      'twice that many',
    ],
    oracleMustExcludeAny: ['three times'],
    spec: {
      event: 'token-creation',
      match: { creatingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'controller-token-double',
      reason: 'controller_token_double',
    },
  },
  {
    // Batch 16: Xorn / Jolene, the Plunder Queen
    templateId: 'controller-extra-treasure',
    oracleMustIncludeAll: ['if you would create one or more treasure tokens', 'plus an additional treasure token'],
    spec: {
      event: 'token-creation',
      match: { creatingPlayerIsSourceController: true },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'controller-extra-treasure',
      reason: 'controller_extra_treasure',
      metadata: { tokenNameIs: 'treasure' },
    },
  },
  {
    templateId: 'global-token-double',
    oracleMustIncludeAll: ['tokens would be created', 'twice that many'],
    oracleMustExcludeAny: ['under your control', 'three times'],
    spec: {
      event: 'token-creation',
      instead: { modify: 'double' },
      effectId: 'global-token-double',
      reason: 'global_token_double',
    },
  },
];

export function collectOraclePatternTokenReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_TOKEN_REPLACEMENT_TEMPLATES) {
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
