/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: scoreModeOption, chooseAbundantHarvestMode, chooseOverloadMode,
 * chooseAIModeSelectionsForStep, chooseAIKynaiosChoiceSelection.
 *
 * Public entry symbols: chooseAIModeSelectionsForStep, chooseAIKynaiosChoiceSelection.
 *
 * Fight modes score as removal only when the source can kill a high-threat
 * opposing creature (lethal power / deathtouch, not indestructible, not
 * hexproof/shroud/protection from the fighter).
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { choosePBudgetModeSelections } from "../../../../shared/src/modeSelectionPBudget.js";
import { cardAnalyzer, ThreatLevel } from "../../../../rules-engine/src/CardAnalyzer.js";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting.js";
import { protectionPreventsSource } from "../../state/modules/combat-mechanics.js";
import { getAvailableMana, parseManaCost, canPayManaCostWithAvailableSources } from "../../state/modules/mana-check.js";
import { permanentHasKeyword } from "../game-actions-handlers/gameActionsPermanentKeywordGrants.js";
import { getEffectivePower, getEffectiveToughness } from "../util.js";
import { getAIBattlefield, getAIHand, getAIPlayerLife } from "./aiDeckProfileHandlers.js";

const FIGHT_MODE_PATTERN = /\bfights?\b/i;
const HIGH_REMOVAL_PRIORITY = 3;

function isCreaturePermanent(permanent: any): boolean {
  return String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase().includes('creature');
}

function resolveFightSourcePermanent(game: any, playerId: PlayerID, step: any): any | null {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const sourceId = String(step?.sourceId || step?.effectProgramSourceId || '').trim();
  if (sourceId) {
    const byId = battlefield.find((permanent: any) => String(permanent?.id || '') === sourceId);
    if (byId) return byId;
  }

  const sourceName = String(step?.sourceName || step?.effectProgramSourceName || '').trim().toLowerCase();
  if (!sourceName) return null;
  const named = battlefield.filter((permanent: any) =>
    String(permanent?.controller || '') === String(playerId)
    && String(permanent?.card?.name || '').toLowerCase() === sourceName
  );
  return named.length > 0 ? named[named.length - 1] : null;
}

function fighterDealsLethalFightDamage(
  fighter: any,
  target: any,
  battlefield: any[],
  gameState: any,
): boolean {
  if (permanentHasKeyword(target, battlefield, String(target?.controller || ''), 'indestructible')) {
    return false;
  }
  if (permanentHasKeyword(fighter, battlefield, String(fighter?.controller || ''), 'deathtouch')) {
    return getEffectivePower(fighter, gameState) >= 1;
  }
  return getEffectivePower(fighter, gameState) >= getEffectiveToughness(target, gameState);
}

function isHighPriorityFightThreat(target: any): boolean {
  if (target?.isCommander === true) return true;
  const analysis = cardAnalyzer.analyzeCard(target);
  return analysis.threatLevel >= ThreatLevel.HIGH || analysis.removalTargetPriority > HIGH_REMOVAL_PRIORITY;
}

function scoreFightModeAsKillOption(game: any, playerId: PlayerID, step: any, modeText: string): number {
  if (!FIGHT_MODE_PATTERN.test(modeText)) return 0;

  const fighter = resolveFightSourcePermanent(game, playerId, step);
  if (!fighter || !isCreaturePermanent(fighter)) return 0;

  const gameState = game?.state;
  const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
  const fighterToughness = getEffectiveToughness(fighter, gameState);
  let best = 0;

  for (const opponent of battlefield) {
    if (!opponent || String(opponent.controller || '') === String(playerId)) continue;
    if (!isCreaturePermanent(opponent)) continue;
    if (!canPermanentBeTargetedByPlayer(opponent, gameState, playerId)) continue;
    if (protectionPreventsSource(opponent, fighter, gameState)) continue;
    if (!fighterDealsLethalFightDamage(fighter, opponent, battlefield, gameState)) continue;
    if (!isHighPriorityFightThreat(opponent)) continue;

    const opponentPower = getEffectivePower(opponent, gameState);
    const weAlsoDie = opponentPower >= fighterToughness
      && !permanentHasKeyword(fighter, battlefield, String(fighter?.controller || ''), 'indestructible');
    const analysis = cardAnalyzer.analyzeCard(opponent);
    const critical = analysis.threatLevel >= ThreatLevel.CRITICAL || opponent?.isCommander === true;
    // Survive-and-kill matches destroy. A trade still beats keyword modes when the
    // target is a real threat (HIGH+) or a commander.
    const score = weAlsoDie ? (critical ? 14 : 10) : 14 + Math.min(4, Math.max(0, analysis.threatLevel - ThreatLevel.HIGH));
    if (score > best) best = score;
  }

  return best;
}

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
  score += scoreFightModeAsKillOption(game, playerId, step, text);

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
