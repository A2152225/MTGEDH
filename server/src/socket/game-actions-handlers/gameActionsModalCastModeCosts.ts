/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: cost and oracle text for the modes a player picked - modal
 * mode scoping, entwine, escalate, additional-cost modes, overload rewriting,
 * and the small mana-cost string arithmetic those need.
 *
 * Public entry symbols: getSpellModeAdditionalCost, getOracleTextForCastMode,
 * adjustModalSpellInfoForCurrentCast, getEntwineCostForSelectedModes,
 * appendManaCost, repeatManaCost.
 */
import {
  extractAdditionalCostModesFromOracleText,
  getSelectedAdditionalCostOracleText,
} from "../../state/modules/additionalCostModeOracleText.js";
import { extractModalModesForSpellCast, matchModalModeOptions } from "../../utils/oraclePromptContext.js";

function getSelectedModalOracleText(oracleText: string, selectedModes?: unknown, spellName = ''): string {
  const selectedModeIds = Array.isArray(selectedModes)
    ? selectedModes.map((mode: unknown) => String(mode || '')).filter(Boolean)
    : [];

  if (selectedModeIds.length === 0) return oracleText;

  const modalInfo = extractModalModesForSpellCast(oracleText, spellName);
  if (!modalInfo) return oracleText;

  const selectedOptions = matchModalModeOptions(modalInfo, selectedModeIds);
  if (selectedOptions.length === 0) return oracleText;

  return selectedOptions.map((option) => option.raw).join('\n');
}

function playerControlsCommanderForModalCast(state: any, playerId: string): boolean {
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) return false;

  const commandZone = state?.commandZone?.[normalizedPlayerId];
  const commanderIds = new Set<string>([
    ...(Array.isArray(commandZone?.commanderIds) ? commandZone.commanderIds : []),
    ...(Array.isArray(commandZone?.inCommandZone) ? commandZone.inCommandZone : []),
  ].map((id: unknown) => String(id || '').trim()).filter(Boolean));

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((permanent: any) => {
    if (String(permanent?.controller || '') !== normalizedPlayerId) {
      return false;
    }

    if ((permanent as any)?.isCommander === true || (permanent?.card as any)?.isCommander === true) {
      return true;
    }

    const cardId = String(permanent?.card?.id || '').trim();
    return cardId.length > 0 && commanderIds.has(cardId);
  });
}

export function adjustModalSpellInfoForCurrentCast(
  modalSpellInfo: ReturnType<typeof extractModalModesForSpellCast>,
  state: any,
  playerId: string,
  oracleText: string,
): ReturnType<typeof extractModalModesForSpellCast> {
  if (!modalSpellInfo) return modalSpellInfo;

  const normalizedOracleText = String(oracleText || '').replace(/[�]/g, "'");
  if (!/\bif you control a commander as you cast this spell, you may choose both instead\b/i.test(normalizedOracleText)) {
    return modalSpellInfo;
  }

  if (!playerControlsCommanderForModalCast(state, playerId)) {
    return modalSpellInfo;
  }

  return {
    ...modalSpellInfo,
    maxModes: Math.min(2, modalSpellInfo.options.length),
  };
}

export function getEntwineCostForSelectedModes(oracleText: string, selectedModes?: unknown, spellName = ''): string | undefined {
  const selectedModeIds = Array.isArray(selectedModes)
    ? selectedModes.map((mode: unknown) => String(mode || '')).filter(Boolean)
    : [];

  if (selectedModeIds.length === 0) return undefined;

  const modalInfo = extractModalModesForSpellCast(oracleText, spellName);
  if (!modalInfo?.entwineCost) return undefined;

  const matchedOptions = matchModalModeOptions(modalInfo, selectedModeIds);
  if (matchedOptions.length !== modalInfo.options.length) return undefined;

  return modalInfo.entwineCost;
}

export function repeatManaCost(cost: string, count: number): string {
  if (!cost || count <= 0) return '';
  return Array.from({ length: count }, () => String(cost).trim()).join('');
}

function getEscalateAdditionalCost(oracleText: string, selectedModes?: unknown): string | undefined {
  const selectedModeIds = Array.isArray(selectedModes)
    ? selectedModes.map((mode: unknown) => String(mode || '')).filter(Boolean)
    : [];

  if (selectedModeIds.length <= 1) return undefined;

  const escalateMatch = String(oracleText || '').match(/\bEscalate\s*[�\-]?\s*((?:\{[^}]+\}\s*)+)\s*(?:\(|$)/i);
  if (!escalateMatch) return undefined;

  const perModeCost = String(escalateMatch[1] || '').replace(/\s+/g, '').trim();
  if (!perModeCost) return undefined;

  return repeatManaCost(perModeCost, selectedModeIds.length - 1);
}

function getAdditionalCostModeCost(oracleText: string, selectedAdditionalCostModes?: unknown): string | undefined {
  const selectedModeIds = Array.isArray(selectedAdditionalCostModes)
    ? selectedAdditionalCostModes.map((mode: unknown) => String(mode || '')).filter(Boolean)
    : [];

  if (selectedModeIds.length === 0) return undefined;

  const additionalCostModeInfo = extractAdditionalCostModesFromOracleText(oracleText);
  if (!additionalCostModeInfo) return undefined;

  const selectedSet = new Set(selectedModeIds);
  const extraCost = additionalCostModeInfo.options
    .filter((mode) => selectedSet.has(mode.id))
    .map((mode) => mode.cost)
    .filter(Boolean)
    .join('');

  return extraCost || undefined;
}

export function getSpellModeAdditionalCost(
  oracleText: string,
  selectedModes?: unknown,
  selectedAdditionalCostModes?: unknown,
): string {
  const effectiveAdditionalCostModes = Array.isArray(selectedAdditionalCostModes) && selectedAdditionalCostModes.length > 0
    ? selectedAdditionalCostModes
    : selectedModes;

  return appendManaCost(
    getEntwineCostForSelectedModes(oracleText, selectedModes),
    getEscalateAdditionalCost(oracleText, selectedModes),
    getAdditionalCostModeCost(oracleText, effectiveAdditionalCostModes),
  );
}

export function appendManaCost(baseCost: string, ...extraCosts: Array<string | undefined>): string {
  const parts = [String(baseCost || '').trim(), ...extraCosts.map((cost) => String(cost || '').trim())]
    .filter(Boolean);
  return parts.join('');
}

export function getOracleTextForCastMode(
  oracleText: string,
  castWithOverload: boolean,
  selectedModes?: unknown,
  selectedAdditionalCostModes?: unknown,
  spellName = '',
): string {
  const effectiveAdditionalCostModes = Array.isArray(selectedAdditionalCostModes) && selectedAdditionalCostModes.length > 0
    ? selectedAdditionalCostModes
    : selectedModes;
  const additionalCostScopedText = getSelectedAdditionalCostOracleText(oracleText, effectiveAdditionalCostModes);
  const modeScopedText = additionalCostScopedText === oracleText
    ? getSelectedModalOracleText(oracleText, selectedModes, spellName)
    : additionalCostScopedText;
  if (!castWithOverload) return modeScopedText;

  const normalized = String(modeScopedText || '').replace(/\u2019/g, "'");
  const withoutOverloadClause = normalized.replace(/\s*overload\s*(?:\{[^}]+\}\s*)+\.?/i, '').trim();
  return withoutOverloadClause.replace(/\btarget\b/gi, 'each');
}
