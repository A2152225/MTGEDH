// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: OracleDrawReplacementTemplate + ORACLE_DRAW_REPLACEMENT_TEMPLATES
//   + collectOraclePatternDrawReplacementSpecsFromState.
// Public entry symbols: collectOraclePatternDrawReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleDrawReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern draw replacements (no card-name routing). */
const ORACLE_DRAW_REPLACEMENT_TEMPLATES: readonly OracleDrawReplacementTemplate[] = [
  {
    templateId: 'player-draw-reveal-choice',
    oracleMustIncludeAll: ['if a player would draw a card', 'reveal', 'it instead'],
    spec: {
      event: 'card-draw',
      match: { skipWhenEventMetadataTrue: 'skipZursWeirdingReplacement' },
      instead: { choiceRequired: true },
      effectId: 'zurs-weirding-draw-replacement',
      reason: 'zurs_weirding_draw_replacement',
    },
  },
  {
    templateId: 'opponent-draw-redirect',
    oracleMustIncludeAll: ['if an opponent would draw a card', 'instead you draw a card'],
    spec: {
      event: 'card-draw',
      match: {
        drawingPlayerIsOpponentOfSource: true,
        skipWhenEventMetadataTrue: 'isFirstDrawStepDraw',
      },
      instead: { redirectDrawTo: 'source_controller' },
      effectId: 'draw-replaced-by-opponent',
      reason: 'draw_replaced_by_opponent',
    },
  },
  {
    templateId: 'opponent-multi-draw-shared',
    oracleMustIncludeAll: [
      'opponent would draw two or more cards',
      'instead you and that player each draw a card',
    ],
    spec: {
      event: 'card-draw',
      match: { drawingPlayerIsOpponentOfSource: true, minimumDrawCount: 2 },
      instead: { sharedDrawCount: 1 },
      effectId: 'draw-replaced-by-shared-draw',
      reason: 'draw_replaced_by_shared_draw',
    },
  },
  {
    templateId: 'controller-extra-draw-except-first-draw-step',
    oracleMustIncludeAll: [
      'if you would draw a card except the first one you draw in each of your draw steps',
      'draw two cards instead',
    ],
    spec: {
      event: 'card-draw',
      match: {
        drawingPlayerIsSourceController: true,
        skipWhenEventMetadataTrue: 'isFirstDrawStepDraw',
      },
      instead: { modify: 'double' },
      effectId: 'extra-draw-except-first-draw-step',
      reason: 'extra_draw_except_first_draw_step',
    },
  },
  {
    templateId: 'controller-extra-draw',
    oracleMustIncludeAll: ['if you would draw a card', 'draw two cards instead'],
    oracleMustExcludeAny: ['except the first one you draw'],
    spec: {
      event: 'card-draw',
      match: { drawingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'extra-draw',
      reason: 'extra_draw',
    },
  },
];



export function collectOraclePatternDrawReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_DRAW_REPLACEMENT_TEMPLATES) {
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
