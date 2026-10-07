/**
 * Reveal-until library scans for reference_amount quantities
 * ("until you reveal a land card", "until you reveal X creature cards, where X is …").
 *
 * Public: resolveRevealUntilReferenceAmountForPlayer
 */

import type { OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { cardHasCreatureType, normalizeCreatureTypeWord } from '../../shared/src/creatureTypes';
import type { GameState, PlayerID } from '../../shared/src';
import { getCardTypeLineLower, normalizeOracleText } from './oracleIRExecutorPlayerCardInspect';

function cardMatchesRevealUntilCriterion(card: any, criterion: string): boolean {
  const normalized = normalizeOracleText(criterion).replace(/^an?\s+/i, '').trim();
  const typeLine = getCardTypeLineLower(card);
  if (!typeLine) return false;
  if (normalized === 'nonland card') return !typeLine.includes('land');
  if (normalized === 'land card') return typeLine.includes('land');
  if (/^creature card\b/i.test(normalized)) return typeLine.includes('creature');
  {
    const typedCreatureCard = normalized.match(/^([a-z][a-z'-]*) creature card$/i);
    const typedCreature = typedCreatureCard
      ? normalizeCreatureTypeWord(String(typedCreatureCard[1] || ''))
      : null;
    if (typedCreature) {
      return typeLine.includes('creature') && typeLine.includes(typedCreature);
    }
  }
  if (normalized.endsWith(' card')) {
    // "creature or planeswalker card" / "artifact, creature, or land card": any alternative matches.
    const alternatives = normalized
      .slice(0, -' card'.length)
      .split(/\s*,\s*(?:or\s+)?|\s+or\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (alternatives.length > 1) {
      return alternatives.some((alt) => cardMatchesRevealUntilCriterion(card, `${alt} card`));
    }
    const typeName = normalized.slice(0, -' card'.length).trim();
    return typeName ? typeLine.includes(typeName) : false;
  }
  return typeLine.includes(normalized);
}

function countControlledCreaturesOfChosenType(
  state: GameState,
  controllerId: PlayerID,
  chosenType: string,
): number {
  const normalizedType = String(chosenType || '').trim();
  if (!normalizedType) return 0;
  return ((state.battlefield || []) as any[]).filter((perm) => {
    if (String(perm?.controller || '').trim() !== controllerId) return false;
    const card = perm?.card || perm;
    const typeLine = getCardTypeLineLower(card);
    if (!typeLine.includes('creature')) return false;
    const oracleText = String(card?.oracle_text || '');
    return cardHasCreatureType(typeLine, oracleText, normalizedType);
  }).length;
}

function libraryCardMatchesChosenCreatureType(card: any, chosenType: string): boolean {
  const normalizedType = String(chosenType || '').trim();
  if (!normalizedType) return false;
  const typeLine = getCardTypeLineLower(card);
  if (!typeLine.includes('creature')) return false;
  const oracleText = String(card?.oracle_text || '');
  return cardHasCreatureType(typeLine, oracleText, normalizedType);
}

function countOpponents(state: GameState, controllerId: PlayerID): number {
  return Math.max(
    0,
    (state.players || []).filter((p) => String(p?.id || '').trim() && String(p.id) !== controllerId).length,
  );
}

function revealUntilMatchingCount(
  library: readonly any[],
  targetCount: number,
  matches: (card: any) => boolean,
): { readonly count: number; readonly cards: readonly any[] } {
  if (targetCount <= 0) return { count: 0, cards: [] };
  const revealedCards: any[] = [];
  let found = 0;
  for (let i = 0; i < library.length && found < targetCount; i += 1) {
    const card = library[i];
    revealedCards.push(card);
    if (matches(card)) found += 1;
  }
  return revealedCards.length > 0
    ? { count: revealedCards.length, cards: revealedCards }
    : { count: 0, cards: [] };
}

/**
 * Resolve "reveal until …" reference amounts into the contiguous top-of-library slice.
 */
export function resolveRevealUntilReferenceAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity,
  ctx?: OracleIRExecutionContext,
): { readonly count: number; readonly cards: readonly any[] } | null {
  if (qty.kind !== 'reference_amount') return null;
  const raw = normalizeOracleText(String((qty as any).raw || ''));

  if (
    /^until you reveal x creature cards of the chosen type(?:,\s*where x is the number of creatures you control of that type)?$/i.test(
      raw,
    )
  ) {
    const chosenType = String(ctx?.selectorContext?.chosenCreatureType || '').trim();
    if (!chosenType) return null;
    const targetCount = countControlledCreaturesOfChosenType(
      state,
      ctx?.controllerId || playerId,
      chosenType,
    );
    const player = state.players.find((p) => p.id === playerId) as any;
    if (!player) return null;
    const library: any[] = Array.isArray(player.library) ? player.library : [];
    return revealUntilMatchingCount(library, targetCount, (card) =>
      libraryCardMatchesChosenCreatureType(card, chosenType),
    );
  }

  // Generic: until you reveal X <type> cards, where X is the number of opponents you have
  {
    const untilXCards = raw.match(
      /^until you reveal x (.+?) cards,\s*where x is the number of opponents you have$/i,
    );
    if (untilXCards) {
      const typePhrase = String(untilXCards[1] || '').trim();
      const controllerId = String(ctx?.controllerId || playerId).trim() as PlayerID;
      const targetCount = countOpponents(state, controllerId);
      const player = state.players.find((p) => p.id === playerId) as any;
      if (!player) return null;
      const library: any[] = Array.isArray(player.library) ? player.library : [];
      return revealUntilMatchingCount(library, targetCount, (card) =>
        cardMatchesRevealUntilCriterion(card, `${typePhrase} card`),
      );
    }
  }

  const untilMatch = raw.match(/^until you reveal an? (.+)$/i);
  if (!untilMatch) return null;

  const player = state.players.find((p) => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];
  const criterion = String(untilMatch[1] || '').trim();
  const revealedCards: any[] = [];

  for (let i = 0; i < library.length; i += 1) {
    const card = library[i];
    revealedCards.push(card);
    if (cardMatchesRevealUntilCriterion(card, criterion)) {
      return { count: i + 1, cards: revealedCards };
    }
  }

  return revealedCards.length > 0 ? { count: revealedCards.length, cards: revealedCards } : null;
}
