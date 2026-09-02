/**
 * socket/interaction-handlers/interactionManaAbilityActivationShape.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: mana-ability activation shape resolution - selection-text
 *   normalization, explicit "add N mana" parsing, chosen-color overrides,
 *   any-color bonus mana queuing, and the ability-scoring picker used when a
 *   permanent exposes several mana abilities.
 * Public entry symbols: resolveManaAbilityActivationShape (re-exported from
 *   interaction.ts), plus getAnyColorBonusManaAmount,
 *   queueAnyColorBonusManaSelection and getChosenTypeManaSelectionFields which
 *   interaction.ts still calls internally.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { calculateManaProduction, resolveClientStyleManaAbilityById } from "../util";
import {
  getCommanderColorIdentity,
  getManaAbilitiesForPermanent,
  resolvePermanentChosenColorSymbol,
} from "../../state/modules/mana-abilities";
import { parseWordNumber } from "../../state/utils";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";

function normalizeManaAbilitySelectionText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*$/g, '')
    .trim();
}

function parseSelectedManaChoiceAmount(rawAmount: string): number | undefined {
  const normalized = String(rawAmount || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  const wordToAmount: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  return wordToAmount[normalized];
}

function getExplicitSelectedAnyColorManaAmount(text: string): number | undefined {
  const normalizedText = normalizeManaAbilitySelectionText(text);
  const match = normalizedText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+any(?:\s+one)?\s+color\b/i);
  return match ? parseSelectedManaChoiceAmount(String(match[1] || '')) : undefined;
}

function parseExplicitSelectedManaProduction(text: string): {
  produces: string[];
  baseAmount: number;
  producesAllAtOnce: boolean;
} | undefined {
  const rawText = String(text || '');
  if (!rawText.trim()) {
    return undefined;
  }

  const effectText = rawText.includes(':') ? rawText.split(':').slice(1).join(':') : rawText;
  // "{T}: Add {U} or {R}" / "Add {W}, {U}, or {B}" — choice of one, not the first symbol only.
  const choiceSymbolsMatch = effectText.match(
    /\badd\s+(\{[wubrgc]\}(?:\s*(?:,\s*(?:or\s+)?|\s+or\s+)\{[wubrgc]\})+)/i,
  );
  if (choiceSymbolsMatch) {
    const matchedSegment = String(choiceSymbolsMatch[1] || '');
    const manaSymbols = matchedSegment.match(/\{([wubrgc])\}/gi) || [];
    const produces = [...new Set(manaSymbols.map((symbol) => symbol.replace(/[{}]/g, '').toUpperCase()))];
    if (produces.length > 0) {
      return {
        produces,
        baseAmount: 1,
        producesAllAtOnce: false,
      };
    }
  }

  const directSymbolsMatch = effectText.match(/\badd\s+((?:\{[wubrgc]\}){1,})/i);
  if (directSymbolsMatch) {
    const matchedSegment = String(directSymbolsMatch[1] || '');
    const manaSymbols = matchedSegment.match(/\{([wubrgc])\}/gi) || [];
    const produces = [...new Set(manaSymbols.map((symbol) => symbol.replace(/[{}]/g, '').toUpperCase()))];
    if (produces.length > 0) {
      const isChoicePattern = /\bor\b|,/.test(matchedSegment.toLowerCase());
      const baseAmount = isChoicePattern ? 1 : manaSymbols.length;
      return {
        produces,
        baseAmount,
        producesAllAtOnce: !isChoicePattern && manaSymbols.length > 1,
      };
    }
  }

  const chosenColorMatch = effectText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+colou?r/i);
  if (chosenColorMatch) {
    const rawAmount = String(chosenColorMatch[1] || '').trim().toLowerCase();
    const baseAmount = parseWordNumber(rawAmount, 1);
    return {
      produces: [],
      baseAmount: Math.max(1, baseAmount),
      producesAllAtOnce: false,
    };
  }

  return undefined;
}

function applyPermanentChosenColorManaOverride(
  permanent: any,
  selectedAbilityTextRaw: string,
  selectedAbilityFullTextRaw: string,
  shape: { produces: string[]; baseAmount: number; producesAllAtOnce: boolean },
): void {
  const effectText = normalizeManaAbilitySelectionText(
    selectedAbilityTextRaw
    || (selectedAbilityFullTextRaw.includes(':')
      ? selectedAbilityFullTextRaw.split(':').slice(1).join(':')
      : selectedAbilityFullTextRaw),
  );
  if (!/mana\s+of\s+the\s+chosen\s+colou?r/i.test(effectText)) {
    return;
  }

  const chosenSymbol = resolvePermanentChosenColorSymbol(permanent);
  if (!chosenSymbol) {
    return;
  }

  // Thriving lands: "Add {G} or one mana of the chosen color" — offer both options.
  const thrivingOrMatch = effectText.match(
    /\badd\s+\{([wubrgc])\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r/i,
  );
  if (thrivingOrMatch) {
    const fixedColor = String(thrivingOrMatch[1] || '').toUpperCase();
    const colors = [fixedColor];
    if (chosenSymbol !== fixedColor) {
      colors.push(chosenSymbol);
    }
    shape.produces = colors;
    shape.baseAmount = 1;
    shape.producesAllAtOnce = false;
    return;
  }

  const amountMatch = effectText.match(/\badd\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+colou?r/i);
  if (amountMatch) {
    const parsedAmount = parseWordNumber(String(amountMatch[1] || ''), 1);
    if (parsedAmount > 0) {
      shape.baseAmount = parsedAmount;
    }
  }

  shape.produces = [chosenSymbol];
  shape.producesAllAtOnce = false;
}

export function getAnyColorBonusManaAmount(manaProduction: { bonusMana?: Array<{ color?: string; amount?: number }>; requiresBonusColorChoice?: boolean } | null | undefined): number {
  if (!manaProduction?.requiresBonusColorChoice) return 0;
  return (Array.isArray(manaProduction.bonusMana) ? manaProduction.bonusMana : [])
    .filter((bonus) => String(bonus?.color || '').toUpperCase() === 'ANY')
    .reduce((sum, bonus) => sum + Math.max(0, Number(bonus?.amount || 0)), 0);
}

export function queueAnyColorBonusManaSelection(params: {
  gameId: string;
  playerId: PlayerID;
  permanentId: string;
  cardName: string;
  permanent: any;
  amount: number;
  abilityId?: string;
}): void {
  const { gameId, playerId, permanentId, cardName, permanent, amount, abilityId } = params;
  if (!Number.isFinite(amount) || amount <= 0) return;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.MANA_COLOR_SELECTION,
    playerId,
    sourceId: permanentId,
    sourceName: cardName,
    sourceImage: (permanent?.card as any)?.image_uris?.small || (permanent?.card as any)?.image_uris?.normal,
    description: `Choose a color for additional mana when tapping ${cardName}.`,
    mandatory: true,
    selectionKind: 'any_color',
    permanentId,
    cardName,
    amount,
    allowedColors: ['W', 'U', 'B', 'R', 'G'],
    singleColor: true,
    ...(abilityId ? { abilityId } : null),
    bonusAnyColorMana: true,
  } as any);
}

function normalizeManaAbilityProducedColors(rawColors: unknown): string[] {
  if (!Array.isArray(rawColors)) {
    return [];
  }

  const colors: string[] = [];
  for (const rawColor of rawColors) {
    const normalizedColor = String(rawColor || '').trim().toUpperCase();
    if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(normalizedColor)) {
      continue;
    }
    if (!colors.includes(normalizedColor)) {
      colors.push(normalizedColor);
    }
  }

  return colors;
}

function selectManaAbilityForActivation(
  manaAbilities: any[],
  abilityIdRaw: string,
  selectedAbilityFullTextRaw: string,
  selectedAbilityTextRaw: string,
  selectedCostTextRaw: string,
): any {
  if (!Array.isArray(manaAbilities) || manaAbilities.length === 0) {
    return undefined;
  }

  const explicitAbilityId = String(abilityIdRaw || '').trim();
  if (explicitAbilityId) {
    const exactAbility = manaAbilities.find((entry: any) => String(entry?.id || '').trim() === explicitAbilityId);
    if (exactAbility) {
      return exactAbility;
    }
  }

  if (manaAbilities.length === 1) {
    return manaAbilities[0];
  }

  const selectedAbilityFullText = normalizeManaAbilitySelectionText(selectedAbilityFullTextRaw);
  const selectedAbilityText = normalizeManaAbilitySelectionText(
    selectedAbilityTextRaw || (selectedAbilityFullText.includes(':') ? selectedAbilityFullText.split(':').slice(1).join(':') : selectedAbilityFullText),
  );
  const selectedCostText = normalizeManaAbilitySelectionText(
    selectedCostTextRaw || (selectedAbilityFullText.includes(':') ? selectedAbilityFullText.split(':')[0] : ''),
  );
  const selectedManaSymbols = selectedAbilityText.match(/\{([wubrgc])\}/gi) || [];
  const requestedColors = [...new Set(selectedManaSymbols.map((token) => token.replace(/[{}]/g, '').toUpperCase()))];
  const requestedColorKey = requestedColors.slice().sort().join(',');
  const requestedSymbolCount = selectedManaSymbols.length;
  const requestedAnyColor = /one mana of any color|any color of mana|mana of any one color|one mana of any type/i.test(selectedAbilityText);
  const commanderRestricted = /commander'?s?\s+color\s+identity/i.test(selectedAbilityFullText);
  const requestedChoice = requestedAnyColor || /\bor\b/i.test(selectedAbilityText);
  const payLifeMatch = selectedCostText.match(/\bpay\s+(\d+)\s+life\b/i);
  const requestedPayLifeAmount = payLifeMatch ? parseInt(payLifeMatch[1], 10) : 0;

  let bestAbility = manaAbilities[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const ability of manaAbilities) {
    const abilityColors = Array.isArray(ability?.produces)
      ? ability.produces.map((color: any) => String(color || '').toUpperCase())
      : [];
    const abilityColorKey = abilityColors.slice().sort().join(',');
    const abilityCost = normalizeManaAbilitySelectionText(String(ability?.cost || ''));
    const abilityPayLifeAmount = Math.max(
      0,
      Number(
        (Array.isArray(ability?.additionalCosts)
          ? ability.additionalCosts.find((cost: any) => cost?.type === 'pay_life')?.amount
          : 0) || 0,
      ),
    );
    const abilityAmount = Math.max(1, Number(ability?.amount || 1));

    let score = 0;

    if (selectedCostText && abilityCost === selectedCostText) {
      score += 40;
    } else if (selectedCostText.includes('{t}') && abilityCost.includes('{t}')) {
      score += 12;
    }

    if (requestedPayLifeAmount > 0) {
      if (abilityPayLifeAmount === requestedPayLifeAmount) {
        score += 25;
      } else {
        score -= 25;
      }
    } else if (abilityPayLifeAmount > 0) {
      score -= 10;
    }

    if (requestedAnyColor) {
      if (abilityColors.length > 0) {
        score += 15;
      }
      if (abilityColors.length > 1) {
        score += 8;
      }
      if (commanderRestricted && String(ability?.id || '').includes('commander')) {
        score += 12;
      }
      if (!commanderRestricted && !String(ability?.id || '').includes('commander')) {
        score += 4;
      }
    } else if (requestedColors.length > 0) {
      if (abilityColorKey === requestedColorKey) {
        score += 25;
      } else if (requestedColors.every((color) => abilityColors.includes(color))) {
        score += 12;
      } else if (abilityColors.length === 1 && requestedColors.includes(abilityColors[0])) {
        score += 6;
      }
    }

    let requestedAmount = 1;
    if (requestedColors.length === 1 && requestedSymbolCount > 1) {
      requestedAmount = requestedSymbolCount;
    } else if (!requestedChoice && requestedColors.length > 1) {
      requestedAmount = requestedColors.length;
    }

    if (abilityAmount === requestedAmount) {
      score += 8;
    } else if (requestedAmount === 1 && abilityAmount === 1) {
      score += 4;
    }

    if (requestedChoice && abilityColors.length > 1) {
      score += ability?.producesAllAtOnce === true ? -6 : 10;
    } else if (!requestedChoice && requestedColors.length > 1 && abilityColors.length > 1) {
      score += ability?.producesAllAtOnce === true ? 10 : -6;
    }

    if (
      !requestedAnyColor &&
      requestedColors.length === 1 &&
      requestedColors[0] !== 'C' &&
      abilityColors.length === 1 &&
      abilityColors[0] === 'C'
    ) {
      score -= 20;
    }

    if (
      requestedColors.length === 1 &&
      requestedColors[0] === 'C' &&
      !(abilityColors.length === 1 && abilityColors[0] === 'C')
    ) {
      score -= 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestAbility = ability;
    }
  }

  return bestAbility;
}

export function resolveManaAbilityActivationShape(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityIdRaw: string,
  selectedAbilityFullTextRaw: string,
  selectedAbilityTextRaw: string,
  selectedCostTextRaw: string,
): {
  ability: any;
  produces: string[];
  baseAmount: number;
  producesAllAtOnce: boolean;
} {
  const clientStyleAbility = resolveClientStyleManaAbilityById(abilityIdRaw);
  if (clientStyleAbility) {
    return {
      ability: clientStyleAbility,
      produces: clientStyleAbility.produces,
      baseAmount: clientStyleAbility.amount,
      producesAllAtOnce: clientStyleAbility.producesAllAtOnce,
    };
  }

  const manaAbilities = getManaAbilitiesForPermanent(gameState, permanent, playerId);
  const ability = selectManaAbilityForActivation(
    manaAbilities,
    abilityIdRaw,
    selectedAbilityFullTextRaw,
    selectedAbilityTextRaw,
    selectedCostTextRaw,
  ) || manaAbilities[0];
  const manaProduction = calculateManaProduction(gameState, permanent, playerId, undefined, abilityIdRaw || undefined);
  const explicitSelectedManaProduction = parseExplicitSelectedManaProduction(selectedAbilityFullTextRaw || selectedAbilityTextRaw);
  const calculatedProduces = explicitSelectedManaProduction?.produces || normalizeManaAbilityProducedColors(manaProduction?.colors);
  const abilityProduces = normalizeManaAbilityProducedColors(ability?.produces);
  const normalizedSelectedAbilityText = normalizeManaAbilitySelectionText(selectedAbilityTextRaw || selectedAbilityFullTextRaw);
  const shouldPreferAbilityProduces = abilityProduces.length > 1 && (
    ability?.producesAllAtOnce === true ||
    manaProduction?.requiresColorChoice === true ||
    /\bor\b/i.test(normalizedSelectedAbilityText) ||
    abilityProduces.length > calculatedProduces.length
  );
  let produces = shouldPreferAbilityProduces
    ? abilityProduces
    : (calculatedProduces.length > 0 ? calculatedProduces : abilityProduces);

  const normalizedSelectionText = normalizeManaAbilitySelectionText(
    selectedAbilityTextRaw || selectedAbilityFullTextRaw,
  );
  const commanderRestrictedMana = /commander'?s?\s+color\s+identity/i.test(normalizedSelectionText);
  if (produces.length === 0 && (manaProduction?.requiresColorChoice === true || commanderRestrictedMana)) {
    if (abilityProduces.length > 0) {
      produces = abilityProduces;
    } else if (commanderRestrictedMana) {
      const commanderColorKeys = getCommanderColorIdentity(gameState, playerId);
      const commanderProduces = ['W', 'U', 'B', 'R', 'G'].filter((color) => {
        const key = ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' } as const)[color as 'W' | 'U' | 'B' | 'R' | 'G'];
        return commanderColorKeys.has(key);
      });
      if (commanderProduces.length > 0) {
        produces = commanderProduces;
      }
    }
  }

  const explicitSelectedChoiceAmount = getExplicitSelectedAnyColorManaAmount(selectedAbilityTextRaw || selectedAbilityFullTextRaw);
  const rawBaseAmount = explicitSelectedChoiceAmount
    ?? explicitSelectedManaProduction?.baseAmount
    ?? Number(manaProduction?.baseAmount || ability?.amount || 1);
  const baseAmount = Number.isFinite(rawBaseAmount) && rawBaseAmount > 0 ? rawBaseAmount : 1;
  const producesAllAtOnce = explicitSelectedManaProduction?.producesAllAtOnce ?? ((
    ability?.producesAllAtOnce === true ||
    (!ability && manaProduction?.requiresColorChoice !== true && produces.length > 1 && baseAmount === produces.length)
  ) && produces.length > 1);

  const shape = {
    ability,
    produces,
    baseAmount,
    producesAllAtOnce,
  };
  applyPermanentChosenColorManaOverride(
    permanent,
    selectedAbilityTextRaw,
    selectedAbilityFullTextRaw,
    shape,
  );
  return shape;
}

export function getChosenTypeManaSelectionFields(ability: any): {
  manaRestriction?: string;
  manaRestrictedTo?: string;
} {
  const spendRestriction = ability?.spendRestriction;
  if (!spendRestriction?.restriction) {
    return {};
  }
  return {
    manaRestriction: spendRestriction.restriction,
    manaRestrictedTo: spendRestriction.restrictedTo,
  };
}
