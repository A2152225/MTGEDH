// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: non-tap / battery / spend / produced-mana / buildExactManaSources.
// Public entry symbols: buildExactManaSources, ExactManaPaymentOptions,
// exactManaSpendRestrictionAllowsPurpose, spendManaCostFromExactPool,
// removeSacrificeCandidates, removeHandCandidates, removeReturnToHandCandidates,
// buildExactSacrificeCandidates, buildExactHandCandidates, normalizePoolSignature,
// EXACT_MANA_SEARCH_NODE_BUDGET.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { parseSacrificeCost } from "../../../../../shared/src/textUtils.js";
import { creatureHasHaste } from "../../../socket/game-actions.js";
import { cardHasCreatureType } from "../../creatureTypeNow.js";
import { getChosenTypeManaSpendRestriction } from "../chosen-creature-type.js";
import {
  getCommanderColorIdentity,
  getMoxAmberAvailableColors,
  isMoxAmberConditionalManaSource,
  parseManaSpendRestrictionFromOracle,
} from "../mana-abilities.js";
import { canCountPermanentManaAbilities } from "./manaCheckActivationGate.js";
import { permanentCannotActivateTapAbilities } from "../staticEffectSpecActivationLocks.js";
import {
  parsedManaCostHasValue,
  parseLifeCostFromManaAbilityCost,
  matchesHandCostTypeLine,
  parseHandCostFromManaAbilityCost,
  parseReturnToHandCostFromManaAbilityCost,
} from "./manaCheckAbilityCostParsers.js";
import { filterOutCostedTapMatches } from "./manaCheckCostedTapFilter.js";
import { stripReminderTextFromOracle } from "./manaCheckOracleText.js";
import { parseManaCost } from "./manaCheckParseManaCost.js";
import type { ParsedManaCost } from "./manaCheckPaymentTypes.js";
import { getOpponentPermanentColors, getControlledPermanentColors } from "./manaCheckPermanentColors.js";
import {
  parseSelfRemoveCounterCost,
  getPermanentCounterAmountForManaCheck,
  normalizeManaCheckCounterType,
} from "./manaCheckRemoveCounterCost.js";
import { buildScalingManaExactOptions } from "./manaCheckScalingExactOptions.js";
import {
  SIMPLE_MANA_KEYS,
  type SimpleManaKey,
  type ExactManaSourceOption,
  type ExactManaSource,
  type ExactSacrificeCandidate,
  type ExactHandCandidate,
  type ExactCandidateRemovalResult,
  createSimpleManaPool,
  manaSymbolToColorKey,
  createSingleColorProduction,
} from "./manaCheckSimplePool.js";

function buildSupportedNonTapManaSourceCost(
  costText: string,
  permanent?: any,
): Omit<ExactManaSourceOption, 'produced'> | null {
  const normalizedCost = String(costText || '').trim();
  if (!normalizedCost) {
    return null;
  }

  const option: Omit<ExactManaSourceOption, 'produced'> = {};
  let unsupportedResidue = normalizedCost;
  unsupportedResidue = unsupportedResidue.replace(/\{[^}]+\}/g, ' ');
  unsupportedResidue = unsupportedResidue.replace(/pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+life/gi, ' ');
  unsupportedResidue = unsupportedResidue.replace(
    /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi,
    ' ',
  );
  unsupportedResidue = unsupportedResidue.replace(
    /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+hand\b/gi,
    ' ',
  );
  unsupportedResidue = unsupportedResidue.replace(/sacrifice\s+[^,;:]*/gi, ' ');
  unsupportedResidue = unsupportedResidue.replace(
    /\breturn\s+(?:(?:another|other)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(?:a|an|one|1)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/gi,
    ' ',
  );

  const removeCounterCost = parseSelfRemoveCounterCost(normalizedCost, permanent);
  if (removeCounterCost) {
    if (!removeCounterCost.refersToSource) {
      return null;
    }
    unsupportedResidue = unsupportedResidue.replace(removeCounterCost.matchPattern, ' ');
    option.removeCounterCost = {
      counterType: removeCounterCost.counterType,
      count: removeCounterCost.count,
    };
  }

  unsupportedResidue = unsupportedResidue.replace(/,/g, ' ');
  unsupportedResidue = unsupportedResidue.replace(/\band\b/gi, ' ');
  unsupportedResidue = unsupportedResidue.replace(/\s+/g, ' ').trim();
  if (unsupportedResidue.length > 0) {
    return null;
  }

  const manaCostTokens = normalizedCost.match(/\{[^}]+\}/g) || [];
  if (manaCostTokens.length > 0) {
    const activationCost = parseManaCost(manaCostTokens.join(''));
    if (parsedManaCostHasValue(activationCost)) {
      option.activationCost = activationCost;
    }
  }

  const lifeCost = parseLifeCostFromManaAbilityCost(normalizedCost);
  if (lifeCost > 0) {
    option.lifeCost = lifeCost;
  }

  const handCost = parseHandCostFromManaAbilityCost(normalizedCost);
  if (handCost) {
    option.handCost = handCost;
  }

  const sacrificeInfo = parseSacrificeCost(normalizedCost);
  if (sacrificeInfo.requiresSacrifice && sacrificeInfo.sacrificeType) {
    option.sacrificeCost = {
      type: sacrificeInfo.sacrificeType,
      count: Math.max(1, Number(sacrificeInfo.sacrificeCount || 1)),
      creatureSubtype: sacrificeInfo.creatureSubtype,
      mustBeOther: Boolean(sacrificeInfo.mustBeOther),
    };
  }

  const returnToHandCost = parseReturnToHandCostFromManaAbilityCost(normalizedCost);
  if (returnToHandCost) {
    option.returnToHandCost = returnToHandCost;
  }

  return option;
}


function abilityCostRequiresTap(costText: string): boolean {
  return /\{[^}]*\bt\b[^}]*\}/i.test(String(costText || ''));
}

function detectManaBatteryColorFixOptions(permanent: any): ExactManaSourceOption[] {
  const oracleText = String(permanent?.card?.oracle_text || '');
  const lines = oracleText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let chargeCostText: string | null = null;
  let chargeRequiresTap = false;
  let chargeCounterType: string | null = null;
  let payoutCostText: string | null = null;
  let payoutRequiresTap = false;
  let payoutEffectText: string | null = null;

  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const costText = line.slice(0, colon).trim();
    const effectText = line.slice(colon + 1).trim();
    const lowerEffect = effectText.toLowerCase();

    const putMatch = lowerEffect.match(
      /\bput\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([^\s]+(?:\s+[^\s]+)?)\s+counters?\s+on\b/i,
    );
    if (putMatch && /\{[^}]+\}/.test(costText) && !/\badd\b/i.test(effectText)) {
      const counterType = normalizeManaCheckCounterType(String(putMatch[1] || ''));
      if (counterType) {
        chargeCostText = costText;
        chargeRequiresTap = abilityCostRequiresTap(costText);
        chargeCounterType = counterType;
      }
    }

    const removeCost = parseSelfRemoveCounterCost(costText, permanent);
    if (
      removeCost?.refersToSource
      && /\badd\b/i.test(effectText)
      && (/\bmana\b/i.test(effectText) || /\{[wubrgc]\}/i.test(effectText))
    ) {
      payoutCostText = costText;
      payoutRequiresTap = abilityCostRequiresTap(costText);
      payoutEffectText = effectText;
    }
  }

  if (!chargeCostText || !chargeCounterType || !payoutCostText || !payoutEffectText) {
    return [];
  }
  // Same-turn charge+remove cannot both require tapping the same permanent.
  if (chargeRequiresTap && payoutRequiresTap) {
    return [];
  }

  const manaSymbolText = (chargeCostText.match(/\{[^}]+\}/g) || [])
    .filter((symbol) => !/^\{[tq]\}$/i.test(symbol))
    .join('');
  if (!manaSymbolText) {
    return [];
  }

  const activationCost = parseManaCost(manaSymbolText);
  if (!parsedManaCostHasValue(activationCost)) {
    return [];
  }

  const producedOptions = buildProducedManaOptions(
    { battlefield: [permanent] },
    String(permanent?.controller || ''),
    permanent,
    payoutEffectText,
  );

  return producedOptions.map((produced) => ({
    activationCost,
    batteryColorFix: true,
    repeatable: true,
    produced,
  }));
}

function normalizeSelfReferenceText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function costTextReferencesSourcePermanent(costText: string, permanent: any): boolean {
  const normalizedCost = normalizeSelfReferenceText(costText);
  const normalizedSourceName = normalizeSelfReferenceText(String(permanent?.card?.name || ''));
  if (!normalizedCost || !normalizedSourceName) {
    return false;
  }

  return normalizedCost.includes(normalizedSourceName);
}

function shouldRepeatNonTapManaSource(
  option: Omit<ExactManaSourceOption, 'produced'>,
  costText: string,
  permanent: any,
): boolean {
  const sacrificesSource = option.sacrificeCost?.type === 'self'
    || /sacrifice\s+(?:this|~)\b/i.test(costText)
    || costTextReferencesSourcePermanent(costText, permanent);

  if (sacrificesSource) {
    return false;
  }

  // Remove-counter mana is limited by counters; callers expand one-shot sources per counter.
  if (option.removeCounterCost) {
    return false;
  }

  return Boolean(
    option.activationCost
    || option.lifeCost
    || option.handCost
    || option.sacrificeCost
    || option.returnToHandCost,
  );
}

export function normalizePoolSignature(pool: Record<SimpleManaKey, number>): string {
  return SIMPLE_MANA_KEYS.map((key) => String(pool[key] || 0)).join(',');
}


function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSubtypeWordsFromTypeLine(typeLineValue: string): string[] {
  const typeLine = String(typeLineValue || '').toLowerCase();
  const subtypeSection = typeLine.includes('—')
    ? typeLine.split('—').slice(1).join(' ')
    : typeLine.includes('-')
      ? typeLine.split('-').slice(1).join(' ')
      : '';

  if (!subtypeSection) return [];

  return subtypeSection
    .split(/[^a-z0-9']+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildExactSacrificeCandidates(state: any, playerId: PlayerID): ExactSacrificeCandidate[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield
    .filter((permanent) => permanent?.controller === playerId && permanent?.card)
    .map((permanent) => ({
      id: String(permanent.id || ''),
      typeLine: String(permanent.card?.type_line || '').toLowerCase(),
      subtypeWords: getSubtypeWordsFromTypeLine(String(permanent.card?.type_line || '')),
    }))
    .filter((candidate) => Boolean(candidate.id));
}

export function buildExactHandCandidates(state: any, playerId: PlayerID): ExactHandCandidate[] {
  const hand = Array.isArray(state?.zones?.[playerId]?.hand)
    ? state.zones[playerId].hand
    : [];

  return hand
    .map((card: any) => ({
      id: String(card?.id || ''),
      typeLine: String(card?.type_line || '').toLowerCase(),
    }))
    .filter((candidate) => Boolean(candidate.id));
}

export type ExactManaSpendPurpose = {
  isCreature?: boolean;
  isArtifact?: boolean;
  isAbility?: boolean;
  isActivatedAbility?: boolean;
  isInstantOrSorcery?: boolean;
  isLegendary?: boolean;
  isMulticolored?: boolean;
  isColorless?: boolean;
  isCommander?: boolean;
  spellCard?: any;
};

export type ExactManaPaymentOptions = {
  excludedHandCardIds?: string[];
  restrictedSpendPurpose?: ExactManaSpendPurpose;
};

function attachChosenTypeSpendRestrictionIfNeeded(
  permanent: any,
  producedText: string,
  option: ExactManaSourceOption,
): ExactManaSourceOption {
  let next = option;
  if (/one mana of any color|mana of any color/i.test(String(producedText || ''))) {
    const chosenTypeRestriction = getChosenTypeManaSpendRestriction(permanent);
    if (chosenTypeRestriction) {
      next = { ...next, spendRestriction: chosenTypeRestriction };
    }
  }
  if (!next.spendRestriction) {
    const oracleRestriction = parseManaSpendRestrictionFromOracle(String(permanent?.card?.oracle_text || ''));
    if (oracleRestriction) {
      next = {
        ...next,
        spendRestriction: {
          restriction: oracleRestriction.restriction,
          restrictedTo: oracleRestriction.restrictedTo,
        },
      };
    }
  }
  return next;
}

export function exactManaSpendRestrictionAllowsPurpose(
  spendRestriction: { restriction: string; restrictedTo?: string } | undefined,
  purpose: ExactManaSpendPurpose | undefined,
): boolean {
  if (!spendRestriction?.restriction || !purpose) return true;

  switch (spendRestriction.restriction) {
    case 'chosen_type_creature_spell':
    case 'chosen_type_creature_source':
      if (purpose.isCreature !== true) return false;
      if (!spendRestriction.restrictedTo) return true;
      return Boolean(purpose.spellCard && cardHasCreatureType(purpose.spellCard, spendRestriction.restrictedTo));
    case 'chosen_type_spell':
      if (!spendRestriction.restrictedTo) return true;
      return Boolean(purpose.spellCard && cardHasCreatureType(purpose.spellCard, spendRestriction.restrictedTo));
    case 'no_nonartifact_spells': {
      // Vibranium / Powerstone: cannot cast nonartifact spells; OK for abilities / artifact spells.
      // Artifact includes Vehicle, Equipment, Fortification — not only Artifact Creature.
      if (purpose.isActivatedAbility === true || purpose.isAbility === true) return true;
      if (purpose.isArtifact === true) return true;
      const spellTypeLine = String(purpose.spellCard?.type_line || '').trim();
      if (spellTypeLine) {
        return /\bartifact\b/i.test(spellTypeLine);
      }
      if (
        purpose.isCreature === true
        || purpose.isInstantOrSorcery === true
        || purpose.isLegendary === true
        || purpose.isMulticolored === true
        || purpose.isColorless === true
        || purpose.isCommander === true
      ) {
        return false;
      }
      return true;
    }
    case 'creatures':
      return purpose.isCreature === true;
    case 'artifacts':
      return purpose.isArtifact === true;
    case 'activated_abilities':
      return purpose.isActivatedAbility === true;
    case 'instant_sorcery':
      return purpose.isInstantOrSorcery === true;
    case 'legendary':
      return purpose.isLegendary === true;
    case 'multicolored':
      return purpose.isMulticolored === true;
    case 'colorless_spells':
      return purpose.isColorless === true;
    case 'abilities':
      return purpose.isAbility === true;
    default:
      // Unknown restriction: do not treat as unrestricted free mana.
      return false;
  }
}

function candidateMatchesSacrificeRequirement(
  candidate: ExactSacrificeCandidate,
  requirement: NonNullable<ExactManaSourceOption['sacrificeCost']>,
  sourcePermanentId: string,
): boolean {
  if (requirement.mustBeOther && candidate.id === sourcePermanentId) {
    return false;
  }

  switch (requirement.type) {
    case 'creature':
      if (!candidate.typeLine.includes('creature')) return false;
      if (requirement.creatureSubtype) {
        const subtype = String(requirement.creatureSubtype || '').toLowerCase();
        return candidate.subtypeWords.includes(subtype);
      }
      return true;
    case 'artifact':
      return candidate.typeLine.includes('artifact');
    case 'enchantment':
      return candidate.typeLine.includes('enchantment');
    case 'land':
      return candidate.typeLine.includes('land');
    case 'permanent':
      return true;
    case 'artifact_or_creature':
      return candidate.typeLine.includes('artifact') || candidate.typeLine.includes('creature');
    case 'self':
      return candidate.id === sourcePermanentId;
    default:
      return false;
  }
}

/** Cap sacrifice-choice fan-out. Ashnod's Altar + N tokens is C(N,k) per activation. */
const MAX_EXACT_SACRIFICE_BRANCHES = 3;

/**
 * Hard ceiling on exact-payment search nodes. Without this, repeatable sacrifice
 * outlets (Ashnod's Altar) plus many creatures / dual lands allocate gigabytes
 * during canAct / cast-candidate checks and freeze join/resume.
 */
export const EXACT_MANA_SEARCH_NODE_BUDGET = 25_000;

export function removeSacrificeCandidates(
  candidates: ExactSacrificeCandidate[],
  requirement: NonNullable<ExactManaSourceOption['sacrificeCost']>,
  sourcePermanentId: string,
  manaSourcePermanentIds?: Set<string>,
): ExactCandidateRemovalResult<ExactSacrificeCandidate>[] {
  const requiredCount = Math.max(1, Number(requirement.count || 1));
  const matchingCandidates = candidates.filter((candidate) =>
    candidateMatchesSacrificeRequirement(candidate, requirement, sourcePermanentId),
  );

  if (matchingCandidates.length < requiredCount) {
    return [];
  }

  // Prefer sacrificing non-mana-sources first (tokens over mana elves), then cap
  // fan-out so exact search stays tractable with wide boards.
  const ranked = matchingCandidates.slice().sort((a, b) => {
    const aIsSource = manaSourcePermanentIds?.has(a.id) ? 1 : 0;
    const bIsSource = manaSourcePermanentIds?.has(b.id) ? 1 : 0;
    return aIsSource - bIsSource;
  });
  // Interchangeable tokens are payability-equivalent. Branching on distinct ids
  // with a repeatable outlet (Ashnod's Altar) is C(N,k) per activation.
  const nonSourceMatches = ranked.filter((candidate) => !manaSourcePermanentIds?.has(candidate.id));
  if (nonSourceMatches.length >= requiredCount) {
    const removedIds = nonSourceMatches.slice(0, requiredCount).map((candidate) => candidate.id);
    const chosen = new Set(removedIds);
    return [{
      remainingCandidates: candidates.filter((candidate) => !chosen.has(candidate.id)),
      removedIds,
    }];
  }
  const branchCandidateLimit = Math.max(requiredCount, MAX_EXACT_SACRIFICE_BRANCHES);
  const branchCandidates = ranked.slice(0, branchCandidateLimit);

  const results: ExactCandidateRemovalResult<ExactSacrificeCandidate>[] = [];
  const choose = (startIndex: number, chosenIds: string[]) => {
    if (chosenIds.length >= requiredCount) {
      const chosen = new Set(chosenIds);
      results.push({
        remainingCandidates: candidates.filter((candidate) => !chosen.has(candidate.id)),
        removedIds: [...chosenIds],
      });
      return;
    }

    for (let index = startIndex; index < branchCandidates.length; index += 1) {
      choose(index + 1, chosenIds.concat(branchCandidates[index].id));
    }
  };

  choose(0, []);
  return results;
}

export function removeHandCandidates(
  candidates: ExactHandCandidate[],
  requirement: NonNullable<ExactManaSourceOption['handCost']>,
): ExactCandidateRemovalResult<ExactHandCandidate>[] {
  const requiredCount = Math.max(1, Number(requirement.count || 1));
  const matchingCandidates = candidates.filter((candidate) =>
    matchesHandCostTypeLine(candidate.typeLine, requirement.typeRestriction),
  );

  if (matchingCandidates.length < requiredCount) {
    return [];
  }

  const results: ExactCandidateRemovalResult<ExactHandCandidate>[] = [];
  const choose = (startIndex: number, chosenIds: string[]) => {
    if (chosenIds.length >= requiredCount) {
      const chosen = new Set(chosenIds);
      results.push({
        remainingCandidates: candidates.filter((candidate) => !chosen.has(candidate.id)),
        removedIds: [...chosenIds],
      });
      return;
    }

    for (let index = startIndex; index < matchingCandidates.length; index += 1) {
      choose(index + 1, chosenIds.concat(matchingCandidates[index].id));
    }
  };

  choose(0, []);
  return results;
}

function candidateMatchesReturnToHandRequirement(
  candidate: ExactSacrificeCandidate,
  requirement: NonNullable<ExactManaSourceOption['returnToHandCost']>,
  sourcePermanentId: string,
): boolean {
  if (requirement.mustBeOther && candidate.id === sourcePermanentId) {
    return false;
  }

  switch (requirement.type) {
    case 'permanent':
      return true;
    case 'nonland permanent':
      return !candidate.typeLine.includes('land');
    default:
      return candidate.typeLine.includes(String(requirement.type || '').toLowerCase());
  }
}

export function removeReturnToHandCandidates(
  candidates: ExactSacrificeCandidate[],
  requirement: NonNullable<ExactManaSourceOption['returnToHandCost']>,
  sourcePermanentId: string,
): ExactCandidateRemovalResult<ExactSacrificeCandidate>[] {
  const matchingCandidates = candidates.filter((candidate) =>
    candidateMatchesReturnToHandRequirement(candidate, requirement, sourcePermanentId),
  );

  return matchingCandidates.map((candidate) => ({
    remainingCandidates: candidates.filter((entry) => entry.id !== candidate.id),
    removedIds: [candidate.id],
  }));
}

function spendGenericManaFromPool(
  pool: Record<SimpleManaKey, number>,
  genericCost: number,
): Record<SimpleManaKey, number> | null {
  if (genericCost <= 0) return createSimpleManaPool(pool);

  const totalAvailable = SIMPLE_MANA_KEYS.reduce((sum, key) => sum + Number(pool[key] || 0), 0);
  if (totalAvailable < genericCost) return null;

  const remainingPool = createSimpleManaPool(pool);
  let toPay = genericCost;

  if (remainingPool.colorless > 0) {
    const fromColorless = Math.min(remainingPool.colorless, toPay);
    remainingPool.colorless -= fromColorless;
    toPay -= fromColorless;
  }

  if (toPay > 0) {
    for (const key of ['white', 'blue', 'black', 'red', 'green'] as const) {
      if (toPay <= 0) break;
      const available = remainingPool[key];
      if (available <= 0) continue;
      const toDeduct = Math.min(available, toPay);
      remainingPool[key] -= toDeduct;
      toPay -= toDeduct;
    }
  }

  return toPay === 0 ? remainingPool : null;
}

function spendHybridManaFromPool(
  pool: Record<SimpleManaKey, number>,
  hybridCosts: Array<string[]>,
  lifeAvailable: number,
  index: number = 0,
): { pool: Record<SimpleManaKey, number>; lifeAvailable: number } | null {
  if (index >= hybridCosts.length) {
    return { pool: createSimpleManaPool(pool), lifeAvailable };
  }

  const options = hybridCosts[index] || [];
  for (const option of options) {
    if (option.startsWith('LIFE:')) {
      const lifeCost = parseInt(option.split(':')[1] || '0', 10);
      if (lifeAvailable < lifeCost) continue;
      const result = spendHybridManaFromPool(pool, hybridCosts, lifeAvailable - lifeCost, index + 1);
      if (result) return result;
      continue;
    }

    if (option.startsWith('GENERIC:')) {
      const genericCost = parseInt(option.split(':')[1] || '0', 10);
      const nextPool = spendGenericManaFromPool(pool, genericCost);
      if (!nextPool) continue;
      const result = spendHybridManaFromPool(nextPool, hybridCosts, lifeAvailable, index + 1);
      if (result) return result;
      continue;
    }

    const colorKey = manaSymbolToColorKey(option);
    if (!colorKey || pool[colorKey] <= 0) continue;

    const nextPool = createSimpleManaPool(pool);
    nextPool[colorKey] -= 1;
    const result = spendHybridManaFromPool(nextPool, hybridCosts, lifeAvailable, index + 1);
    if (result) return result;
  }

  return null;
}

export function spendManaCostFromExactPool(
  pool: Record<SimpleManaKey, number>,
  parsedCost: ParsedManaCost,
  lifeAvailable: number = Infinity,
): { pool: Record<SimpleManaKey, number>; lifeAvailable: number } | null {
  const remainingPool = createSimpleManaPool(pool);
  let remainingLife = lifeAvailable;

  for (const [colorSymbol, needed] of Object.entries(parsedCost.colors || {})) {
    const colorKey = manaSymbolToColorKey(colorSymbol);
    if (!colorKey || Number(needed || 0) <= 0) continue;
    if (remainingPool[colorKey] < Number(needed)) {
      return null;
    }
    remainingPool[colorKey] -= Number(needed);
  }

  if (parsedCost.hybrid && parsedCost.hybrid.length > 0) {
    const hybridResult = spendHybridManaFromPool(remainingPool, parsedCost.hybrid, remainingLife);
    if (!hybridResult) return null;
    remainingLife = hybridResult.lifeAvailable;
    for (const key of SIMPLE_MANA_KEYS) {
      remainingPool[key] = hybridResult.pool[key];
    }
  }

  const genericResult = spendGenericManaFromPool(remainingPool, parsedCost.generic || 0);
  if (!genericResult) return null;

  return {
    pool: genericResult,
    lifeAvailable: remainingLife,
  };
}

function buildProducedManaOptions(
  state: any,
  playerId: PlayerID,
  permanent: any,
  fullManaText: string,
): Array<Record<SimpleManaKey, number>> {
  const manaText = String(fullManaText || '').trim();
  if (!manaText) return [];

  if (isMoxAmberConditionalManaSource(String(permanent?.card?.name || ''), manaText)) {
    return getMoxAmberAvailableColors(state, playerId)
      .map((symbol) => manaSymbolToColorKey(symbol))
      .filter((key): key is SimpleManaKey => Boolean(key))
      .map((key) => createSingleColorProduction(key));
  }

  const hasOrClause = /\{[wubrgc]\}(?:,?\s*\{[wubrgc]\})*,?\s+or\s+\{[wubrgc]\}/i.test(manaText);
  const manaTokens = manaText.match(/\{([wubrgc])\}/gi) || [];
  const isConditionalAnyColor = /that (?:a |an )?(?:land|permanent)|among (?:lands|permanents)/i.test(manaText);
  const isUnconditionalAnyColor = /one mana of any color|add.*any color/i.test(manaText);
  const isCommanderColorIdentity = /commander.*color identity|color identity.*commander/i.test(manaText);

  if (isUnconditionalAnyColor && !isConditionalAnyColor) {
    const colorKeys = isCommanderColorIdentity
      ? Array.from(getCommanderColorIdentity(state, playerId))
      : (['white', 'blue', 'black', 'red', 'green'] as string[]);

    return colorKeys
      .map((key) => key as SimpleManaKey)
      .map((key) => createSingleColorProduction(key));
  }

  if (isConditionalAnyColor) {
    const checksControlledLands = /that (?:a |an )?land you control could produce|among lands you control/i.test(manaText);
    const checksControlledPermanents = /that (?:a |an )?permanent you control could produce|among permanents you control/i.test(manaText);
    const conditionalColors = checksControlledLands || checksControlledPermanents
      ? getControlledPermanentColors(state, playerId, checksControlledLands, String(permanent.id || ''))
      : getOpponentPermanentColors(state, playerId);

    return Array.from(conditionalColors)
      .map((key) => key as SimpleManaKey)
      .map((key) => createSingleColorProduction(key));
  }

  if (hasOrClause) {
    const seen = new Set<SimpleManaKey>();
    const options: Array<Record<SimpleManaKey, number>> = [];
    for (const token of manaTokens) {
      const colorKey = manaSymbolToColorKey(token.replace(/[{}]/g, ''));
      if (!colorKey || seen.has(colorKey)) continue;
      seen.add(colorKey);
      options.push(createSingleColorProduction(colorKey));
    }
    return options;
  }

  if (manaTokens.length > 0) {
    const produced = createSimpleManaPool();
    for (const token of manaTokens) {
      const colorKey = manaSymbolToColorKey(token.replace(/[{}]/g, ''));
      if (!colorKey) continue;
      produced[colorKey] += 1;
    }
    return [produced];
  }

  return [];
}

export function buildExactManaSources(state: any, playerId: PlayerID): ExactManaSource[] {
  const battlefield = state?.battlefield || [];
  const sources: ExactManaSource[] = [];

  for (const permanent of battlefield) {
    if (permanent.controller !== playerId) continue;
    if (permanent.tapped) continue;
    if (!permanent.card) continue;

    const oracleText = stripReminderTextFromOracle(permanent.card.oracle_text || '').toLowerCase();
    const cardName = String(permanent.card.name || '').toLowerCase();
    const typeLine = String(permanent.card.type_line || '').toLowerCase();
    const isCreature = typeLine.includes('creature');
    const isLand = typeLine.includes('land');

    if (isCreature && !isLand && permanent.summoningSickness) {
      const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
      if (!hasHaste) continue;
    }

    if (permanentCannotActivateTapAbilities(permanent, state) && /\{T\}/i.test(oracleText)) {
      continue;
    }

    if (!canCountPermanentManaAbilities(state, playerId, permanent.card.oracle_text || '')) {
      continue;
    }

    const isBasicLandName = /^(plains|island|swamp|mountain|forest)$/i.test(cardName);
    const isSnowCoveredBasic = /^snow-covered\s+(plains|island|swamp|mountain|forest)$/i.test(cardName);
    if (isBasicLandName || isSnowCoveredBasic) {
      const baseName = cardName.replace(/^snow-covered\s+/i, '');
      const landToColor: Record<string, SimpleManaKey> = {
        plains: 'white',
        island: 'blue',
        swamp: 'black',
        mountain: 'red',
        forest: 'green',
      };
      const colorKey = landToColor[baseName];
      if (colorKey) {
        sources.push({
          id: String(permanent.id || `${cardName}_${sources.length}`),
          permanentId: String(permanent.id || `${cardName}_${sources.length}`),
          options: [{ produced: createSingleColorProduction(colorKey) }],
        });
      }
      continue;
    }

    const scalingOptions = buildScalingManaExactOptions(state, playerId, permanent);
    if (scalingOptions.length > 0) {
      sources.push({
        id: String(permanent.id || `${cardName}_${sources.length}`),
        permanentId: String(permanent.id || `${cardName}_${sources.length}`),
        options: scalingOptions,
      });
      continue;
    }

    const manaAbilityWithCostPattern = /\{([0-9]+|[wubrgc])\}(?:,\s*)?\{t\}(?:[^:]*)?:\s*add\s+([^.\n]+)/gi;
    const manaAbilityNoCostPattern = /\{t\}(?:[^:]*)?:\s*add\s+([^.\n]+)/gi;
    const nonTapManaAbilityPattern = /([^:.\n]+):\s*add\s+([^.\n]+)/gi;
    const costMatches = [...oracleText.matchAll(manaAbilityWithCostPattern)];
    const noCostMatches = filterOutCostedTapMatches([...oracleText.matchAll(manaAbilityNoCostPattern)], costMatches);
    const nonTapCostMatches = [...oracleText.matchAll(nonTapManaAbilityPattern)].filter((match) => {
      const costText = String(match[1] || '').trim();
      return Boolean(costText) && !/\{[^}]*\bt\b[^}]*\}/i.test(costText);
    });
    const options: ExactManaSourceOption[] = [];

    for (const match of costMatches) {
      const activationCost = parseManaCost(`{${match[1]}}`);
      const producedText = String(match[2] || '');
      const costText = String(match[0] || '').split(':')[0] || '';
      const removeCost = parseSelfRemoveCounterCost(costText, permanent);
      if (removeCost) {
        if (!removeCost.refersToSource) continue;
        if (getPermanentCounterAmountForManaCheck(permanent, removeCost.counterType) < removeCost.count) {
          continue;
        }
      }
      const producedOptions = buildProducedManaOptions(state, playerId, permanent, producedText);
      for (const produced of producedOptions) {
        options.push(attachChosenTypeSpendRestrictionIfNeeded(permanent, producedText, {
          activationCost,
          produced,
          ...(removeCost ? { removeCounterCost: { counterType: removeCost.counterType, count: removeCost.count } } : {}),
        }));
      }
    }

    for (const match of noCostMatches) {
      const producedText = String(match[1] || '');
      const costText = String(match[0] || '').split(':')[0] || '';
      const removeCost = parseSelfRemoveCounterCost(costText, permanent);
      if (removeCost) {
        if (!removeCost.refersToSource) continue;
        if (getPermanentCounterAmountForManaCheck(permanent, removeCost.counterType) < removeCost.count) {
          continue;
        }
      }
      const producedOptions = buildProducedManaOptions(state, playerId, permanent, producedText);
      for (const produced of producedOptions) {
        options.push(attachChosenTypeSpendRestrictionIfNeeded(permanent, producedText, {
          produced,
          ...(removeCost ? { removeCounterCost: { counterType: removeCost.counterType, count: removeCost.count } } : {}),
        }));
      }
    }

    for (const match of nonTapCostMatches) {
      const costText = String(match[1] || '').trim();
      const producedText = String(match[2] || '');
      const supportedCost = buildSupportedNonTapManaSourceCost(costText, permanent);
      if (!supportedCost) continue;

      if (supportedCost.removeCounterCost) {
        const available = getPermanentCounterAmountForManaCheck(
          permanent,
          supportedCost.removeCounterCost.counterType,
        );
        if (available < supportedCost.removeCounterCost.count) {
          continue;
        }
      }

      const inferredSupportedCost = { ...supportedCost };
      if (!inferredSupportedCost.sacrificeCost && /^sacrifice\b/i.test(costText) && costTextReferencesSourcePermanent(costText, permanent)) {
        inferredSupportedCost.sacrificeCost = {
          type: 'self',
          count: 1,
        };
      }

      const repeatable = shouldRepeatNonTapManaSource(inferredSupportedCost, costText, permanent);

      const producedOptions = buildProducedManaOptions(state, playerId, permanent, producedText);
      for (const produced of producedOptions) {
        options.push(attachChosenTypeSpendRestrictionIfNeeded(
          permanent,
          producedText,
          { ...inferredSupportedCost, repeatable, produced },
        ));
      }
    }

    for (const colorFixOption of detectManaBatteryColorFixOptions(permanent)) {
      options.push(attachChosenTypeSpendRestrictionIfNeeded(
        permanent,
        'one mana of any color',
        colorFixOption,
      ));
    }

    if (options.length > 0) {
      const dedupedOptions = new Map<string, ExactManaSourceOption>();
      for (const option of options) {
        const activationSignature = option.activationCost
          ? JSON.stringify(option.activationCost)
          : 'none';
        const lifeSignature = Number(option.lifeCost || 0) > 0
          ? String(option.lifeCost)
          : 'none';
        const handSignature = option.handCost
          ? JSON.stringify(option.handCost)
          : 'none';
        const sacrificeSignature = option.sacrificeCost
          ? JSON.stringify(option.sacrificeCost)
          : 'none';
        const returnToHandSignature = option.returnToHandCost
          ? JSON.stringify(option.returnToHandCost)
          : 'none';
        const removeCounterSignature = option.removeCounterCost
          ? JSON.stringify(option.removeCounterCost)
          : 'none';
        const colorFixSignature = option.batteryColorFix ? 'colorfix' : 'none';
        const repeatableSignature = option.repeatable ? 'repeatable' : 'single';
        const productionSignature = normalizePoolSignature(option.produced);
        const restrictionSignature = option.spendRestriction
          ? `${option.spendRestriction.restriction}:${option.spendRestriction.restrictedTo || ''}`
          : 'none';
        dedupedOptions.set(
          `${activationSignature}|${lifeSignature}|${handSignature}|${sacrificeSignature}|${returnToHandSignature}|${removeCounterSignature}|${colorFixSignature}|${repeatableSignature}|${productionSignature}|${restrictionSignature}`,
          option,
        );
      }

      const sourceIdBase = String(permanent.id || `${cardName}_${sources.length}`);
      const counterBudgets: Record<string, number> = {};
      for (const option of dedupedOptions.values()) {
        if (!option.removeCounterCost) continue;
        const key = option.removeCounterCost.counterType;
        counterBudgets[key] = getPermanentCounterAmountForManaCheck(permanent, key);
      }

      const finalizedOptions = Array.from(dedupedOptions.values()).map((option) => {
        // Non-tap remove-counter mana can be used once per available counter batch.
        if (option.removeCounterCost && !option.activationCost && !option.batteryColorFix) {
          return { ...option, repeatable: true };
        }
        return option;
      });

      sources.push({
        id: sourceIdBase,
        permanentId: sourceIdBase,
        options: finalizedOptions,
        ...(Object.keys(counterBudgets).length > 0 ? { counterBudgets } : {}),
      });
    }
  }

  return sources;
}
