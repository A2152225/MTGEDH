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
    templateId: 'player-draw-exile-opponent-library-face-down',
    oracleMustIncludeAll: [
      'if a player would draw a card',
      'exiles the top card of one of their opponents',
      'libraries face down instead',
    ],
    spec: {
      event: 'card-draw',
      instead: { choiceRequired: true },
      effectId: 'draw-replaced-by-exile-opponent-library',
      reason: 'draw_replaced_by_exile_opponent_library',
    },
  },
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
  {
    templateId: 'controller-skip-draw-step-optional',
    oracleMustIncludeAll: [
      'if you would draw a card during your draw step',
      'instead you may skip that draw',
      'if you do',
      "you can't be attacked except by creatures with",
    ],
    spec: {
      event: 'card-draw',
      match: {
        drawingPlayerIsSourceController: true,
        requireEventMetadataTrue: 'isDrawStepDraw',
        skipWhenEventMetadataTrue: 'skipSkipDrawReplacement',
        exactDrawCount: 1,
      },
      instead: { choiceRequired: true },
      effectId: 'skip-draw-step-replacement',
      reason: 'skip_draw_step_replacement',
    },
  },
];



function extractSkipDrawExceptKeywords(oracle: string): string[] {
  const match = String(oracle || '').match(
    /can(?:not|'t|’t)\s+be\s+attacked\s+except\s+by\s+creatures\s+with\s+(.+?)(?:\.|$)/i,
  );
  if (!match) return [];
  return String(match[1] || '')
    .replace(/\.+$/, '')
    .split(/\s*(?:,\s*(?:and\/or|and|or)\s+|and\/or|\s+or\s+|\s+and\s+|,\s+)\s*/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[a-z][a-z\s]*$/.test(part));
}

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
      const extraMetadata: Record<string, unknown> = {};
      if (template.templateId === 'controller-skip-draw-step-optional') {
        const exceptKeywords = extractSkipDrawExceptKeywords(oracle);
        if (exceptKeywords.length === 0) continue;
        extraMetadata.exceptKeywords = exceptKeywords;
        extraMetadata.sourcePermanentId = sourcePermanentId;
      }
      if (template.templateId === 'player-draw-exile-opponent-library-face-down') {
        extraMetadata.sourcePermanentId = sourcePermanentId;
      }
      specs.push({
        ...template.spec,
        id: `${sourcePermanentId}:${template.templateId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
        metadata: {
          ...(template.spec.metadata || {}),
          ...extraMetadata,
        },
      });
    }
  }

  return specs;
}
