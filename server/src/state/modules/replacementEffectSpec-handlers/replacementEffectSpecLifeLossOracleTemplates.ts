// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster: Oracle life-loss replacement templates (Bloodletter family) +
//   overlaySpecsMatchLifeLoss + summarizeLifeLossAmountReplacements.
// Public entry symbols: collectOraclePatternLifeLossReplacementSpecsFromState,
//   overlaySpecsMatchLifeLoss, summarizeLifeLossAmountReplacements.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

interface OracleLifeLossReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/**
 * Bloodletter-class "would lose life … lose twice that much instead".
 * Wound Reflection is an end-step trigger and does not match these phrases.
 */
const ORACLE_LIFE_LOSS_REPLACEMENT_TEMPLATES: readonly OracleLifeLossReplacementTemplate[] = [
  {
    // mtg_data.db is_token=0 Bloodletter of Aclazotz:
    // "If an opponent would lose life during your turn, they lose twice that much life instead."
    templateId: 'opponent-life-loss-double-during-your-turn',
    oracleMustIncludeAll: [
      'if an opponent would lose life during your turn',
      'lose twice that much life',
    ],
    spec: {
      event: 'life-loss',
      match: {
        losingPlayerIsOpponentOfSource: true,
        duringSourceControllerTurn: true,
      },
      instead: { modify: 'double' },
      effectId: 'life-loss-double',
      reason: 'life_loss_double',
    },
  },
  {
    // Generic "a player" polarity of the same replacement (oracle refresh / renamed fixtures).
    templateId: 'player-life-loss-double-during-your-turn',
    oracleMustIncludeAll: [
      'if a player would lose life during your turn',
      'lose twice that much life',
    ],
    spec: {
      event: 'life-loss',
      match: { duringSourceControllerTurn: true },
      instead: { modify: 'double' },
      effectId: 'life-loss-double',
      reason: 'life_loss_double',
    },
  },
];

function readTurnPlayerId(state: unknown): string {
  if (!state || typeof state !== 'object') return '';
  const record = state as { turnPlayer?: unknown; activePlayer?: unknown };
  return String(record.turnPlayer ?? record.activePlayer ?? '').trim();
}

function readAuraEnchantedPlayerId(spec: ReplacementEffectSpec, state: unknown): string {
  const auraId = String(spec.sourcePermanentId || '').trim();
  if (!auraId || !state || typeof state !== 'object') return '';
  const battlefield = Array.isArray((state as { battlefield?: unknown }).battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  const aura = battlefield.find((perm) => {
    if (!perm || typeof perm !== 'object') return false;
    return String((perm as { id?: string }).id || '').trim() === auraId;
  }) as { attachedTo?: string; enchantedPlayerId?: string } | undefined;
  if (!aura) return '';
  return String(aura.attachedTo || aura.enchantedPlayerId || '').trim();
}

export function overlaySpecsMatchLifeLoss(
  spec: ReplacementEffectSpec,
  event: { playerId: string; state?: unknown; amount?: number },
): boolean {
  if (spec.event !== 'life-loss') return false;
  const match = spec.match;
  if (!match) return true;

  const playerId = String(event.playerId || '');
  const sourceController = String(spec.sourceController || '');

  if (match.losingPlayerIsOpponentOfSource === true
    && playerId === sourceController) {
    return false;
  }

  if (match.losingPlayerIsSourceController === true
    && playerId !== sourceController) {
    return false;
  }

  if (match.losingPlayerIsEnchantedBySource === true) {
    const enchantedId = readAuraEnchantedPlayerId(spec, event.state);
    if (!enchantedId || playerId !== enchantedId) return false;
  }

  if (match.duringSourceControllerTurn === true) {
    const turnPlayer = readTurnPlayerId(event.state);
    if (!turnPlayer || turnPlayer !== sourceController) return false;
  }

  return true;
}

export function collectOraclePatternLifeLossReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_LIFE_LOSS_REPLACEMENT_TEMPLATES) {
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

export function summarizeLifeLossAmountReplacements(
  state: unknown,
  playerId: string,
): { extraLife: number; multiplier: number; extraSources: string[]; doubleSources: string[] } {
  let extraLife = 0;
  let multiplier = 1;
  const extraSources: string[] = [];
  const doubleSources: string[] = [];

  for (const spec of collectOraclePatternLifeLossReplacementSpecsFromState(state)) {
    if (spec.event !== 'life-loss' || !spec.instead.modify) continue;
    if (!overlaySpecsMatchLifeLoss(spec, { playerId, state })) continue;
    const sourceName = String(spec.sourceName || '').trim();
    if (spec.instead.modify === 'add_flat') {
      extraLife += Math.max(0, Math.floor(Number(spec.instead.value || 0)));
      if (sourceName) extraSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'double') {
      multiplier *= 2;
      if (sourceName) doubleSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'triple') {
      multiplier *= 3;
      if (sourceName) doubleSources.push(sourceName);
    }
  }

  return { extraLife, multiplier, extraSources, doubleSources };
}
