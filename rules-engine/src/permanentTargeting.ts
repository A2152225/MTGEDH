import type { BattlefieldPermanent } from '../../shared/src';
import { isBlockedByHexproofQuality } from './keywordAbilities/hexproof';
import { parseProtectionFromText, preventsFromTargeting } from './keywordAbilities/protection';
import { getCombinedPermanentText } from './permanentText';

export interface PermanentTargetingSourceInfo {
  readonly controllerId?: string;
  readonly colors?: readonly string[];
  readonly objectType?: 'spell' | 'ability';
}

export interface PermanentTargetingResult {
  readonly canTarget: boolean;
  readonly reason?: string;
}

const COLOR_NAME_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeColorSymbols(value: unknown): readonly string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    const parts = String(raw || '')
      .split(/(?:,|\/|\bor\b|\band\b)+/i)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const upper = part.toUpperCase();
      const normalized = ['W', 'U', 'B', 'R', 'G'].includes(upper)
        ? upper
        : COLOR_NAME_TO_SYMBOL[part.toLowerCase()];
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out;
}

function sourceTypeMatches(restriction: 'spell' | 'ability' | 'spell_or_ability', sourceType?: 'spell' | 'ability'): boolean {
  if (restriction === 'spell_or_ability') return true;
  return sourceType === restriction;
}

function isOpponentTargeting(permanent: BattlefieldPermanent | any, sourceControllerId?: string): boolean {
  const permanentController = String(
    (permanent as any)?.controller ||
      (permanent as any)?.controllerId ||
      (permanent as any)?.owner ||
      (permanent as any)?.ownerId ||
      ''
  ).trim();
  const sourceController = String(sourceControllerId || '').trim();
  return Boolean(permanentController && sourceController && permanentController !== sourceController);
}

function getColorQualifiedRestrictions(text: string): Array<{
  readonly colors: readonly string[];
  readonly objectType: 'spell' | 'ability' | 'spell_or_ability';
  readonly raw: string;
}> {
  const restrictions: Array<{
    readonly colors: readonly string[];
    readonly objectType: 'spell' | 'ability' | 'spell_or_ability';
    readonly raw: string;
  }> = [];

  const pattern = /can(?:not|'t)\s+be\s+the\s+targets?\s+of\s+([a-z ,/]+?)\s+(spells(?:\s+or\s+abilities)?|abilities)(?:\s+this\s+turn)?/gi;
  for (const match of text.matchAll(pattern)) {
    const colors = normalizeColorSymbols(String(match[1] || ''));
    if (colors.length === 0) continue;

    const rawObjectType = String(match[2] || '').toLowerCase();
    const objectType = rawObjectType.includes('spells') && rawObjectType.includes('abilities')
      ? 'spell_or_ability'
      : rawObjectType.includes('abilities')
        ? 'ability'
        : 'spell';

    restrictions.push({
      colors,
      objectType,
      raw: String(match[0] || '').trim(),
    });
  }

  return restrictions;
}

export function canTargetPermanent(
  permanent: BattlefieldPermanent | any,
  sourceInfo: PermanentTargetingSourceInfo,
): PermanentTargetingResult {
  if (!permanent) {
    return { canTarget: true };
  }

  const combinedText = normalizeText(getCombinedPermanentText(permanent));
  if (!combinedText) {
    return { canTarget: true };
  }

  const sourceColors = normalizeColorSymbols(sourceInfo.colors);
  const sourceType = sourceInfo.objectType;
  const opponentTargeting = isOpponentTargeting(permanent, sourceInfo.controllerId);

  const protectionAbilities = parseProtectionFromText(combinedText, String((permanent as any)?.id || ''));
  if (
    protectionAbilities.length > 0 &&
    preventsFromTargeting(protectionAbilities, { colors: sourceColors })
  ) {
    return {
      canTarget: false,
      reason: 'target has protection from the source',
    };
  }

  if (/\bshroud\b/i.test(combinedText)) {
    return {
      canTarget: false,
      reason: 'target has shroud',
    };
  }

  if (
    opponentTargeting &&
    (/\bhexproof\b(?!\s+from\b)/i.test(combinedText) ||
      /can(?:not|'t)\s+be\s+the\s+targets?\s+of\s+spells?\s+or\s+abilities?\s+your\s+opponents?\s+control/i.test(combinedText))
  ) {
    return {
      canTarget: false,
      reason: 'target has hexproof',
    };
  }

  if (opponentTargeting && sourceColors.length > 0) {
    const hexproofFromPattern = /\bhexproof\s+from\s+([a-z]+)\b/gi;
    for (const match of combinedText.matchAll(hexproofFromPattern)) {
      const quality = String(match[1] || '').trim().toLowerCase();
      if (!quality) continue;

      const blocked = sourceColors.some(color =>
        isBlockedByHexproofQuality(quality, color.toLowerCase(), color.toLowerCase())
      );
      if (blocked) {
        return {
          canTarget: false,
          reason: `target has hexproof from ${quality}`,
        };
      }
    }
  }

  for (const restriction of getColorQualifiedRestrictions(combinedText)) {
    if (!sourceTypeMatches(restriction.objectType, sourceType)) continue;
    if (sourceColors.some(color => restriction.colors.includes(color))) {
      return {
        canTarget: false,
        reason: restriction.raw,
      };
    }
  }

  return { canTarget: true };
}