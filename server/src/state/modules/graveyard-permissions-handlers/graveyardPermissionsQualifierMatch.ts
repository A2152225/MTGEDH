// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: qualifierMatchesCard plus exclusive helpers getCardColors and
//   splitTypeWordList.
// Public entry symbols: qualifierMatchesCard, getCardColors, splitTypeWordList.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import {
  escapeRegExp,
  getTypeLine,
  isInstantOrSorcery,
  isLesson,
  normalizeText,
  parseSmallNumber,
} from "./graveyardPermissionsCardUtils.js";

export function getCardColors(card: any): string[] {
  const rawColors = Array.isArray(card?.colors)
    ? card.colors
    : Array.isArray(card?.color_identity)
      ? card.color_identity
      : [];
  return rawColors.map((color: any) => String(color || '').toUpperCase()).filter(Boolean);
}

export function splitTypeWordList(value: string): string[] {
  return normalizeText(value)
    .replace(/\band\/or\b/g, ',')
    .replace(/\band\b|\bor\b/g, ',')
    .split(',')
    .map((entry) => entry.replace(/\b(?:a|an|card|cards)\b/g, '').trim())
    .filter(Boolean);
}

export function qualifierMatchesCard(qualifier: string, card: any): boolean {
  const normalized = normalizeText(qualifier).replace(/non\s*-/g, 'non-');
  const typeLine = getTypeLine(card);
  const lesson = isLesson(card);
  const typeWords = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle'];

  if (/\bnon-lesson\b/.test(normalized) && lesson) {
    return false;
  }

  if (/\blesson\b/.test(normalized) && !/\bnon-lesson\b/.test(normalized)) {
    return lesson;
  }

  if ((/\binstant\b/.test(normalized) || /\bsorcery\b/.test(normalized)) && !isInstantOrSorcery(card)) {
    return false;
  }

  if (/\bpermanent\b/.test(normalized) && isInstantOrSorcery(card)) {
    return false;
  }

  for (const typeWord of typeWords) {
    const typePattern = new RegExp(`\\b${typeWord}\\b`);
    const nonTypePattern = new RegExp(`\\bnon-?${typeWord}\\b`);
    if (nonTypePattern.test(normalized)) {
      if (typePattern.test(typeLine)) {
        return false;
      }
      continue;
    }

    if (typePattern.test(normalized) && !typePattern.test(typeLine)) {
      return false;
    }
  }

  const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const mentionedColors = Object.keys(colorMap).filter((color) => new RegExp(`\\b${color}\\b`).test(normalized));
  if (mentionedColors.length > 0) {
    const cardColors = getCardColors(card);
    if (!mentionedColors.some((color) => cardColors.includes(colorMap[color]))) {
      return false;
    }
  }

  const exactColorCountMatch = normalized.match(/\bexactly\s+(one|two|three|four|five|\d+)\s+colors?\b/);
  if (exactColorCountMatch) {
    const expectedColorCount = parseSmallNumber(exactColorCountMatch[1]);
    if (expectedColorCount > 0 && getCardColors(card).length !== expectedColorCount) {
      return false;
    }
  }

  const subtypeChoiceMatch = normalized.match(/\bthat(?:'s| is)\s+an?\s+(.+)$/);
  if (subtypeChoiceMatch?.[1]) {
    const choices = splitTypeWordList(subtypeChoiceMatch[1]);
    if (choices.length > 0 && !choices.some((choice) => new RegExp(`\\b${escapeRegExp(choice)}\\b`).test(typeLine))) {
      return false;
    }
  }

  const baseQualifier = normalized
    .replace(/\bthat(?:'s| is)\s+(?:an?\s+)?.+$/, '')
    .replace(/\bnon-?(?:artifact|creature|enchantment|land|planeswalker|battle)\b/g, '');
  const leadingQualifier = baseQualifier
    .replace(/\bnon-lesson\b/g, '')
    .replace(/\b(?:instant|sorcery|artifact|creature|enchantment|land|planeswalker|battle|permanent|spell|spells|card|cards|each|exactly|one|two|three|four|five|colors?)\b/g, ' ')
    .replace(/\b(?:white|blue|black|red|green)\b/g, ' ')
    .replace(/\b(?:and|or|and\/or|a|an)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .trim();

  const requiredLeadingWords = leadingQualifier.split(/\s+/).filter((word) => word.length > 2);
  if (requiredLeadingWords.length > 0) {
    const requiresAnyLeadingWord = requiredLeadingWords.length > 1 && !typeWords.some((typeWord) => new RegExp(`\\b${typeWord}\\b`).test(baseQualifier));
    const matchesLeadingWords = requiresAnyLeadingWord
      ? requiredLeadingWords.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(typeLine))
      : requiredLeadingWords.every((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(typeLine));
    if (!matchesLeadingWords) return false;
  }

  return true;
}

