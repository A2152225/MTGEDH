// server/src/state/modules/can-respond-handlers/canRespondHandCastEvaluation.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: adventure/DFC/split face evaluation plus any-type mana
// spending cost normalization used by getCastableSpellCandidates.
// Public entry symbols: getHandCastEvaluationCards,
// normalizeParsedCostForAnyTypeManaSpending.

import { parseManaCost } from '../mana-check.js';
import { isLandTypeLine } from './canRespondSplitSecondLandPredicates.js';
import { isTransformBackFace } from './canRespondTransformBackFace.js';

function buildCastEvaluationFace(card: any, face: any, faceIndex: number, extras?: Record<string, unknown>): any {
  const manaCost = face?.mana_cost ?? face?.manaCost ?? card?.mana_cost ?? card?.manaCost;
  return {
    ...card,
    ...(face || {}),
    name: face?.name || card?.name,
    type_line: face?.type_line || face?.typeLine || card?.type_line,
    oracle_text: face?.oracle_text || face?.oracleText || card?.oracle_text,
    mana_cost: manaCost,
    manaCost,
    colors: Array.isArray(face?.colors) ? face.colors : card?.colors,
    image_uris: face?.image_uris || card?.image_uris,
    faceIndex,
    ...(extras || {}),
  };
}

export function normalizeParsedCostForAnyTypeManaSpending(parsedCost: ReturnType<typeof parseManaCost>): ReturnType<typeof parseManaCost> {
  const colorCostTotal = Object.values(parsedCost.colors || {}).reduce(
    (sum, value) => sum + Math.max(0, Number(value || 0)),
    0,
  );
  const hybrid = Array.isArray(parsedCost.hybrid)
    ? parsedCost.hybrid.map((options) => {
        const normalizedOptions = Array.isArray(options)
          ? options.map((option) => String(option || '').trim().toUpperCase()).filter(Boolean)
          : [];
        const lifeOptions = normalizedOptions.filter((option) => /^LIFE:\d+$/.test(option));
        const genericOptions = normalizedOptions
          .filter((option) => /^GENERIC:\d+$/.test(option))
          .map((option) => Number(option.slice('GENERIC:'.length)))
          .filter((value) => Number.isFinite(value) && value > 0);
        const hasManaTypeOption = normalizedOptions.some((option) => /^[WUBRGC]$/.test(option));

        if (hasManaTypeOption) {
          return ['GENERIC:1', ...lifeOptions];
        }

        if (genericOptions.length > 0) {
          return [`GENERIC:${Math.min(...genericOptions)}`, ...lifeOptions];
        }

        return lifeOptions;
      })
    : [];

  return {
    ...parsedCost,
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: Math.max(0, Number(parsedCost.generic || 0)) + colorCostTotal,
    hybrid,
    hybrids: hybrid,
  };
}

export function getHandCastEvaluationCards(card: any): any[] {
  if (!card || typeof card === 'string') return [];
  if (isTransformBackFace(card)) return [];

  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if ((layout === 'transform' || layout === 'double_faced_token') && cardFaces.length >= 1) {
    return [buildCastEvaluationFace(card, cardFaces[0], 0)];
  }

  if (layout === 'adventure' && cardFaces.length >= 2) {
    return [
      buildCastEvaluationFace(card, cardFaces[0], 0, { castAsAdventure: false }),
      buildCastEvaluationFace(card, cardFaces[1], 1, { castAsAdventure: true }),
    ];
  }

  if (layout === 'modal_dfc' && cardFaces.length >= 1) {
    return cardFaces
      .map((face: any, index: number) => ({ face, index }))
      .filter(({ face }) => !isLandTypeLine(face?.type_line || face?.typeLine))
      .map(({ face, index }) => buildCastEvaluationFace(card, face, index));
  }

  if (layout === 'split' && cardFaces.length >= 2) {
    return cardFaces.map((face: any, index: number) => buildCastEvaluationFace(card, face, index));
  }

  return [card];
}
