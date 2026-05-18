import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";
import { collectStaticEffectSources } from "./static-effect-sources";
import { cardManaValue } from "../utils";

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

export interface PrintedSelfCastPermissionInfo {
  hasIt: boolean;
  cost?: string;
  fromExile?: boolean;
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

export interface TemporaryPlayableFromGraveyardPermission {
  playerId: string;
  permission: 'play' | 'cast';
  qualifier: string;
  sourceId?: string;
  sourceName?: string;
  expiresAt: 'end_of_turn' | 'this_turn';
  turnApplied?: number;
}

export type GraveyardCastingPermissionKind = 'play' | 'cast';
export type GraveyardCastingPermissionDuration = 'this_turn' | 'end_of_turn' | 'until_end_of_next_turn' | 'static';
export type GraveyardCastingPermissionCostMode = 'normal' | 'alternate' | 'without_paying_mana_cost';

export interface GraveyardCastingPermissionCardFilter {
  qualifier?: string;
  cardIds?: string[];
}

export interface GraveyardCastingPermissionUsageLimit {
  type: 'once' | 'once_per_turn' | 'one_per_permanent_type';
  maxUses?: number;
}

export interface GraveyardCastingPermissionReplacement {
  exileAfterResolution?: boolean;
  leaveBattlefieldDestination?: 'exile';
  leaveBattlefieldLifeGain?: number;
  sourceName?: string;
}

export interface GraveyardCastingPermission {
  id: string;
  playerId: string;
  permission: GraveyardCastingPermissionKind;
  sourceZone: 'graveyard';
  cardFilter: GraveyardCastingPermissionCardFilter;
  costMode: GraveyardCastingPermissionCostMode;
  duration: GraveyardCastingPermissionDuration;
  turnApplied?: number;
  sourceId?: string;
  sourceName?: string;
  usageLimit?: GraveyardCastingPermissionUsageLimit;
  replacement?: GraveyardCastingPermissionReplacement;
}

export type GraveyardGrantKeyword = 'flashback' | 'unearth' | 'jump-start' | 'retrace' | 'escape' | 'harmonize' | 'embalm';

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

function getCardManaValue(card: any): number | undefined {
  const directValue = [card?.cmc, card?.mana_value, card?.manaValue, card?.convertedManaCost]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value >= 0);
  if (typeof directValue === 'number') {
    return Math.max(0, Math.floor(directValue));
  }

  const derivedValue = cardManaValue(card);
  return Number.isFinite(derivedValue) && derivedValue >= 0
    ? Math.max(0, Math.floor(derivedValue))
    : undefined;
}

function getGenericManaValueCost(card: any): string | undefined {
  const manaValue = getCardManaValue(card);
  return typeof manaValue === 'number' ? `{${manaValue}}` : undefined;
}

function getCardId(card: any): string {
  return String(card?.id || '').trim();
}

function getCurrentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
}

function sanitizePermissionIdPart(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function getGraveyardCastingPermissions(state: any): GraveyardCastingPermission[] {
  return Array.isArray(state?.graveyardCastingPermissions)
    ? state.graveyardCastingPermissions
    : [];
}

function normalizeGraveyardPermissionDuration(value: unknown): GraveyardCastingPermissionDuration {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'until_end_of_next_turn') return 'until_end_of_next_turn';
  if (normalized === 'static' || normalized === 'permanent') return 'static';
  if (normalized === 'end_of_turn' || normalized === 'eot') return 'end_of_turn';
  return 'this_turn';
}

export function buildGraveyardCastingPermissionId(permission: Omit<GraveyardCastingPermission, 'id'> & { id?: string }): string {
  const sourcePart = sanitizePermissionIdPart(permission.sourceId || permission.sourceName || 'source');
  const qualifierPart = sanitizePermissionIdPart(
    permission.cardFilter?.qualifier || permission.cardFilter?.cardIds?.join('_') || 'cards'
  );
  const turnPart = Number(permission.turnApplied ?? 0) || 0;
  return [
    'graveyard-permission',
    permission.playerId,
    permission.permission,
    sourcePart || 'source',
    qualifierPart || 'cards',
    turnPart,
  ].map(sanitizePermissionIdPart).filter(Boolean).join(':');
}

function graveyardCastingPermissionIsActive(state: any, permission: GraveyardCastingPermission): boolean {
  if (!permission || permission.sourceZone !== 'graveyard') return false;
  const duration = normalizeGraveyardPermissionDuration(permission.duration);
  if (duration === 'static') return true;

  const turnApplied = Number(permission.turnApplied ?? getCurrentTurn(state)) || 0;
  const currentTurn = getCurrentTurn(state);
  if (duration === 'until_end_of_next_turn') {
    return currentTurn <= turnApplied + 1;
  }

  return turnApplied >= currentTurn;
}

export function addGraveyardCastingPermission(
  state: any,
  permission: Omit<GraveyardCastingPermission, 'id' | 'sourceZone'> & { id?: string; sourceZone?: 'graveyard' },
): GraveyardCastingPermission | undefined {
  if (!state || !permission?.playerId || !permission.permission) return undefined;

  const cardIds = Array.isArray(permission.cardFilter?.cardIds)
    ? permission.cardFilter.cardIds.map((cardId) => String(cardId || '').trim()).filter(Boolean)
    : [];
  const qualifier = String(permission.cardFilter?.qualifier || '').trim();
  if (cardIds.length === 0 && !qualifier) return undefined;

  const turnApplied = Number(permission.turnApplied ?? getCurrentTurn(state)) || 0;
  const entry: GraveyardCastingPermission = {
    id: String(permission.id || buildGraveyardCastingPermissionId({
      ...permission,
      id: undefined,
      sourceZone: 'graveyard',
      cardFilter: {
        ...(qualifier ? { qualifier } : {}),
        ...(cardIds.length > 0 ? { cardIds } : {}),
      },
      turnApplied,
    } as any)).trim(),
    playerId: String(permission.playerId),
    permission: permission.permission === 'play' ? 'play' : 'cast',
    sourceZone: 'graveyard',
    cardFilter: {
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
    },
    costMode: permission.costMode || 'normal',
    duration: normalizeGraveyardPermissionDuration(permission.duration),
    turnApplied,
    ...(permission.sourceId ? { sourceId: String(permission.sourceId) } : {}),
    ...(permission.sourceName ? { sourceName: String(permission.sourceName) } : {}),
    ...(permission.usageLimit ? { usageLimit: { ...permission.usageLimit } } : {}),
    ...(permission.replacement ? { replacement: { ...permission.replacement } } : {}),
  };

  state.graveyardCastingPermissions = getGraveyardCastingPermissions(state).filter((existing) => existing?.id !== entry.id);
  state.graveyardCastingPermissions.push(entry);
  return entry;
}

export function getActiveGraveyardCastingPermissions(
  state: any,
  playerId: PlayerID,
  options?: { permission?: GraveyardCastingPermissionKind },
): GraveyardCastingPermission[] {
  const expectedPermission = options?.permission;
  return getGraveyardCastingPermissions(state).filter((permission) => {
    if (String(permission?.playerId || '') !== String(playerId || '')) return false;
    if (expectedPermission && permission.permission !== expectedPermission) return false;
    return graveyardCastingPermissionIsActive(state, permission);
  });
}

function getCollapsedOracleText(card: any): string {
  return normalizeText(card?.oracle_text || card?.oracleText || '').replace(/\s+/g, ' ').trim();
}

function getSelfReferenceNames(card: any): string[] {
  const names = new Set<string>();
  const fullName = normalizeText(card?.name || '').trim();
  if (fullName) {
    names.add(fullName);
    const shortName = fullName.split(',')[0]?.trim();
    if (shortName) {
      names.add(shortName);
    }
  }

  return [...names];
}

function hasSelfCastReference(text: string, selfNames: string[]): boolean {
  if (text.includes('you may cast this card') || text.includes('you may play this card')) {
    return true;
  }

  return selfNames.some((name) => name && (
    text.includes(`you may cast ${name}`)
    || text.includes(`you may play ${name}`)
  ));
}

function singularizeTypeWord(value: string): string {
  const normalized = normalizeText(value).trim();
  if (normalized.endsWith('ies') && normalized.length > 3) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function getTypeQualifierWords(value: string): string[] {
  return normalizeText(value)
    .replace(/\band\/or\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\bor\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .split(/\s+/)
    .map((word) => singularizeTypeWord(word))
    .filter(Boolean);
}

function countControlledPermanentsMatchingQualifier(
  state: any,
  playerId: PlayerID,
  qualifier: string,
  options?: { tappedOnly?: boolean },
): number {
  const typeWords = getTypeQualifierWords(qualifier);
  if (typeWords.length === 0) {
    return 0;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (!permanent || permanent.phasedOut) return false;
    if (String(permanent.controller || permanent.owner || '') !== String(playerId || '')) {
      return false;
    }
    if (options?.tappedOnly && permanent.tapped !== true) {
      return false;
    }

    const permanentTypeWords = getTypeQualifierWords(getTypeLine(permanent?.card || permanent));
    return typeWords.some((word) => permanentTypeWords.includes(word));
  }).length;
}

function playerControlsTypeLineWord(state: any, playerId: PlayerID, word: string): boolean {
  const normalizedWord = normalizeText(word).trim();
  if (!normalizedWord) return false;

  return countControlledPermanentsMatchingQualifier(state, playerId, normalizedWord) > 0;
}

export function getPrintedSelfCastPermissionInfo(
  state: any,
  playerId: PlayerID,
  card: any,
  sourceZone: 'graveyard' | 'exile' = 'graveyard',
): PrintedSelfCastPermissionInfo {
  const oracleText = getCollapsedOracleText(card);
  if (!oracleText.includes('you may cast') && !oracleText.includes('you may play')) {
    return { hasIt: false };
  }

  const selfNames = getSelfReferenceNames(card);
  if (!hasSelfCastReference(oracleText, selfNames)) {
    return { hasIt: false };
  }

  const canCastFromGraveyard = oracleText.includes('from your graveyard');
  const canCastFromExile = oracleText.includes('from exile');
  if ((sourceZone === 'graveyard' && !canCastFromGraveyard) || (sourceZone === 'exile' && !canCastFromExile)) {
    return { hasIt: false };
  }

  if (/\bif you discarded it this turn\b/.test(oracleText)) {
    const currentTurn = getCurrentTurn(state);
    const discardedOnTurn = Number((card as any)?.discardedOnTurn ?? (card as any)?.discardedTurnNumber ?? 0) || 0;
    const discardedByPlayerId = String((card as any)?.discardedByPlayerId || '').trim();
    if (discardedOnTurn !== currentTurn || discardedByPlayerId !== String(playerId || '')) {
      return { hasIt: false };
    }
  }

  if (/\bduring your turn\b/.test(oracleText) && !isPlayersTurn(state, playerId)) {
    return { hasIt: false };
  }

  const multiTappedControlMatch = oracleText.match(/\bas long as you control (one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more tapped ([a-z0-9'/ -]+?)(?:[.,]|$)/i);
  if (multiTappedControlMatch) {
    const requiredCount = parseSmallNumber(multiTappedControlMatch[1]);
    const availableCount = countControlledPermanentsMatchingQualifier(state, playerId, multiTappedControlMatch[2], { tappedOnly: true });
    if (requiredCount > 0 && availableCount < requiredCount) {
      return { hasIt: false };
    }
  }

  const controlMatch = oracleText.match(/\bas long as you control (?:a|an)\s+([a-z0-9'-]+)/i);
  if (controlMatch && !playerControlsTypeLineWord(state, playerId, controlMatch[1])) {
    return { hasIt: false };
  }

  return {
    hasIt: true,
    ...(getManaCost(card) ? { cost: getManaCost(card) } : {}),
    ...(canCastFromExile ? { fromExile: true } : {}),
  };
}

function getPlayerGraveyardCollections(state: any, playerId: PlayerID): any[][] {
  const collections: any[][] = [];
  const zonesGraveyard = state?.zones?.[playerId]?.graveyard;
  if (Array.isArray(zonesGraveyard)) {
    collections.push(zonesGraveyard);
  }

  const playerEntry = Array.isArray(state?.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId || ''))
    : undefined;
  const playerGraveyard = Array.isArray(playerEntry?.graveyard) ? playerEntry.graveyard : undefined;
  if (Array.isArray(playerGraveyard) && playerGraveyard !== zonesGraveyard) {
    collections.push(playerGraveyard);
  }

  return collections;
}

function findCardInPlayerGraveyard(
  state: any,
  playerId: PlayerID,
  options: { cardId?: string; cardName?: string },
): any | undefined {
  const cardId = String(options.cardId || '').trim();
  const cardName = normalizeText(options.cardName || '');
  const graveyards = getPlayerGraveyardCollections(state, playerId);

  if (cardId) {
    for (const graveyard of graveyards) {
      const card = graveyard.find((entry: any) => getCardId(entry) === cardId);
      if (card) return card;
    }
  }

  if (cardName) {
    for (const graveyard of graveyards) {
      const matches = graveyard.filter((entry: any) => normalizeText(entry?.name || '') === cardName);
      if (matches.length === 1) {
        return matches[0];
      }
    }
  }

  return undefined;
}

function markSourceCardPlayableFromGraveyardThisTurn(
  state: any,
  playerId: PlayerID,
  sourceCard: any,
  permission: 'play' | 'cast',
  options?: {
    sourceId?: string;
    sourceName?: string;
    costMode?: GraveyardCastingPermissionCostMode;
    replacement?: GraveyardCastingPermissionReplacement;
  },
): number {
  const cardId = getCardId(sourceCard);
  if (!state || !playerId || !cardId) return 0;

  const typeLine = getTypeLine(sourceCard);
  if (permission === 'cast' && /\bland\b/.test(typeLine)) {
    return 0;
  }

  const playableUntilTurn = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  let updated = 0;

  for (const graveyard of getPlayerGraveyardCollections(state, playerId)) {
    const index = graveyard.findIndex((entry: any) => getCardId(entry) === cardId);
    if (index < 0) continue;

    graveyard[index] = {
      ...graveyard[index],
      zone: 'graveyard',
      canBePlayedBy: String(playerId),
      playableUntilTurn,
    };
    updated += 1;
  }

  if (updated === 0) {
    return 0;
  }

  state.playableFromGraveyard = state.playableFromGraveyard || {};
  const playerEntry = state.playableFromGraveyard[String(playerId)] = state.playableFromGraveyard[String(playerId)] || {};
  playerEntry[cardId] = playableUntilTurn;

  addGraveyardCastingPermission(state, {
    playerId: String(playerId),
    permission,
    sourceId: options?.sourceId || cardId,
    sourceName: options?.sourceName || String(sourceCard?.name || ''),
    cardFilter: {
      qualifier: 'this card',
      cardIds: [cardId],
    },
    costMode: options?.costMode || 'normal',
    duration: 'this_turn',
    turnApplied: playableUntilTurn,
    usageLimit: { type: 'once', maxUses: 1 },
    ...(options?.replacement ? { replacement: { ...options.replacement } } : {}),
  });

  return 1;
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

function extractGrantedKeywordCost(keyword: GraveyardGrantKeyword, remainder: string, fullOracleText: string, card: any): string | undefined {
  const explicitCost = String(remainder || '').match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)/);
  if (explicitCost?.[1]) {
    return explicitCost[1].trim();
  }

  const keywordCostPattern = escapeRegExp(keyword);
  const sourceExplicitCost = String(fullOracleText || '').match(new RegExp(`${keywordCostPattern} cost (?:is|equals?)\\s*((?:\\{[^}]+\\}\\s*)+)`, 'i'));
  if (sourceExplicitCost?.[1]) {
    return sourceExplicitCost[1].trim();
  }

  if (keyword === 'jump-start' || keyword === 'retrace') {
    const manaCost = getManaCost(card);
    return manaCost || undefined;
  }

  const costSubjectPattern = `(?:that card's|its|the card's|this card's|that spell's|this spell's)`;
  if (new RegExp(`${keywordCostPattern} cost is equal to ${costSubjectPattern} mana cost`, 'i').test(fullOracleText)) {
    const manaCost = getManaCost(card);
    return manaCost || undefined;
  }

  if (new RegExp(`${keywordCostPattern} cost is equal to ${costSubjectPattern} mana value`, 'i').test(fullOracleText)) {
    return getGenericManaValueCost(card);
  }

  return undefined;
}

function extractAdditionalEscapeExileCount(fullOracleText: string): number | undefined {
  const exileMatch = String(fullOracleText || '').match(/exil(?:e|ing)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?\s+from\s+your\s+graveyard/i);
  if (!exileMatch?.[1]) return undefined;
  const count = parseSmallNumber(exileMatch[1]);
  return count > 0 ? count : undefined;
}

function extractEscapeEntryCounterCount(fullOracleText: string): number | undefined {
  const counterMatch = String(fullOracleText || '').match(/escapes?\s+with\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\+1\/\+1\s+counters?\s+on\s+it/i);
  if (!counterMatch?.[1]) return undefined;
  const count = parseSmallNumber(counterMatch[1]);
  return count > 0 ? count : undefined;
}

export function buildCastFromGraveyardCard(card: any, abilityId: string): any {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  const nextCard: any = {
    ...card,
    zone: 'stack',
    castWithAbility: abilityId,
  };

  if (normalizedAbilityId === 'escape') {
    nextCard.escapedFrom = 'graveyard';
    const escapeCounterCount = extractEscapeEntryCounterCount(String(card?.oracle_text || ''));
    if (escapeCounterCount > 0) {
      const existingCounters = nextCard.entersBattlefieldWithCounters && typeof nextCard.entersBattlefieldWithCounters === 'object'
        ? { ...(nextCard.entersBattlefieldWithCounters as Record<string, number>) }
        : {};
      existingCounters['+1/+1'] = Number(existingCounters['+1/+1'] || 0) + escapeCounterCount;
      nextCard.entersBattlefieldWithCounters = existingCounters;
    }
  }

  return nextCard;
}

function getTemporaryGraveyardKeywordGrants(state: any): TemporaryGraveyardKeywordGrant[] {
  return Array.isArray(state?.temporaryGraveyardKeywordGrants)
    ? state.temporaryGraveyardKeywordGrants
    : [];
}

function getTemporaryPlayableFromGraveyardPermissions(state: any): TemporaryPlayableFromGraveyardPermission[] {
  return Array.isArray(state?.temporaryPlayableFromGraveyardPermissions)
    ? state.temporaryPlayableFromGraveyardPermissions
    : [];
}

function addTemporaryPlayableFromGraveyardPermission(
  state: any,
  playerId: PlayerID,
  qualifier: string,
  permission: 'play' | 'cast',
  options: {
    sourceId?: string;
    sourceName?: string;
    costMode?: GraveyardCastingPermissionCostMode;
    usageLimit?: GraveyardCastingPermissionUsageLimit;
    replacement?: GraveyardCastingPermissionReplacement;
  },
): boolean {
  const normalizedQualifier = String(qualifier || '').trim();
  if (!state || !playerId || !normalizedQualifier) return false;

  const sourceId = String(options.sourceId || '').trim();
  state.temporaryPlayableFromGraveyardPermissions = getTemporaryPlayableFromGraveyardPermissions(state).filter((entry) => !(
    String(entry?.playerId || '') === String(playerId || '')
    && String(entry?.permission || '') === String(permission)
    && normalizeText(entry?.qualifier || '') === normalizeText(normalizedQualifier)
    && String(entry?.sourceId || '') === sourceId
  ));

  state.temporaryPlayableFromGraveyardPermissions.push({
    playerId: String(playerId),
    permission,
    qualifier: normalizedQualifier,
    ...(sourceId ? { sourceId } : {}),
    ...(options.sourceName ? { sourceName: String(options.sourceName) } : {}),
    expiresAt: 'end_of_turn',
    turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
  });

  addGraveyardCastingPermission(state, {
    playerId: String(playerId),
    permission,
    sourceId,
    ...(options.sourceName ? { sourceName: String(options.sourceName) } : {}),
    cardFilter: { qualifier: normalizedQualifier },
    costMode: options.costMode || 'normal',
    duration: 'this_turn',
    turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
    ...(options.usageLimit ? { usageLimit: options.usageLimit } : {}),
    ...(options.replacement ? { replacement: { ...options.replacement } } : {}),
  });

  return true;
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
  if (['flashback', 'unearth', 'jump-start', 'retrace', 'escape', 'harmonize', 'embalm'].includes(normalized)) {
    return normalized as GraveyardGrantKeyword;
  }
  return undefined;
}

function extractKeywordGrantFromAbilityText(rawAbilityText: string): { keyword?: GraveyardGrantKeyword; remainder: string } {
  const text = String(rawAbilityText || '').trim();
  if (!text) return { remainder: '' };

  const match = text.match(/\b(flashback|unearth|jump-start|retrace|escape|harmonize|embalm)\b\s*[—-]?\s*([^.]*)/i);
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

  if (targetIdSet) {
    return graveyard.filter((card: any) => card && typeof card !== 'string' && targetIdSet.has(getCardId(card)));
  }

  return graveyard.filter((card: any) => {
    if (!card || typeof card === 'string') return false;
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

export function clearTemporaryPlayableFromGraveyardPermissions(state: any): number {
  if (!state) return 0;

  let cleared = 0;

  if (Array.isArray(state.temporaryPlayableFromGraveyardPermissions)) {
    const before = state.temporaryPlayableFromGraveyardPermissions.length;
    state.temporaryPlayableFromGraveyardPermissions = state.temporaryPlayableFromGraveyardPermissions.filter((entry: any) => {
      const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
      return expiresAt !== 'end_of_turn' && expiresAt !== 'this_turn';
    });

    if (state.temporaryPlayableFromGraveyardPermissions.length === 0) {
      delete state.temporaryPlayableFromGraveyardPermissions;
    }

    cleared += before - (Array.isArray(state.temporaryPlayableFromGraveyardPermissions) ? state.temporaryPlayableFromGraveyardPermissions.length : 0);
  }

  if (Array.isArray(state.graveyardCastingPermissions)) {
    const before = state.graveyardCastingPermissions.length;
    state.graveyardCastingPermissions = state.graveyardCastingPermissions.filter((permission: GraveyardCastingPermission) => {
      const duration = normalizeGraveyardPermissionDuration(permission?.duration);
      return duration !== 'end_of_turn' && duration !== 'this_turn';
    });

    if (state.graveyardCastingPermissions.length === 0) {
      delete state.graveyardCastingPermissions;
    }

    cleared += before - (Array.isArray(state.graveyardCastingPermissions) ? state.graveyardCastingPermissions.length : 0);
  }

  return cleared;
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
      { targetMode: 'each', pattern: /(?:^|[.,]\s*)(?:until end of turn,\s*)?each\s+(.+?)\s+cards?\s+in\s+your\s+graveyard(?:\s+that(?:'s| is)\s+[^.]+?)?\s+gains?\s+(?:"([^"]+)"|([a-z][a-z-]*)(?:\s+((?:\{[^}]+\}\s*)+))?)(?:\s+until end of turn)?/gi },
      { targetMode: 'target', pattern: /(?:^|[.,]\s*)target\s+(.+?)\s+cards?\s+in\s+your\s+graveyard(?:\s+that(?:'s| is)\s+[^.]+?)?\s+gains?\s+(?:"([^"]+)"|([a-z][a-z-]*)(?:\s+((?:\{[^}]+\}\s*)+))?)(?:\s+until end of turn)?/gi },
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

export function applyPlayableFromGraveyardPermissionFromText(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  try {
    const state = (ctx as any)?.state;
    if (!state || !playerId) return 0;

    const text = String(description || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !/\bgraveyard\b/i.test(text)) return 0;

    const hasTemporaryWindow = /\bthis turn\b/i.test(text)
      || /^\s*until end of turn\b/i.test(text)
      || /^\s*until end of your next turn\b/i.test(text);

    if (/\bit'?s your turn\b/i.test(text) && !isPlayersTurn(state, playerId)) {
      return 0;
    }

    const grantsCastPermission = /\byou may cast (?:it|this card) from your graveyard this turn\b/i.test(text);
    const grantsPlayPermission = !grantsCastPermission
      && /\byou may play (?:it|this card) from your graveyard this turn\b/i.test(text);
    const grantsTurnLongGraveyardExileReplacement =
      /\bif\s+a\s+card\s+would\s+be\s+put\s+into\s+your\s+graveyard\s+from\s+anywhere\s+this\s+turn\s*,?\s*exile\s+(?:that\s+card|it)\s+instead\b/i.test(text);
    const costMode: GraveyardCastingPermissionCostMode = /\bwithout paying (?:its|their|that spell's) mana cost\b/i.test(text)
      ? 'without_paying_mana_cost'
      : 'normal';
    const spellReplacement = grantsTurnLongGraveyardExileReplacement
      ? { exileAfterResolution: true }
      : undefined;

    const sourceCardId = String(
      triggerItem?.interveningIfSubjectSnapshot?.id
      || triggerItem?.card?.id
      || triggerItem?.sourceId
      || triggerItem?.source
      || ''
    ).trim();
    const sourceCardName = String(
      triggerItem?.interveningIfSubjectSnapshot?.name
      || triggerItem?.card?.name
      || sourceName
      || ''
    ).trim();

    const addQualifierPermission = (
      permission: 'play' | 'cast',
      qualifier: string,
      limiterText?: string,
      replacement?: GraveyardCastingPermissionReplacement,
    ): number => {
      const normalizedQualifier = String(qualifier || '').trim();
      if (!normalizedQualifier || /^(?:it|this card)$/i.test(normalizedQualifier)) {
        return 0;
      }

      const normalizedLimiterText = String(limiterText || '').trim().toLowerCase();
      const usageLimit = /^(?:a|an|one)$/.test(normalizedLimiterText)
        ? { type: 'once' as const, maxUses: 1 }
        : undefined;

      return addTemporaryPlayableFromGraveyardPermission(
        state,
        playerId,
        normalizedQualifier,
        permission,
        {
          ...(sourceCardId ? { sourceId: sourceCardId } : {}),
          ...(sourceCardName ? { sourceName: sourceCardName } : {}),
          costMode,
          ...(usageLimit ? { usageLimit } : {}),
          ...(replacement ? { replacement } : {}),
        },
      ) ? 1 : 0;
    };

    if (grantsCastPermission || grantsPlayPermission) {
      const sourceCard = findCardInPlayerGraveyard(state, playerId, {
        cardId: sourceCardId,
        cardName: sourceCardName,
      });
      if (!sourceCard) return 0;

      return markSourceCardPlayableFromGraveyardThisTurn(
        state,
        playerId,
        sourceCard,
        grantsPlayPermission ? 'play' : 'cast',
        {
          ...(sourceCardId ? { sourceId: sourceCardId } : {}),
          ...(sourceCardName ? { sourceName: sourceCardName } : {}),
          costMode,
          ...((grantsCastPermission && spellReplacement) ? { replacement: spellReplacement } : {}),
        },
      );
    }

    const grantedSelfPermissionMatch = hasTemporaryWindow
      ? text.match(/\beach\s+(.+?)\s+cards?\s+in\s+your\s+graveyard\s+gains?\s+["“]?you\s+may\s+(play|cast)\s+this\s+card\s+from\s+your\s+graveyard(?:\s+without\s+paying\s+(?:its|their|that\s+spell's|this\s+spell's)\s+mana\s+cost)?\.?["”]?/i)
      : undefined;
    if (grantedSelfPermissionMatch) {
      const qualifier = String(grantedSelfPermissionMatch[1] || '').trim();
      const grantedAction = String(grantedSelfPermissionMatch[2] || '').trim().toLowerCase();
      const grantedPermissionCostMode: GraveyardCastingPermissionCostMode = /\bwithout\s+paying\s+(?:its|their|that\s+spell's|this\s+spell's)\s+mana\s+cost\b/i.test(String(grantedSelfPermissionMatch[0] || ''))
        ? 'without_paying_mana_cost'
        : costMode;
      const seenCardIds = new Set<string>();
      let added = 0;

      for (const graveyard of getPlayerGraveyardCollections(state, playerId)) {
        for (const graveyardCard of graveyard) {
          const cardId = getCardId(graveyardCard);
          if (!cardId || seenCardIds.has(cardId)) continue;
          if (!qualifierMatchesCard(qualifier, graveyardCard)) continue;

          const typeLine = getTypeLine(graveyardCard);
          const grantedPermission: 'play' | 'cast' = grantedAction === 'cast'
            ? 'cast'
            : /\bland\b/.test(typeLine)
              ? 'play'
              : 'cast';

          if (grantedPermission === 'cast' && /\bland\b/.test(typeLine)) {
            continue;
          }

          added += markSourceCardPlayableFromGraveyardThisTurn(
            state,
            playerId,
            graveyardCard,
            grantedPermission,
            {
              ...(sourceCardId ? { sourceId: sourceCardId } : {}),
              ...(sourceCardName ? { sourceName: sourceCardName } : {}),
              costMode: grantedPermission === 'cast' ? grantedPermissionCostMode : 'normal',
              ...((grantedPermission === 'cast' && spellReplacement) ? { replacement: spellReplacement } : {}),
            },
          );
          seenCardIds.add(cardId);
        }
      }

      return added;
    }

    const mixedPlayCastMatch = hasTemporaryWindow
      ? text.match(/\byou may play\s+((?:an?|one)\s+)?(.+?)\s+and cast\s+((?:an?|one)\s+)?(.+?)\s+from your graveyard(?:\s+this turn)?\b/i)
      : undefined;
    if (mixedPlayCastMatch) {
      return addQualifierPermission('play', String(mixedPlayCastMatch[2] || '').trim(), String(mixedPlayCastMatch[1] || '').trim())
        + addQualifierPermission(
          'cast',
          String(mixedPlayCastMatch[4] || '').trim(),
          String(mixedPlayCastMatch[3] || '').trim(),
          spellReplacement,
        );
    }

    const castQualifierMatch = hasTemporaryWindow
      ? text.match(/\byou may cast\s+((?:an?|one)\s+)?(.+?)\s+from your graveyard(?:\s+this turn)?\b/i)
      : undefined;
    const playQualifierMatch = !castQualifierMatch
      ? (hasTemporaryWindow
          ? text.match(/\byou may play\s+((?:an?|one)\s+)?(.+?)\s+from your graveyard(?:\s+this turn)?\b/i)
          : undefined)
      : undefined;
    const qualifier = String(castQualifierMatch?.[2] || playQualifierMatch?.[2] || '').trim();
    if (!qualifier) return 0;

    return addQualifierPermission(
      castQualifierMatch ? 'cast' : 'play',
      qualifier,
      String(castQualifierMatch?.[1] || playQualifierMatch?.[1] || '').trim(),
      castQualifierMatch ? spellReplacement : undefined,
    );
  } catch {
    return 0;
  }
}

export function applyGraveyardPermissionEffectsFromText(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  return (
    applyTemporaryGraveyardKeywordGrantFromText(ctx, playerId, sourceName, description, triggerItem)
    + applyPlayableFromGraveyardPermissionFromText(ctx, playerId, sourceName, description, triggerItem)
  );
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

    const keywordPattern = escapeRegExp(keyword);
    for (const source of collectStaticEffectSources(state)) {
      if (source.phasedOut) continue;
      if (!source.affectsAllPlayers && source.controller !== String(playerId || '')) continue;

      const oracleText = source.oracleText;
      if (!new RegExp(keywordPattern, 'i').test(oracleText) || !/graveyard/i.test(oracleText)) continue;
      if (/\bduring your turn\b/i.test(oracleText) && !isPlayersTurn(state, playerId)) continue;

      const lines = oracleText.split(/\r?\n/);
      for (const line of lines) {
        const normalizedLine = line.replace(/^\s*during\s+your\s+turn,\s*/i, '').trim();
        if (/\bgains?\b/i.test(normalizedLine)) continue;

        const grantPatterns = [
          new RegExp(`\\beach\\s+(.+?)\\s+cards?\\s+in\\s+(?:your\\s+)?graveyards?(?:\\s+that(?:'s| is)\\s+(.+?))?\\s+ha(?:s|ve)\\s+${keywordPattern}\\b([^.]*)`, 'i'),
          new RegExp(`^\\s*(.+?)\\s+cards?\\s+in\\s+(?:your\\s+)?graveyards?(?:\\s+that(?:'s| is)\\s+(.+?))?\\s+ha(?:s|ve)\\s+${keywordPattern}\\b([^.]*)`, 'i'),
        ];
        const grantMatch = grantPatterns.map((pattern) => normalizedLine.match(pattern)).find(Boolean);
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
            sourceName: source.sourceName || `${keyword} grant`,
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
  keyword: 'flashback' | 'jump-start' | 'retrace' | 'escape' | 'harmonize',
): GrantedGraveyardKeywordInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, keyword);
}
