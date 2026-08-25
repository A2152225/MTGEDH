// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleLifeGainReplacementTemplate + ORACLE_LIFE_GAIN_REPLACEMENT_TEMPLATES
//   + collectOraclePatternLifeGainReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternLifeGainReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleLifeGainReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern life-gain replacements (no card-name routing). */
const ORACLE_LIFE_GAIN_REPLACEMENT_TEMPLATES: readonly OracleLifeGainReplacementTemplate[] = [
  {
    templateId: 'opponent-life-gain-reversed-to-loss',
    oracleMustIncludeAll: ['if an opponent would gain life', 'loses that much life instead'],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsOpponentOfSource: true },
      instead: { replaceLifeGainWith: 'loss' },
      effectId: 'life-gain-reversed-to-loss',
      reason: 'life_gain_reversed_to_loss',
    },
  },
  {
    templateId: 'controller-life-gain-reversed-to-loss',
    oracleMustIncludeAll: ['would cause its controller to gain life', 'loses that much life instead'],
    spec: {
      event: 'life-gain',
      instead: { replaceLifeGainWith: 'loss' },
      effectId: 'life-gain-reversed-to-loss',
      reason: 'life_gain_reversed_to_loss',
    },
  },
  {
    templateId: 'opponents-cant-gain-life',
    oracleMustIncludeAll: ['your opponents', "can't gain life"],
    oracleMustExcludeAny: ["can't gain life this turn", "can't gain life until end of turn"],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsOpponentOfSource: true },
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
  {
    // Quest Compleated Beast family — singular opponent, not "your opponents".
    templateId: 'opponent-singular-cant-gain-life',
    oracleMustIncludeAll: ["your opponent can't gain life"],
    oracleMustExcludeAny: ["can't gain life this turn", "can't gain life until end of turn"],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsOpponentOfSource: true },
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
  {
    // Grievous Wound family — Enchant player aura.
    templateId: 'enchanted-player-cant-gain-life',
    oracleMustIncludeAll: ["enchanted player can't gain life"],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsEnchantedBySource: true },
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
  {
    templateId: 'players-cant-gain-life',
    oracleMustIncludeAll: ["players can't gain life"],
    oracleMustExcludeAny: ["can't gain life this turn", "can't gain life until end of turn"],
    spec: {
      event: 'life-gain',
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
  {
    // Sulfuric Vortex current oracle (not the older "Players can't gain life" wording).
    templateId: 'player-would-gain-life-gains-none',
    oracleMustIncludeAll: ['if a player would gain life', 'gains no life instead'],
    spec: {
      event: 'life-gain',
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
  {
    templateId: 'controller-life-total-cant-change',
    oracleMustIncludeAll: ["your life total can't change"],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsSourceController: true },
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_total_cant_change',
    },
  },
  {
    templateId: 'controller-life-gain-double',
    oracleMustIncludeAll: ['if you would gain life', 'twice that much life'],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'life-gain-double',
      reason: 'life_gain_double',
    },
  },
  {
    templateId: 'controller-life-gain-plus-1-if-25-life',
    oracleMustIncludeAll: ['if you would gain life', '25 or more life', 'that much life plus 1'],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsSourceController: true, gainingPlayerLifeGte: 25 },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'life-gain-plus-one',
      reason: 'life_gain_plus_one_if_25_life',
    },
  },
  {
    templateId: 'controller-life-gain-plus-1',
    oracleMustIncludeAll: ['if you would gain life', 'that much life plus 1'],
    oracleMustExcludeAny: ['25 or more life'],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsSourceController: true },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'life-gain-plus-one',
      reason: 'life_gain_plus_one',
    },
  },
];

export function collectOraclePatternLifeGainReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    if (/^A-/i.test(sourceName)) continue;

    for (const template of ORACLE_LIFE_GAIN_REPLACEMENT_TEMPLATES) {
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
