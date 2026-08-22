import type { BattlefieldPermanent, ManaColor, PaymentItem } from '../../../shared/src';
import { parseSacrificeCost } from '../../../shared/src/textUtils';
import {
  getEffectiveBasicLandTypes,
  manaColorForBasicLandType,
  permanentAddsChosenBasicLandTypeToSelf,
} from '../../../shared/src/landTypes';
import { parseActivatedAbilities, type ParsedActivatedAbility } from './activatedAbilityParser';
import { canCreatureUseTapAbilityNow } from './creatureUtils';
import {
  calculateRemainingCostAfterFloatingMana,
  calculateSuggestedPayment,
  type RestrictedManaSpendPurpose,
  getTotalManaProduction,
  type ManaPool,
  type ManaPaymentSource,
} from './manaUtils';

type InlineSelectedPaymentAbility = {
  id: string;
  label: string;
  description: string;
  effect: string;
  cost: string;
  requiresTap: boolean;
  requiresUntap: boolean;
  requiresSacrifice: boolean;
  sacrificeType?: ParsedActivatedAbility['sacrificeType'] | 'self';
  sacrificeCount?: number;
  creatureSubtype?: string;
  mustBeOther?: boolean;
  manaCost?: string;
  lifeCost?: number;
  otherCosts?: string[];
  isManaAbility: boolean;
  isLoyaltyAbility: boolean;
  isFetchAbility: boolean;
  requiresTarget?: boolean;
};

type RepresentableManaEffect = {
  options: ManaColor[];
  amount: number;
  producedColors?: ManaColor[];
};

function escapeRegExp(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAbilitySentence(sentence: string): string {
  const trimmed = String(sentence || '').trim();
  if (trimmed.length < 2) return trimmed;

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
    if (/^(?:\{[^}]+\}|Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)/i.test(inner)) {
      return inner;
    }
  }

  return trimmed;
}

function isKnownBattlefieldCard(card: BattlefieldPermanent['card']): card is NonNullable<BattlefieldPermanent['card']> & { name: string } {
  return Boolean(card && typeof card === 'object' && 'name' in card && (card as any).name);
}

function supportsSequentialInlineActivationManaCost(manaCost?: string): boolean {
  const normalized = String(manaCost || '').trim();
  if (!normalized) return true;

  const tokens = normalized.match(/\{[^}]+\}/g) || [];
  if (tokens.length === 0) return true;

  return tokens.every((token) => /^\{(?:\d+|[WUBRGC])\}$/i.test(token));
}

function supportsInlineSelectedPaymentAbility(ability: InlineSelectedPaymentAbility): boolean {
  if (!ability.isManaAbility) return false;
  if (ability.isLoyaltyAbility || ability.isFetchAbility || ability.requiresTarget) return false;
  if (ability.requiresUntap) return false;
  if (!supportsSequentialInlineActivationManaCost(ability.manaCost)) return false;
  if (typeof ability.lifeCost === 'number' && ability.lifeCost > 0) return false;
  if (Array.isArray(ability.otherCosts) && ability.otherCosts.length > 0) return false;

  const normalizedCost = String(ability.cost || '').toLowerCase();
  if (/\bexert\b/.test(normalizedCost)) return false;
  if (/\breturn\b/.test(normalizedCost)) return false;
  if (/\bpay\b/.test(normalizedCost) && !/\bpay\s+\d+\s+life\b/.test(normalizedCost)) return false;

  return true;
}

function parseChosenColorManaEffect(
  effectText: string,
  chosenColor?: string,
): RepresentableManaEffect | null {
  const effect = String(effectText || '').trim();

  // Thriving lands: "Add {G} or one mana of the chosen color"
  const thrivingOrMatch = effect.match(
    /add\s+\{([WUBRGC])\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r/i,
  );
  if (thrivingOrMatch) {
    const colorMap: Record<string, ManaColor> = {
      white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
      w: 'W', u: 'U', b: 'B', r: 'R', g: 'G',
    };
    const fixed = String(thrivingOrMatch[1] || '').toUpperCase() as ManaColor;
    const normalizedChosen = String(chosenColor || '').trim().toLowerCase();
    const chosenSymbol = colorMap[normalizedChosen]
      || (['W', 'U', 'B', 'R', 'G'].includes(normalizedChosen.toUpperCase())
        ? normalizedChosen.toUpperCase() as ManaColor
        : null);
    const options: ManaColor[] = [fixed];
    if (chosenSymbol && chosenSymbol !== fixed) {
      options.push(chosenSymbol);
    }
    return { options, amount: 1 };
  }

  const match = effect.match(/add\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+colou?r/i);
  if (!match) return null;

  const colorMap: Record<string, ManaColor> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    w: 'W',
    u: 'U',
    b: 'B',
    r: 'R',
    g: 'G',
  };
  const normalizedChosen = String(chosenColor || '').trim().toLowerCase();
  const symbol = colorMap[normalizedChosen]
    || (['W', 'U', 'B', 'R', 'G'].includes(normalizedChosen.toUpperCase()) ? normalizedChosen.toUpperCase() as ManaColor : null);
  if (!symbol) return null;

  const rawAmount = String(match[1] || '').toLowerCase();
  const amount = rawAmount === 'a' || rawAmount === 'an' || rawAmount === 'one'
    ? 1
    : rawAmount === 'two'
      ? 2
      : rawAmount === 'three'
        ? 3
        : rawAmount === 'four'
          ? 4
          : rawAmount === 'five'
            ? 5
            : rawAmount === 'six'
              ? 6
              : rawAmount === 'seven'
                ? 7
                : rawAmount === 'eight'
                  ? 8
                  : rawAmount === 'nine'
                    ? 9
                    : rawAmount === 'ten'
                      ? 10
                      : Math.max(1, Number.parseInt(rawAmount, 10) || 1);

  return { options: [symbol], amount, producedColors: [symbol] };
}

function parseRepresentableManaEffect(effectText: string): RepresentableManaEffect | null {
  const effect = String(effectText || '').trim();
  if (!effect) return null;

  const firstSentence = effect.split('.')[0]?.trim() || effect;
  const lowerSentence = firstSentence.toLowerCase();

  if (/mana in any combination of colors/i.test(firstSentence)) {
    return null;
  }

  const anyColorMatch = firstSentence.match(/add\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+any\s+(?:one\s+)?color/i);
  if (anyColorMatch) {
    const rawAmount = String(anyColorMatch[1] || '').toLowerCase();
    const amount = rawAmount === 'a' || rawAmount === 'an' || rawAmount === 'one'
      ? 1
      : rawAmount === 'two'
        ? 2
        : rawAmount === 'three'
          ? 3
          : rawAmount === 'four'
            ? 4
            : rawAmount === 'five'
              ? 5
              : rawAmount === 'six'
                ? 6
                : rawAmount === 'seven'
                  ? 7
                  : rawAmount === 'eight'
                    ? 8
                    : rawAmount === 'nine'
                      ? 9
                      : rawAmount === 'ten'
                        ? 10
                        : Math.max(1, Number.parseInt(rawAmount, 10) || 1);

    return { options: ['W', 'U', 'B', 'R', 'G'], amount };
  }

  const anyTypeMatch = firstSentence.match(/add\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+any\s+type/i);
  if (anyTypeMatch) {
    const rawAmount = String(anyTypeMatch[1] || '').toLowerCase();
    const amount = rawAmount === 'a' || rawAmount === 'an' || rawAmount === 'one'
      ? 1
      : rawAmount === 'two'
        ? 2
        : rawAmount === 'three'
          ? 3
          : rawAmount === 'four'
            ? 4
            : rawAmount === 'five'
              ? 5
              : rawAmount === 'six'
                ? 6
                : rawAmount === 'seven'
                  ? 7
                  : rawAmount === 'eight'
                    ? 8
                    : rawAmount === 'nine'
                      ? 9
                      : rawAmount === 'ten'
                        ? 10
                        : Math.max(1, Number.parseInt(rawAmount, 10) || 1);

    return { options: ['W', 'U', 'B', 'R', 'G', 'C'], amount };
  }

  const symbolMatches = Array.from(firstSentence.matchAll(/\{([WUBRGC])\}/gi)).map((match) => String(match[1] || '').toUpperCase() as ManaColor);
  if (symbolMatches.length === 0) return null;

  const isChoicePattern = /\bor\b|,/.test(lowerSentence);
  if (isChoicePattern) {
    const uniqueOptions: ManaColor[] = [];
    for (const color of symbolMatches) {
      if (!uniqueOptions.includes(color)) {
        uniqueOptions.push(color);
      }
    }
    return uniqueOptions.length > 0 ? { options: uniqueOptions, amount: 1 } : null;
  }

  return {
    options: symbolMatches,
    amount: symbolMatches.length,
    producedColors: symbolMatches,
  };
}

function expandProducedColorsToAmount(producedColors: ManaColor[] | undefined, amount: number): ManaColor[] | undefined {
  const normalized = Array.isArray(producedColors)
    ? producedColors.filter((color): color is ManaColor => ['W', 'U', 'B', 'R', 'G', 'C'].includes(String(color || '').toUpperCase()))
    : [];

  if (normalized.length === 0) return undefined;

  const normalizedAmount = Math.max(1, Number(amount || normalized.length));
  if (normalized.length === normalizedAmount) {
    return [...normalized];
  }

  if (normalized.length === 1) {
    // Keep a single color entry — callers already have `amount` / manaAmount separately.
    // Expanding to thousands of identical colors hangs payment UI for Cradle/Three Tree.
    return [normalized[0]];
  }

  if (normalizedAmount % normalized.length !== 0) {
    return undefined;
  }

  const repeats = normalizedAmount / normalized.length;
  const expanded: ManaColor[] = [];
  for (let index = 0; index < repeats; index += 1) {
    expanded.push(...normalized);
  }

  return expanded;
}

function abilitySelfSacrificesSource(cardName: string, costText: string, ability: InlineSelectedPaymentAbility): boolean {
  if (ability.sacrificeType === 'self') return true;

  const normalizedCost = String(costText || '').trim();
  if (!/\bsacrifice\b/i.test(normalizedCost)) return false;

  if (/\bsacrifice\s+(?:this|~)\b/i.test(normalizedCost)) {
    return true;
  }

  const normalizedCardName = String(cardName || '').trim();
  if (!normalizedCardName) return false;

  return new RegExp(`\\bsacrifice\\s+${escapeRegExp(normalizedCardName)}\\b`, 'i').test(normalizedCost);
}

function getSacrificeCostForAbility(cardName: string, ability: InlineSelectedPaymentAbility): ManaPaymentSource['sacrificeCost'] | undefined {
  if (!ability.requiresSacrifice) return undefined;
  if (abilitySelfSacrificesSource(cardName, ability.cost, ability)) return undefined;
  if (!ability.sacrificeType) return undefined;
  if (ability.sacrificeType === 'self') return undefined;

  return {
    count: Math.max(1, Number(ability.sacrificeCount || 1)),
    permanentType: ability.sacrificeType,
    ...(ability.creatureSubtype ? { creatureSubtype: ability.creatureSubtype } : {}),
    ...(ability.mustBeOther ? { mustBeOther: true } : {}),
  };
}

function matchesSacrificeRequirement(
  candidate: BattlefieldPermanent,
  source: BattlefieldPermanent,
  playerId: string,
  sacrificeCost: NonNullable<ManaPaymentSource['sacrificeCost']>,
): boolean {
  if (!candidate || !isKnownBattlefieldCard(candidate.card)) return false;
  if (candidate.controller !== playerId) return false;
  if (sacrificeCost.mustBeOther && String(candidate.id || '') === String(source.id || '')) return false;

  const typeLine = String(candidate.card.type_line || '').toLowerCase();
  switch (sacrificeCost.permanentType) {
    case 'creature':
      if (!typeLine.includes('creature')) return false;
      if (sacrificeCost.creatureSubtype) {
        return typeLine.includes(String(sacrificeCost.creatureSubtype).toLowerCase());
      }
      return true;
    case 'artifact':
      return typeLine.includes('artifact');
    case 'enchantment':
      return typeLine.includes('enchantment');
    case 'land':
      return typeLine.includes('land');
    case 'permanent':
      return true;
    case 'artifact_or_creature':
      return typeLine.includes('artifact') || typeLine.includes('creature');
    case 'nonland_permanent':
      return !typeLine.includes('land');
    default:
      return false;
  }
}

function getSourceManaAmount(
  perm: BattlefieldPermanent,
  playerId: string,
  globalBattlefield: BattlefieldPermanent[],
  options: ManaColor[],
  baseAmount?: number,
): number {
  const printedAmount = typeof baseAmount === 'number' && baseAmount > 0
    ? baseAmount
    : getTotalManaProduction(options as any);
  const typeLine = String((perm.card?.type_line || '')).toLowerCase();
  const isLand = typeLine.includes('land');
  let multiplier = 1;
  let additiveBonus = 0;

  for (const effectPerm of globalBattlefield) {
    const effectName = String((effectPerm as any)?.card?.name || '').toLowerCase();
    const effectController = String((effectPerm as any)?.controller || '');

    if (isLand) {
      if (
        effectName.includes('mana flare') ||
        effectName.includes('heartbeat of spring') ||
        effectName.includes('dictate of karametra')
      ) {
        additiveBonus += 1;
      }

      if (
        effectController === playerId && (
          effectName.includes("mirari's wake") ||
          effectName.includes('zendikar resurgent') ||
          effectName.includes('vorinclex, voice of hunger')
        )
      ) {
        additiveBonus += 1;
      }
    }

    if (effectController === playerId) {
      if (effectName.includes('mana reflection')) {
        multiplier *= 2;
      }
      if (effectName.includes('nyxbloom ancient')) {
        multiplier *= 3;
      }
    }
  }

  return (printedAmount * multiplier) + additiveBonus;
}

function normalizeInlinePaymentAbilityId(ability: InlineSelectedPaymentAbility): string {
  if (/-ability-\d+$/i.test(String(ability.id || ''))) {
    return String(ability.id);
  }

  const normalizedEffect = String(ability.effect || '').trim().toLowerCase();
  if (ability.cost === '{T}' && normalizedEffect === 'add {w}') return 'native_w';
  if (ability.cost === '{T}' && normalizedEffect === 'add {u}') return 'native_u';
  if (ability.cost === '{T}' && normalizedEffect === 'add {b}') return 'native_b';
  if (ability.cost === '{T}' && normalizedEffect === 'add {r}') return 'native_r';
  if (ability.cost === '{T}' && normalizedEffect === 'add {g}') return 'native_g';
  if (ability.cost === '{T}' && normalizedEffect === 'add {c}') return 'native_c';
  if (ability.cost === '{T}' && /add\s+one\s+mana\s+of\s+any\s+color/i.test(ability.effect)) return 'native_any';
  if (ability.cost === '{T}' && /add\s+one\s+mana\s+of\s+any\s+type/i.test(ability.effect)) return 'native_any';
  // Thriving lands keep their printed ability id so both fixed + chosen colors remain available.
  if (
    ability.cost === '{T}'
    && /add\s+\{[wubrgc]\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r/i.test(ability.effect)
  ) {
    return String(ability.id);
  }
  if (ability.cost === '{T}' && /add\s+.+mana\s+of\s+the\s+chosen\s+colou?r/i.test(ability.effect)) return 'native_chosen_color';

  return String(ability.id);
}

function buildExplicitInlineManaAbilities(card: NonNullable<BattlefieldPermanent['card']> & { id?: string; name: string }): InlineSelectedPaymentAbility[] {
  const rawOracleText = String((card as any).oracle_text || '');
  // Shock lands print tap-mana in parentheses: "({T}: Add {G} or {U}.)".
  // Keep those lines (same as activatedAbilityParser) so duals appear in the cast payment UI.
  const parentheticalManaLines = Array.from(
    rawOracleText.matchAll(/\(\s*(\{T\}:\s*Add\s+[^)]+?)\.?\s*\)/gi),
  ).map((match) => String(match[1] || '').trim()).filter(Boolean);
  const oracleText = [
    rawOracleText.replace(/\([^)]*\)/g, '').trim(),
    ...parentheticalManaLines,
  ].filter(Boolean).join('\n');
  if (!oracleText.trim()) return [];

  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;
  const lines = oracleText
    .split(/\r?\n/)
    .map((line) => normalizeAbilitySentence(line))
    .filter(Boolean);

  const abilities: InlineSelectedPaymentAbility[] = [];
  let genericAbilityIndex = 0;

  for (const line of lines) {
    let costText = '';
    let effectText = '';

    const activatedMatch = line.match(activatedAbilityPattern);
    if (activatedMatch) {
      costText = String(activatedMatch[1] || '').trim();
      effectText = String(activatedMatch[2] || '').trim();
    } else {
      const textOnlyMatch = line.match(textOnlyActivatedAbilityPattern);
      if (!textOnlyMatch) continue;
      costText = String(textOnlyMatch[1] || '').trim();
      effectText = String(textOnlyMatch[2] || '').trim();
    }

    const currentAbilityId = `${String((card as any).id || card.name || 'card')}-ability-${genericAbilityIndex}`;
    genericAbilityIndex += 1;

    if (!/\badd\b/i.test(effectText)) continue;

    const manaSymbols = costText.match(/\{[^}]+\}/g) || [];
    const nonTapManaSymbols = manaSymbols.filter((symbol) => !/^\{t\}$/i.test(symbol));
    const sacrificeInfo = parseSacrificeCost(costText);
    const lifeCostMatch = costText.match(/\bpay\s+(\d+)\s+life\b/i);
    const otherCosts: string[] = [];
    if (/\bdiscard\b/i.test(costText)) otherCosts.push('discard');
    if (/\bexile\b/i.test(costText)) otherCosts.push('exile');
    if (/\bremove\b/i.test(costText)) otherCosts.push('remove');
    if (/\breturn\b/i.test(costText)) otherCosts.push('return');
    if (/\bexert\b/i.test(costText)) otherCosts.push('exert');

    abilities.push({
      id: currentAbilityId,
      label: effectText.split('.')[0]?.trim() || effectText,
      description: line,
      effect: effectText,
      cost: costText,
      requiresTap: /\{t\}/i.test(costText),
      requiresUntap: /\{q\}/i.test(costText),
      requiresSacrifice: sacrificeInfo.requiresSacrifice,
      sacrificeType: sacrificeInfo.sacrificeType,
      sacrificeCount: sacrificeInfo.sacrificeCount,
      creatureSubtype: sacrificeInfo.creatureSubtype,
      mustBeOther: sacrificeInfo.mustBeOther,
      manaCost: nonTapManaSymbols.length > 0 ? nonTapManaSymbols.join('') : undefined,
      lifeCost: lifeCostMatch ? Number.parseInt(String(lifeCostMatch[1] || '0'), 10) : undefined,
      otherCosts,
      isManaAbility: true,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      requiresTarget: /\btarget\b/i.test(effectText),
    });
  }

  return abilities;
}

function getInlineSelectedPaymentAbilities(perm: BattlefieldPermanent): InlineSelectedPaymentAbility[] {
  if (!isKnownBattlefieldCard(perm.card)) return [];

  const explicitAbilities = buildExplicitInlineManaAbilities(perm.card);
  // parseActivatedAbilities uses "-ability-N" ids for printed tap-mana lines (including
  // shock-land parentheticals). When explicit parsing already found mana abilities, skip
  // those ids to avoid duplicates. When explicit is empty (historically stripped
  // parentheticals, or missing oracle with only basic land types), keep them.
  const fallbackAbilities: InlineSelectedPaymentAbility[] = parseActivatedAbilities(perm.card, (perm as any).grantedAbilities, {
    permanent: perm,
  })
    .filter((ability) => ability.isManaAbility)
    .filter((ability) => {
      if (explicitAbilities.length === 0) return true;
      return !/-ability-\d+$/i.test(String(ability.id || ''));
    });

  const combined = [...explicitAbilities, ...fallbackAbilities];
  if (combined.length > 0 || !permanentAddsChosenBasicLandTypeToSelf(perm as any)) {
    return combined;
  }

  const chosenTypes = getEffectiveBasicLandTypes(perm as any);
  const manaColors = chosenTypes
    .map((landType) => manaColorForBasicLandType(landType))
    .filter((color): color is Exclude<ManaColor, 'C'> => color !== null);
  if (manaColors.length === 0) return combined;

  const symbols = manaColors.map((color) => `{${color}}`).join(' or ');
  return [{
    id: `${String((perm.card as any).id || perm.card.name || 'card')}-chosen-basic-land`,
    label: `Add ${symbols}`,
    description: `{T}: Add ${symbols}.`,
    effect: `Add ${symbols}.`,
    cost: '{T}',
    requiresTap: true,
    requiresUntap: false,
    requiresSacrifice: false,
    isManaAbility: true,
    isLoyaltyAbility: false,
    isFetchAbility: false,
  }];
}

function buildInlineManaSourcesForPermanent(
  perm: BattlefieldPermanent,
  playerId: string,
  globalBattlefield: BattlefieldPermanent[],
  playerBattlefield: BattlefieldPermanent[],
): ManaPaymentSource[] {
  if (!isKnownBattlefieldCard(perm.card)) return [];

  const card = perm.card;
  const typeLine = String(card.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const parsedAbilities = getInlineSelectedPaymentAbilities(perm);
  const sources: ManaPaymentSource[] = [];

  for (const ability of parsedAbilities) {
    if (!supportsInlineSelectedPaymentAbility(ability)) continue;
    if (isCreature && ability.requiresTap && !canCreatureUseTapAbilityNow(perm, globalBattlefield)) continue;

    const parsedEffect = parseChosenColorManaEffect(ability.effect, (perm as any).chosenColor)
      || parseRepresentableManaEffect(ability.effect);
    if (!parsedEffect) continue;

    const sacrificeCost = getSacrificeCostForAbility(card.name, ability);
    if (ability.requiresSacrifice && !abilitySelfSacrificesSource(card.name, ability.cost, ability) && !sacrificeCost) {
      continue;
    }

    const repeatCount = sacrificeCost
      ? Math.max(
          0,
          Math.floor(
            playerBattlefield.filter((candidate) => matchesSacrificeRequirement(candidate, perm, playerId, sacrificeCost)).length
            / Math.max(1, sacrificeCost.count),
          ),
        )
      : 1;

    if (sacrificeCost && repeatCount <= 0) continue;

    const normalizedAbilityId = normalizeInlinePaymentAbilityId(ability);
    const amountFromPermanent = Number((perm as any).manaAmount || 0);
    const computedAmount = getSourceManaAmount(
      perm,
      playerId,
      globalBattlefield,
      parsedEffect.options,
      Math.max(parsedEffect.amount, amountFromPermanent || 0) || undefined,
    );
    const producedColors = expandProducedColorsToAmount(parsedEffect.producedColors, computedAmount);
    const isMixedFixedBundle = Array.isArray(parsedEffect.producedColors) && new Set(parsedEffect.producedColors).size > 1;
    if (isMixedFixedBundle && !producedColors) {
      continue;
    }
    const actualSourceId = String(perm.id || '');
    const sourceBaseId = `${actualSourceId}::${normalizedAbilityId}`;
    const instanceCount = Math.max(1, repeatCount);
    const consumable = abilitySelfSacrificesSource(card.name, ability.cost, ability) ? true : undefined;

    for (let index = 0; index < instanceCount; index += 1) {
      const sourceId = instanceCount > 1 ? `${sourceBaseId}#${index}` : sourceBaseId;
      sources.push({
        id: sourceId,
        sourcePermanentId: actualSourceId,
        abilityId: normalizedAbilityId,
        name: card.name,
        label: ability.label,
        options: parsedEffect.options,
        ...(Array.isArray(producedColors) && producedColors.length > 0 ? { producedColors } : {}),
        ...(typeof consumable === 'boolean' ? { consumable } : {}),
        ...(sacrificeCost ? { sacrificeCost } : {}),
        ...(computedAmount > 1 ? { amount: computedAmount } : {}),
      });
    }
  }

  return sources;
}

export function buildAvailableManaSourcesForPlayer(
  playerId: string,
  battlefield: BattlefieldPermanent[],
  options?: { excludePermanentIds?: string[] },
): ManaPaymentSource[] {
  const globalBattlefield = Array.isArray(battlefield) ? battlefield : [];
  const playerBattlefield = globalBattlefield.filter((perm) => perm.controller === playerId);
  const excludedPermanentIds = new Set(
    (Array.isArray(options?.excludePermanentIds) ? options.excludePermanentIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const sources: ManaPaymentSource[] = [];

  for (const perm of playerBattlefield) {
    if (!perm || perm.tapped) continue;
    if (excludedPermanentIds.has(String(perm.id || ''))) continue;
    sources.push(...buildInlineManaSourcesForPermanent(perm, playerId, globalBattlefield, playerBattlefield));
  }

  return sources;
}

export function getSourcePermanentId(source: ManaPaymentSource): string {
  return String(source.sourcePermanentId || source.id || '');
}

export function createPaymentItemFromSource(
  source: ManaPaymentSource,
  mana: ManaColor,
  sacrificedPermanentIds?: string[],
): PaymentItem {
  const count = typeof source.amount === 'number' && source.amount > 0
    ? source.amount
    : getTotalManaProduction(source.options);
  const actualPermanentId = getSourcePermanentId(source);

  return {
    permanentId: actualPermanentId,
    ...(source.id !== actualPermanentId ? { paymentSourceId: source.id } : {}),
    ...(source.abilityId ? { abilityId: source.abilityId } : {}),
    mana,
    ...(Array.isArray(source.producedColors) && source.producedColors.length > 0 ? { producedColors: source.producedColors } : {}),
    count,
    ...(Array.isArray(sacrificedPermanentIds) && sacrificedPermanentIds.length > 0 ? { sacrificedPermanentIds } : {}),
  };
}

export function createSuggestedPaymentItem(
  sourceId: string,
  selection: { color: ManaColor; count: number },
  sourceById: ReadonlyMap<string, ManaPaymentSource>,
): PaymentItem {
  const source = sourceById.get(sourceId);
  if (!source) {
    return {
      permanentId: sourceId,
      mana: selection.color,
      count: selection.count,
    };
  }

  return createPaymentItemFromSource(source, selection.color);
}

const POOL_KEY_TO_MANA_COLOR: Record<string, ManaColor> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

function buildExplicitPoolPaymentItems(
  floatingMana: ManaPool | undefined,
  usedFromPool: Record<string, number>,
): PaymentItem[] {
  if (!floatingMana) return [];

  const items: PaymentItem[] = [];
  for (const [poolKey, totalUsed] of Object.entries(usedFromPool)) {
    const mana = POOL_KEY_TO_MANA_COLOR[poolKey];
    const needed = Number(totalUsed || 0);
    if (!mana || needed <= 0) continue;

    let remaining = needed;
    const regularAvailable = Number((floatingMana as any)[poolKey] || 0);
    const fromRegular = Math.min(regularAvailable, remaining);
    if (fromRegular > 0) {
      // One payment row with count — never expand thousands of __pool__ items.
      items.push({
        permanentId: `__pool__:${poolKey}`,
        mana,
        count: fromRegular,
      });
      remaining -= fromRegular;
    }

    if (remaining <= 0 || !floatingMana.restricted) continue;

    for (let restrictedIndex = 0; restrictedIndex < floatingMana.restricted.length; restrictedIndex += 1) {
      const entry = floatingMana.restricted[restrictedIndex];
      const entryPoolKey = String(entry?.type || 'colorless');
      if (entryPoolKey !== poolKey) continue;

      const entryAmount = Number(entry?.amount || 0);
      const take = Math.min(Math.max(0, entryAmount), remaining);
      if (take <= 0) continue;
      items.push({
        permanentId: `__pool__:restricted:${restrictedIndex}`,
        mana,
        count: take,
      });
      remaining -= take;
      if (remaining <= 0) break;
    }
  }

  return items;
}

/**
 * Build explicit payment items for spell/ability payment UI.
 * Applies floating mana first, then taps only for the remainder.
 * When includeExplicitPoolItems is true, emits __pool__ payment rows for mana spent from the pool.
 */
export function buildSuggestedPaymentItems(
  cost: { colors: Record<ManaColor, number>; generic: number; hybrids: ManaColor[][] },
  sources: ManaPaymentSource[],
  colorsToPreserve: Set<ManaColor>,
  floatingMana?: ManaPool,
  options?: { includeExplicitPoolItems?: boolean; purpose?: RestrictedManaSpendPurpose | null },
): PaymentItem[] {
  const purpose = options?.purpose;
  const { colors, generic, hybrids, usedFromPool } = calculateRemainingCostAfterFloatingMana(cost, floatingMana, purpose);
  const includeExplicitPoolItems = options?.includeExplicitPoolItems === true;
  const sourcesForSuggestion = includeExplicitPoolItems
    ? sources.filter((source) => !String(source.id || '').startsWith('__pool__'))
    : sources;
  const suggested = calculateSuggestedPayment(
    { colors, generic, hybrids },
    sourcesForSuggestion,
    colorsToPreserve,
    undefined,
    purpose,
  );

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const items: PaymentItem[] = [];

  if (includeExplicitPoolItems) {
    items.push(...buildExplicitPoolPaymentItems(floatingMana, usedFromPool));
  }

  for (const [sourceId, selection] of suggested.entries()) {
    items.push(createSuggestedPaymentItem(sourceId, selection, sourceById));
  }

  const dedupedItems: PaymentItem[] = [];
  const seenTapPermanentIds = new Set<string>();
  const seenPoolPermanentIds = new Set<string>();
  for (const item of items) {
    const permanentId = String(item.permanentId || '');
    if (permanentId.startsWith('__pool__')) {
      if (seenPoolPermanentIds.has(permanentId)) {
        continue;
      }
      seenPoolPermanentIds.add(permanentId);
      dedupedItems.push(item);
      continue;
    }
    if (seenTapPermanentIds.has(permanentId)) {
      continue;
    }
    seenTapPermanentIds.add(permanentId);
    dedupedItems.push(item);
  }

  return dedupedItems;
}