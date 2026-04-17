import type { BattlefieldPermanent, ManaColor, PaymentItem } from '../../../shared/src';
import { parseSacrificeCost } from '../../../shared/src/textUtils';
import { parseActivatedAbilities, type ParsedActivatedAbility } from './activatedAbilityParser';
import { canCreatureUseTapAbilityNow } from './creatureUtils';
import { getTotalManaProduction, type ManaPaymentSource } from './manaUtils';

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
    return Array.from({ length: normalizedAmount }, () => normalized[0]);
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

  return String(ability.id);
}

function buildExplicitInlineManaAbilities(card: NonNullable<BattlefieldPermanent['card']> & { id?: string; name: string }): InlineSelectedPaymentAbility[] {
  const oracleText = String((card as any).oracle_text || '').trim();
  if (!oracleText) return [];

  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;
  const lines = oracleText
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
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
  const fallbackAbilities: InlineSelectedPaymentAbility[] = parseActivatedAbilities(perm.card, (perm as any).grantedAbilities)
    .filter((ability) => ability.isManaAbility && !/-ability-\d+$/i.test(String(ability.id || '')));

  return [...explicitAbilities, ...fallbackAbilities];
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

    const parsedEffect = parseRepresentableManaEffect(ability.effect);
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
): ManaPaymentSource[] {
  const globalBattlefield = Array.isArray(battlefield) ? battlefield : [];
  const playerBattlefield = globalBattlefield.filter((perm) => perm.controller === playerId);
  const sources: ManaPaymentSource[] = [];

  for (const perm of playerBattlefield) {
    if (!perm || perm.tapped) continue;
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