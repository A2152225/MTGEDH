// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleLibrarySearchReplacementTemplate +
//   ORACLE_LIBRARY_SEARCH_REPLACEMENT_TEMPLATES +
//   collectOraclePatternLibrarySearchReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternLibrarySearchReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleLibrarySearchReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern library-search replacements (no card-name routing). */
const ORACLE_LIBRARY_SEARCH_REPLACEMENT_TEMPLATES: readonly OracleLibrarySearchReplacementTemplate[] = [
  {
    templateId: 'opponent-search-prevent',
    oracleMustIncludeAll: ['your opponents can\'t search'],
    spec: {
      event: 'library-search',
      match: { searchingPlayerIsOpponentOfSource: true },
      instead: { preventSearch: true },
      effectId: 'library-search-prevented',
      reason: 'opponent_search_prevented',
    },
  },
  {
    templateId: 'opponent-search-prevent-from-their-spells',
    oracleMustIncludeAll: ['can\'t cause their controller to search'],
    spec: {
      event: 'library-search',
      match: { searchingPlayerIsOpponentOfSource: true },
      instead: { preventSearch: true },
      effectId: 'library-search-prevented',
      reason: 'opponent_search_prevented',
    },
  },
  {
    templateId: 'players-cant-search-payment',
    oracleMustIncludeAll: ['players can\'t search libraries', 'may pay'],
    spec: {
      event: 'library-search',
      instead: { paymentToIgnore: '{2}' },
      effectId: 'library-search-payment-required',
      reason: 'library_search_payment_required',
    },
  },
  {
    templateId: 'players-cant-search',
    oracleMustIncludeAll: ['players can\'t search libraries'],
    oracleMustExcludeAny: ['may pay'],
    spec: {
      event: 'library-search',
      instead: { preventSearch: true },
      effectId: 'library-search-prevented',
      reason: 'players_cant_search',
    },
  },
  {
    templateId: 'opponent-search-limit-top-four',
    oracleMustIncludeAll: [
      'if an opponent would search a library',
      'top four cards',
    ],
    spec: {
      event: 'library-search',
      match: { searchingPlayerIsOpponentOfSource: true },
      instead: { limitToTop: 4 },
      effectId: 'library-search-limited',
      reason: 'opponent_search_limit_top',
    },
  },
  {
    templateId: 'opponent-search-control',
    oracleMustIncludeAll: ['you control your opponents while they\'re searching their libraries'],
    spec: {
      event: 'library-search',
      match: { searchingPlayerIsOpponentOfSource: true },
      instead: { controlSearch: true },
      effectId: 'library-search-controlled',
      reason: 'opponent_search_controlled',
    },
  },
  {
    templateId: 'opponent-search-trigger-sacrifice-life',
    oracleMustIncludeAll: [
      'whenever an opponent searches their library',
      'sacrifices a creature',
      'loses 10 life',
    ],
    spec: {
      event: 'library-search',
      match: { searchingPlayerIsOpponentOfSource: true },
      instead: { triggerEffect: 'Sacrifice a creature and lose 10 life' },
      effectId: 'library-search-triggered',
      reason: 'opponent_search_trigger',
    },
  },
];

export function collectOraclePatternLibrarySearchReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_LIBRARY_SEARCH_REPLACEMENT_TEMPLATES) {
      if (!template.oracleMustIncludeAll.every((phrase) => oracle.includes(phrase))) continue;
      if (template.oracleMustExcludeAny?.some((phrase) => oracle.includes(phrase))) continue;
      const paymentMatch = oracle.match(/may pay \{(\d+)\}/);
      const instead = template.spec.instead.paymentToIgnore && paymentMatch
        ? { ...template.spec.instead, paymentToIgnore: `{${paymentMatch[1]}}` }
        : template.spec.instead;
      specs.push({
        ...template.spec,
        instead,
        id: `${sourcePermanentId}:${template.templateId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
      });
    }
  }

  return specs;
}
