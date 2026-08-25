/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: pushUniqueParsedAbility, normalizeGrantedActivatedAbilityText,
 * buildParsedAbilityFromGrantedLine, appendGrantedActivatedAbilities.
 *
 * Public entry symbols: appendGrantedActivatedAbilities, pushUniqueParsedAbility,
 * normalizeGrantedActivatedAbilityText, buildParsedAbilityFromGrantedLine.
 */

import { isGrantedActivatedAbilityText } from '../../../../shared/src/attachmentAbilityGrants';
import type { ParsedActivatedAbility } from './activatedAbilityParserTypes';
import { parseCostComponents } from './parseActivatedAbilityCostAndMill';
import { parseManaProduction } from './parseManaProduction';

export function pushUniqueParsedAbility(abilities: ParsedActivatedAbility[], ability: ParsedActivatedAbility) {
  const normalizeKey = (entry: ParsedActivatedAbility) => {
    const cost = String(entry.cost || '').toLowerCase().trim();
    const effect = String(entry.effect || '')
      .toLowerCase()
      .replace(/this mana can['\u2019]?t be spent to cast a nonartifact spell\.?/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.;]+$/g, '');
    return `${cost}=>${effect}`;
  };
  const key = normalizeKey(ability);
  const exists = abilities.some((entry) => normalizeKey(entry) === key);
  if (!exists) {
    abilities.push(ability);
  }
}

export function normalizeGrantedActivatedAbilityText(entry: string): string | null {
  const raw = String(entry || '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (lower === 'tap_for_any_color') {
    return '{T}: Add one mana of any color.';
  }
  if (lower === 'tap_for_green') {
    return '{T}: Add {G}.';
  }
  if (lower === 'tap_for_white') {
    return '{T}: Add {W}.';
  }
  if (lower === 'tap_for_blue') {
    return '{T}: Add {U}.';
  }
  if (lower === 'tap_for_black') {
    return '{T}: Add {B}.';
  }
  if (lower === 'tap_for_red') {
    return '{T}: Add {R}.';
  }

  const quoted = raw.match(/["“”]([^"“”]*:[^"“”]*)["“”]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  if (raw.includes(':') && (raw.includes('{T}') || /^(Sacrifice|Discard|Pay|Exile|Remove|Tap|Untap)\b/i.test(raw))) {
    return raw;
  }

  return null;
}

export function buildParsedAbilityFromGrantedLine(
  cardId: string,
  grantedIndex: number,
  grantedText: string,
): ParsedActivatedAbility | null {
  const text = String(grantedText || '').trim();
  if (!text || !isGrantedActivatedAbilityText(text)) return null;

  const colon = text.indexOf(':');
  if (colon < 0) return null;
  const costPart = text.slice(0, colon).trim();
  const effectPart = text.slice(colon + 1).trim().replace(/\.$/, '');
  if (!costPart || !effectPart) return null;

  const costComponents = parseCostComponents(costPart);
  const manaProduced = parseManaProduction(effectPart);
  const isManaAbility = !!manaProduced && !/\btarget\b/i.test(effectPart);
  const requiresTarget = /\btarget\b/i.test(effectPart);
  let targetDescription: string | undefined;
  if (requiresTarget) {
    const targetMatch = effectPart.match(/target\s+([^.]+)/i);
    if (targetMatch) targetDescription = targetMatch[1].trim();
  }

  let label: string;
  if (isManaAbility) {
    label = `Add ${manaProduced}`;
  } else if (requiresTarget) {
    const shortEffect = effectPart.split('.')[0];
    label = shortEffect.length <= 36 ? shortEffect : (targetDescription ? `Target ${targetDescription.split(' ').slice(0, 3).join(' ')}` : 'Activated ability');
  } else {
    const shortEffect = effectPart.split('.')[0];
    label = shortEffect.length <= 36 ? shortEffect : `${effectPart.split(' ').slice(0, 5).join(' ')}…`;
  }

  return {
    id: `${cardId}-granted-${grantedIndex}`,
    label,
    description: effectPart,
    cost: costPart,
    effect: effectPart,
    ...costComponents,
    isManaAbility,
    isLoyaltyAbility: false,
    isFetchAbility: false,
    requiresTarget,
    targetDescription,
  };
}

export function appendGrantedActivatedAbilities(
  abilities: ParsedActivatedAbility[],
  grantedAbilities: readonly string[] | undefined,
  cardId: string,
): void {
  if (!Array.isArray(grantedAbilities) || grantedAbilities.length === 0) return;

  let grantedIndex = 0;
  for (const entry of grantedAbilities) {
    const grantedText = normalizeGrantedActivatedAbilityText(String(entry || ''));
    if (!grantedText) continue;

    // Allow trailing restriction text (Powerstone / Vibranium).
    const manaMatch = grantedText.match(/^\{T\}\s*:\s*Add\s+(.+?)(?:\.|$)/i);
    if (manaMatch) {
      const producedText = manaMatch[1].trim();
      const normalizedProduced = producedText.toLowerCase();
      const singleColorSymbol = producedText.match(/^\{([WUBRGC])\}/i)?.[1]?.toUpperCase();
      const nativeId = normalizedProduced.includes('any color')
        ? 'native_any'
        : singleColorSymbol
          ? `native_${singleColorSymbol.toLowerCase()}`
          : null;

      if (nativeId) {
        const label = normalizedProduced.includes('any color')
          ? 'Tap for any color'
          : `Tap for {${singleColorSymbol}}`;
        const description = normalizedProduced.includes('any color')
          ? 'Add one mana of any color'
          : `Add ${producedText}`;

        pushUniqueParsedAbility(abilities, {
          id: nativeId,
          label,
          description,
          cost: '{T}',
          effect: `Add ${producedText.replace(/\.$/, '')}`,
          requiresTap: true,
          requiresUntap: false,
          requiresSacrifice: false,
          isManaAbility: true,
          isLoyaltyAbility: false,
          isFetchAbility: false,
        });
        grantedIndex += 1;
        continue;
      }
    }

    const parsed = buildParsedAbilityFromGrantedLine(cardId, grantedIndex, grantedText);
    grantedIndex += 1;
    if (parsed) {
      pushUniqueParsedAbility(abilities, parsed);
    }
  }
}
