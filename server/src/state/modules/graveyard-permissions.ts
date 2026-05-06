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

export interface TemporaryGraveyardKeywordGrant {
  playerId: string;
  cardId: string;
  keyword: GraveyardGrantKeyword;
  cost?: string;
  additionalExileCount?: number;
  sourceId?: string;
  sourceName?: string;
  expiresAt: 'end_of_turn' | 'this_turn';
  turnApplied?: number;
}

export type GraveyardGrantKeyword = 'flashback' | 'unearth' | 'jump-start' | 'retrace' | 'escape' | 'embalm';

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

function getCardId(card: any): string {
  return String(card?.id || '').trim();
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

function getTemporaryGraveyardKeywordGrants(state: any): TemporaryGraveyardKeywordGrant[] {
  return Array.isArray(state?.temporaryGraveyardKeywordGrants)
    ? state.temporaryGraveyardKeywordGrants
    : [];
}

function findTemporaryGrantedKeywordInfo(
  state: any,
  playerId: PlayerID,
  card: any,
  keyword: GraveyardGrantKeyword,
): GrantedGraveyardKeywordInfo {
  const cardId = getCardId(card);
  if (!state || !cardId) return { hasIt: false };

  const grant = getTemporaryGraveyardKeywordGrants(state).find((entry) =>
    entry
    && String(entry.playerId || '') === String(playerId || '')
    && String(entry.cardId || '') === cardId
    && String(entry.keyword || '') === keyword
  );

  if (!grant) return { hasIt: false };

  return {
    hasIt: true,
    cost: grant.cost,
    additionalExileCount: grant.additionalExileCount,
    sourceId: grant.sourceId,
    sourceName: grant.sourceName,
  };
}

function normalizeGrantKeyword(value: string): GraveyardGrantKeyword | undefined {
  const normalized = normalizeText(value).replace(/\s+/g, '-');
  if (['flashback', 'unearth', 'jump-start', 'retrace', 'escape', 'embalm'].includes(normalized)) {
    return normalized as GraveyardGrantKeyword;
  }
  return undefined;
}

function extractKeywordGrantFromAbilityText(rawAbilityText: string): { keyword?: GraveyardGrantKeyword; remainder: string } {
  const text = String(rawAbilityText || '').trim();
  if (!text) return { remainder: '' };

  const match = text.match(/\b(flashback|unearth|jump-start|retrace|escape|embalm)\b\s*[—-]?\s*([^.]*)/i);
  const keyword = match?.[1] ? normalizeGrantKeyword(match[1]) : undefined;
  return {
    keyword,
    remainder: String(match?.[2] || text).trim(),
  };
}

function getGraveyardCardsForTemporaryGrant(state: any, playerId: PlayerID, qualifier: string, targetIds?: string[]): any[] {
  const graveyard = state?.zones?.[playerId]?.graveyard;
  if (!Array.isArray(graveyard)) return [];

  const targetIdSet = Array.isArray(targetIds) && targetIds.length > 0
    ? new Set(targetIds.map((id) => String(id || '').trim()).filter(Boolean))
    : null;

  return graveyard.filter((card: any) => {
    if (!card || typeof card === 'string') return false;
    if (targetIdSet && !targetIdSet.has(getCardId(card))) return false;
    return qualifierMatchesCard(qualifier, card);
  });
}

function addTemporaryGraveyardKeywordGrant(
  state: any,
  playerId: PlayerID,
  card: any,
  options: {
    keyword: GraveyardGrantKeyword;
    cost?: string;
    additionalExileCount?: number;
    sourceId?: string;
    sourceName?: string;
  },
): boolean {
  const cardId = getCardId(card);
  if (!state || !playerId || !cardId || !options.keyword) return false;

  state.temporaryGraveyardKeywordGrants = getTemporaryGraveyardKeywordGrants(state).filter((entry) =>
    !(entry
      && String(entry.playerId || '') === String(playerId || '')
      && String(entry.cardId || '') === cardId
      && String(entry.keyword || '') === String(options.keyword || '')
      && String(entry.sourceId || '') === String(options.sourceId || ''))
  );

  state.temporaryGraveyardKeywordGrants.push({
    playerId: String(playerId),
    cardId,
    keyword: options.keyword,
    ...(options.cost ? { cost: options.cost } : {}),
    ...(Number(options.additionalExileCount || 0) > 0 ? { additionalExileCount: Number(options.additionalExileCount) } : {}),
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    expiresAt: 'end_of_turn',
    turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
  });

  return true;
}

export function clearTemporaryGraveyardKeywordGrants(state: any): number {
  if (!state || !Array.isArray(state.temporaryGraveyardKeywordGrants)) return 0;

  const before = state.temporaryGraveyardKeywordGrants.length;
  state.temporaryGraveyardKeywordGrants = state.temporaryGraveyardKeywordGrants.filter((entry: any) => {
    const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
    return expiresAt !== 'end_of_turn' && expiresAt !== 'this_turn';
  });

  if (state.temporaryGraveyardKeywordGrants.length === 0) {
    delete state.temporaryGraveyardKeywordGrants;
  }

  return before - (Array.isArray(state.temporaryGraveyardKeywordGrants) ? state.temporaryGraveyardKeywordGrants.length : 0);
}

export function applyTemporaryGraveyardKeywordGrantFromText(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  try {
    const state = (ctx as any)?.state;
    if (!state || !playerId) return 0;

    const text = String(description || '').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
    if (!text || !/\bgraveyard\b/i.test(text) || !/\bgains?\b/i.test(text)) return 0;

    // Reflexive delayed triggers such as Filigree Racer's "When you do" need their own payment bridge.
    if (/\bwhen you do\b/i.test(text)) return 0;

    const sourceId = String(
      triggerItem?.sourceId || triggerItem?.source || triggerItem?.permanentId || triggerItem?.id || ''
    ).trim();
    const targetIds = Array.isArray(triggerItem?.targets)
      ? triggerItem.targets.map((id: any) => String(id || '').trim()).filter(Boolean)
      : [];

    const grantPatterns = [
      { targetMode: 'each', pattern: /(?:^|[.,]\s*)(?:until end of turn,\s*)?each\s+(.+?)\s+cards?\s+in\s+your\s+graveyard\s+gains?\s+(?:"([^"]+)"|([a-z][a-z-]*)(?:\s+((?:\{[^}]+\}\s*)+))?)(?:\s+until end of turn)?/gi },
      { targetMode: 'target', pattern: /(?:^|[.,]\s*)target\s+(.+?)\s+cards?\s+in\s+your\s+graveyard\s+gains?\s+(?:"([^"]+)"|([a-z][a-z-]*)(?:\s+((?:\{[^}]+\}\s*)+))?)(?:\s+until end of turn)?/gi },
    ];

    let applied = 0;
    for (const { targetMode, pattern } of grantPatterns) {
      for (const match of text.matchAll(pattern)) {
        const qualifier = String(match[1] || '').trim();
        const quotedAbilityText = String(match[2] || '').trim();
        const unquotedKeywordText = String(match[3] || '').trim();
        const explicitCostText = String(match[4] || '').trim();
        const extracted = quotedAbilityText
          ? extractKeywordGrantFromAbilityText(quotedAbilityText)
          : { keyword: normalizeGrantKeyword(unquotedKeywordText), remainder: explicitCostText };
        const keyword = extracted.keyword;
        if (!keyword || !qualifier) continue;

        const cards = getGraveyardCardsForTemporaryGrant(
          state,
          playerId,
          qualifier,
          targetMode === 'target' ? targetIds : undefined,
        );
        if (targetMode === 'target' && targetIds.length === 0) continue;

        for (const card of cards) {
          const cost = extractGrantedKeywordCost(keyword, extracted.remainder || explicitCostText, text, card);
          if (!cost) continue;
          const added = addTemporaryGraveyardKeywordGrant(state, playerId, card, {
            keyword,
            cost,
            ...(keyword === 'escape' ? { additionalExileCount: extractAdditionalEscapeExileCount(`${quotedAbilityText} ${text}`) } : {}),
            sourceId,
            sourceName,
          });
          if (added) applied += 1;
        }
      }
    }

    return applied;
  } catch {
    return 0;
  }
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

    const temporaryGrant = findTemporaryGrantedKeywordInfo(state, playerId, card, keyword);
    if (temporaryGrant.hasIt) return temporaryGrant;

    const keywordSources: Array<{
      controller: string;
      oracleText: string;
      sourceId: string;
      sourceName: string;
      phasedOut?: boolean;
    }> = [];

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent) continue;

      keywordSources.push({
        controller: String(permanent.controller || ''),
        oracleText: String(permanent.card?.oracle_text || permanent.card?.oracleText || ''),
        sourceId: String(permanent.id || permanent.card?.id || ''),
        sourceName: String(permanent.card?.name || permanent.name || `${keyword} grant`),
        phasedOut: Boolean(permanent.phasedOut),
      });
    }

    const emblems = Array.isArray((state as any)?.emblems) ? (state as any).emblems : [];
    for (const emblem of emblems) {
      if (!emblem) continue;

      keywordSources.push({
        controller: String(emblem.controller || ''),
        oracleText: String(emblem.effect || emblem.text || emblem.oracle_text || ''),
        sourceId: String(emblem.id || 'emblem'),
        sourceName: String(emblem.sourceName || emblem.name || `${keyword} grant`),
      });
    }

    const keywordPattern = escapeRegExp(keyword);
    for (const source of keywordSources) {
      if (source.phasedOut) continue;
      if (source.controller !== String(playerId || '')) continue;

      const oracleText = source.oracleText;
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
          sourceId: source.sourceId,
          sourceName: source.sourceName,
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

export function getGrantedEmbalmInfo(ctx: GameContext, playerId: PlayerID, card: any): GrantedUnearthInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, 'embalm') as GrantedUnearthInfo;
}

export function getGrantedCastFromGraveyardKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  keyword: 'flashback' | 'jump-start' | 'retrace' | 'escape',
): GrantedGraveyardKeywordInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, keyword);
}