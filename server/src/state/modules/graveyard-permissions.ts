import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";

export interface GrantedFlashbackInfo {
  hasIt: boolean;
  cost?: string;
  sourceId?: string;
  sourceName?: string;
}

export interface GrantedUnearthInfo {
  hasIt: boolean;
  cost?: string;
  sourceId?: string;
  sourceName?: string;
}

export interface GrantedGraveyardKeywordInfo {
  hasIt: boolean;
  cost?: string;
  additionalExileCount?: number;
  sourceId?: string;
  sourceName?: string;
}

type GraveyardGrantKeyword = 'flashback' | 'unearth' | 'jump-start' | 'retrace' | 'escape';

function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSmallNumber(value: string): number {
  const normalized = normalizeText(value);
  const wordValues: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (wordValues[normalized]) return wordValues[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPlayersTurn(state: any, playerId: PlayerID): boolean {
  return String(state?.turnPlayer || state?.activePlayer || '') === String(playerId || '');
}

function getTypeLine(card: any): string {
  return normalizeText(card?.type_line || card?.typeLine);
}

function isInstantOrSorcery(card: any): boolean {
  const typeLine = getTypeLine(card);
  return /\binstant\b/.test(typeLine) || /\bsorcery\b/.test(typeLine);
}

function isLesson(card: any): boolean {
  return /\blesson\b/.test(getTypeLine(card));
}

function getManaCost(card: any): string {
  return String(card?.mana_cost || card?.manaCost || '').trim();
}

function getCardColors(card: any): string[] {
  const rawColors = Array.isArray(card?.colors)
    ? card.colors
    : Array.isArray(card?.color_identity)
      ? card.color_identity
      : [];
  return rawColors.map((color: any) => String(color || '').toUpperCase()).filter(Boolean);
}

function splitTypeWordList(value: string): string[] {
  return normalizeText(value)
    .replace(/\band\/or\b/g, ',')
    .replace(/\band\b|\bor\b/g, ',')
    .split(',')
    .map((entry) => entry.replace(/\b(?:a|an|card|cards)\b/g, '').trim())
    .filter(Boolean);
}

function qualifierMatchesCard(qualifier: string, card: any): boolean {
  const normalized = normalizeText(qualifier).replace(/non\s*-/g, 'non-');
  const typeLine = getTypeLine(card);
  const lesson = isLesson(card);

  if (/\bnon-lesson\b/.test(normalized) && lesson) {
    return false;
  }

  if (/\blesson\b/.test(normalized) && !/\bnon-lesson\b/.test(normalized)) {
    return lesson;
  }

  if ((/\binstant\b/.test(normalized) || /\bsorcery\b/.test(normalized)) && !isInstantOrSorcery(card)) {
    return false;
  }

  const typeWords = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle'];
  for (const typeWord of typeWords) {
    if (new RegExp(`\\b${typeWord}\\b`).test(normalized) && !new RegExp(`\\b${typeWord}\\b`).test(typeLine)) {
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

  const baseQualifier = normalized.replace(/\bthat(?:'s| is)\s+(?:an?\s+)?.+$/, '');
  const leadingQualifier = baseQualifier
    .replace(/\bnon-lesson\b/g, '')
    .replace(/\b(?:instant|sorcery|artifact|creature|enchantment|land|planeswalker|battle|card|cards|each|exactly|one|two|three|four|five|colors?)\b/g, ' ')
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

function extractGrantedKeywordCost(keyword: GraveyardGrantKeyword, remainder: string, fullOracleText: string, card: any): string | undefined {
  const explicitCost = String(remainder || '').match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)/);
  if (explicitCost?.[1]) {
    return explicitCost[1].trim();
  }

  if (keyword === 'jump-start' || keyword === 'retrace') {
    const manaCost = getManaCost(card);
    return manaCost || undefined;
  }

  if (new RegExp(`${escapeRegExp(keyword)} cost is equal to (?:that card's|its|the card's) mana cost`, 'i').test(fullOracleText)) {
    const manaCost = getManaCost(card);
    return manaCost || undefined;
  }

  return undefined;
}

function extractAdditionalEscapeExileCount(fullOracleText: string): number | undefined {
  const exileMatch = String(fullOracleText || '').match(/exil(?:e|ing)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?\s+from\s+your\s+graveyard/i);
  if (!exileMatch?.[1]) return undefined;
  const count = parseSmallNumber(exileMatch[1]);
  return count > 0 ? count : undefined;
}

function findGrantedKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  keyword: GraveyardGrantKeyword,
): GrantedGraveyardKeywordInfo {
  try {
    const state = (ctx as any)?.state;
    if (!state || !card || typeof card === 'string') return { hasIt: false };

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const keywordPattern = escapeRegExp(keyword);
    for (const permanent of battlefield) {
      if (!permanent || permanent.phasedOut) continue;
      if (String(permanent.controller || '') !== String(playerId || '')) continue;

      const oracleText = String(permanent.card?.oracle_text || permanent.card?.oracleText || '');
      if (!new RegExp(keywordPattern, 'i').test(oracleText) || !/graveyard/i.test(oracleText)) continue;
      if (/\bduring your turn\b/i.test(oracleText) && !isPlayersTurn(state, playerId)) continue;

      const lines = oracleText.split(/\r?\n/);
      for (const line of lines) {
        if (/\bgains?\b/i.test(line)) continue;

        const grantPatterns = [
          new RegExp(`\\beach\\s+(.+?)\\s+cards?\\s+in\\s+your\\s+graveyard(?:\\s+that(?:'s| is)\\s+(.+?))?\\s+ha(?:s|ve)\\s+${keywordPattern}\\b([^.]*)`, 'i'),
          new RegExp(`^\\s*(.+?)\\s+cards?\\s+in\\s+your\\s+graveyard(?:\\s+that(?:'s| is)\\s+(.+?))?\\s+ha(?:s|ve)\\s+${keywordPattern}\\b([^.]*)`, 'i'),
        ];
        const grantMatch = grantPatterns.map((pattern) => line.match(pattern)).find(Boolean);
        if (!grantMatch) continue;

        const qualifier = grantMatch[2]
          ? `${grantMatch[1]} that's ${grantMatch[2]}`
          : grantMatch[1];
        if (!qualifierMatchesCard(qualifier, card)) continue;

        const cost = extractGrantedKeywordCost(keyword, grantMatch[3] || '', oracleText, card);
        if (!cost) continue;

        return {
          hasIt: true,
          cost,
          ...(keyword === 'escape' ? { additionalExileCount: extractAdditionalEscapeExileCount(oracleText) } : {}),
          sourceId: String(permanent.id || permanent.card?.id || ''),
          sourceName: String(permanent.card?.name || permanent.name || `${keyword} grant`),
        };
      }
    }

    return { hasIt: false };
  } catch {
    return { hasIt: false };
  }
}

export function getPrintedUnearthInfo(card: any): GrantedUnearthInfo {
  if (!card || typeof card === 'string') return { hasIt: false };

  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  if (!/\bunearth\b/i.test(oracleText)) return { hasIt: false };

  const costMatch = oracleText.match(/unearth\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return {
    hasIt: true,
    ...(costMatch?.[1] ? { cost: costMatch[1].trim() } : {}),
  };
}

export function getGrantedFlashbackInfo(ctx: GameContext, playerId: PlayerID, card: any): GrantedFlashbackInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, 'flashback') as GrantedFlashbackInfo;
}

export function getGrantedUnearthInfo(ctx: GameContext, playerId: PlayerID, card: any): GrantedUnearthInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, 'unearth') as GrantedUnearthInfo;
}

export function getGrantedCastFromGraveyardKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  keyword: 'flashback' | 'jump-start' | 'retrace' | 'escape',
): GrantedGraveyardKeywordInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, keyword);
}