/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: scoreModeOption, chooseAbundantHarvestMode, chooseOverloadMode,
 * chooseAIModeSelectionsForStep, chooseAIKynaiosChoiceSelection.
 *
 * Public entry symbols: chooseAIModeSelectionsForStep, chooseAIKynaiosChoiceSelection.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { choosePBudgetModeSelections } from "../../../../shared/src/modeSelectionPBudget.js";
import { canPlayLand } from "../../state/modules/can-respond.js";
import { getAvailableMana, parseManaCost, canPayManaCostWithAvailableSources } from "../../state/modules/mana-check.js";
import { getAIBattlefield, getAIHand, getAIPlayerLife } from "./aiDeckProfileHandlers.js";

function scoreModeOption(game: any, playerId: PlayerID, step: any, mode: any): number {
  const text = `${String(mode?.label || '')} ${String(mode?.description || '')}`.toLowerCase();
  let score = 0;

  if (/(destroy|exile|counter|return .*hand|bounce)/i.test(text)) score += 14;
  if (/(draw|search your library|tutor)/i.test(text)) score += 12;
  if (/(create .*token|treasure|clue|food)/i.test(text)) score += 8;
  if (/(untap|add mana)/i.test(text)) score += 7;
  if (/(damage each opponent|each opponent loses|deal .*damage to each opponent)/i.test(text)) score += 10;
  if (/(gain life|lifelink)/i.test(text)) score += getAIPlayerLife(game, playerId) <= 12 ? 8 : 2;
  if (/(trample|flying|double strike|vigilance)/i.test(text)) score += 6;
  if (/(discard|sacrifice|lose life)/i.test(text)) score -= 6;

  return score;
}

function chooseAbundantHarvestMode(game: any, playerId: PlayerID, modes: any[]): string[] {
  const battlefield = getAIBattlefield(game, playerId);
  const landsOnBattlefield = battlefield.filter((perm: any) => String(perm?.card?.type_line || '').toLowerCase().includes('land')).length;
  const hand = getAIHand(game, playerId);
  const landsInHand = hand.filter((card: any) => String(card?.type_line || '').toLowerCase().includes('land')).length;
  const wantLand = landsOnBattlefield <= 2 || (landsOnBattlefield <= 4 && landsInHand === 0);
  const chosen = modes.find((mode: any) => String(mode?.id || '').toLowerCase() === (wantLand ? 'land' : 'nonland')) || modes[0];
  return [String(chosen?.id || '')].filter(Boolean);
}

function chooseOverloadMode(game: any, playerId: PlayerID, step: any, modes: any[]): string[] {
  const castArgs = step?.castSpellFromHandArgs || {};
  const cardId = String(castArgs.cardId || step?.sourceId || '');
  const hand = getAIHand(game, playerId);
  const cardInHand = hand.find((card: any) => String(card?.id || '') === cardId);
  const oracleText = String(cardInHand?.oracle_text || '').toLowerCase();
  const overloadMatch = oracleText.match(/overload\s*\{([^}]+)\}/i);
  const overloadCost = overloadMatch ? `{${overloadMatch[1]}}` : null;
  const manaPool = getAvailableMana(game.state, playerId);
  const exactManaOptions = cardInHand?.id
    ? { excludedHandCardIds: [String(cardInHand.id)] }
    : undefined;
  const canPayOverload = overloadCost
    ? canPayManaCostWithAvailableSources(game.state, playerId, parseManaCost(overloadCost), Infinity, exactManaOptions)
    : false;
  const opponentNonlandPermanents = (game?.state?.battlefield || []).filter((perm: any) =>
    perm?.controller !== playerId && !String(perm?.card?.type_line || '').toLowerCase().includes('land')
  ).length;
  const shouldOverload = Boolean(canPayOverload && opponentNonlandPermanents >= 2);
  const preferredId = shouldOverload ? 'overload' : 'normal';
  const chosen = modes.find((mode: any) => String(mode?.id || '') === preferredId) || modes[0];
  return [String(chosen?.id || '')].filter(Boolean);
}

export function chooseAIModeSelectionsForStep(
  game: any,
  playerId: PlayerID,
  step: any
): { selections: string[]; cancelled: boolean } {
  const modes = Array.isArray(step?.modes) ? step.modes : [];
  if (modes.length === 0) {
    return { selections: [], cancelled: true };
  }

  const purpose = String(step?.modeSelectionPurpose || '');
  if (purpose === 'abundantChoice') {
    return { selections: chooseAbundantHarvestMode(game, playerId, modes), cancelled: false };
  }
  if (purpose === 'overload') {
    return { selections: chooseOverloadMode(game, playerId, step, modes), cancelled: false };
  }

  const pBudgetRaw = Number(step?.pBudget);
  if (Number.isFinite(pBudgetRaw) && pBudgetRaw > 0) {
    const scored = modes.map((mode: any) => ({
      id: String(mode?.id || ''),
      pCost: Number(mode?.pCost),
      score: scoreModeOption(game, playerId, step, mode),
    }));
    return {
      selections: choosePBudgetModeSelections(scored, Math.floor(pBudgetRaw), {
        minModes: Math.max(0, Number(step?.minModes ?? 0) || 0),
        canRepeatModes: Boolean(step?.canRepeatModes || step?.allowDuplicates),
      }),
      cancelled: false,
    };
  }

  const minModes = Math.max(1, Number(step?.minModes ?? 1));
  const maxModesRaw = Number(step?.maxModes ?? 1);
  const maxModes = maxModesRaw < 0 ? modes.length : Math.max(minModes, maxModesRaw);

  let selections = [...modes]
    .map((mode: any) => ({ id: String(mode?.id || ''), score: scoreModeOption(game, playerId, step, mode) }))
    .filter((entry) => Boolean(entry.id))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxModes)
    .map((entry) => entry.id);

  if (selections.length < minModes) {
    const fallback = modes
      .map((mode: any) => String(mode?.id || ''))
      .filter(Boolean);
    selections = fallback.slice(0, minModes);
  } else if (purpose !== 'spree' && maxModes > minModes) {
    selections = selections.slice(0, minModes);
  } else if (purpose === 'spree') {
    selections = selections.filter((id, index) => index < maxModes);
  }

  return { selections, cancelled: false };
}

export function chooseAIKynaiosChoiceSelection(step: any): { choice: string; landCardId?: string } {
  const isController = Boolean(step?.landPlayOrFallbackIsController ?? step?.isController);
  const canPlayLand = (step?.landPlayOrFallbackCanPlayLand ?? step?.canPlayLand) !== false;
  const landsInHand = Array.isArray(step?.landPlayOrFallbackLandsInHand)
    ? step.landPlayOrFallbackLandsInHand
    : (Array.isArray(step?.landsInHand) ? step.landsInHand : []);
  const options = Array.isArray(step?.landPlayOrFallbackOptions)
    ? step.landPlayOrFallbackOptions
    : (Array.isArray(step?.options) ? step.options : ['play_land', 'draw_card', 'decline']);

  if (isController && canPlayLand && landsInHand.length > 0 && options.includes('play_land')) {
    const chosenLand = landsInHand.find((land: any) => String(land?.id || '').trim().length > 0) || landsInHand[0];
    return {
      choice: 'play_land',
      landCardId: String(chosenLand?.id || '').trim() || undefined,
    };
  }

  if (!isController && options.includes('draw_card')) {
    return { choice: 'draw_card' };
  }

  if (options.includes('decline')) {
    return { choice: 'decline' };
  }

  if (options.includes('draw_card')) {
    return { choice: 'draw_card' };
  }

  const firstOption = options.find((option: any) => String(option || '').trim().length > 0);
  return { choice: String(firstOption || 'decline') };
}
