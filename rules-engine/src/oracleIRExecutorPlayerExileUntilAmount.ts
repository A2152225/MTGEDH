// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: resolveUnknownExileUntilAmountForPlayer plus exclusive
// getCardTypesFromTypeLine / getCardManaValue helpers.
// Public entries: getCardTypesFromTypeLine, getCardManaValue,
// resolveUnknownExileUntilAmountForPlayer.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getCardTypeLineLower, normalizeOracleText } from './oracleIRExecutorPlayerCardInspect';
import { parseManaSymbols } from './types/numbers';

export function getCardTypesFromTypeLine(card: any): readonly string[] | null {
  const tl = getCardTypeLineLower(card);
  if (!tl) return null;
  const known = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
  const out = known.filter(type => tl.includes(type));
  if (tl.includes('tribal') && !out.includes('kindred')) out.push('kindred');
  return out.length > 0 ? out : null;
}

export function getCardManaValue(card: any): number | null {
  const raw =
    card?.manaValue ??
    card?.mana_value ??
    card?.cmc ??
    card?.spell?.manaValue ??
    card?.spell?.mana_value ??
    card?.spell?.cmc ??
    card?.card?.manaValue ??
    card?.card?.mana_value ??
    card?.card?.cmc;

  const value = Number(raw);
  if (Number.isFinite(value)) return value;

  const manaCost = String(
    card?.mana_cost ??
      card?.manaCost ??
      card?.spell?.mana_cost ??
      card?.spell?.manaCost ??
      card?.card?.mana_cost ??
      card?.card?.manaCost ??
      ''
  ).trim();
  if (!manaCost) {
    const typeLine = getCardTypeLineLower(card);
    if (typeLine.includes('land')) return 0;
    return null;
  }

  const symbols = parseManaSymbols(manaCost);
  if (symbols.length === 0) return null;

  let total = 0;
  for (const symbol of symbols) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) return null;
    if (/^\{\d+\}$/.test(normalized)) {
      total += Number.parseInt(normalized.slice(1, -1), 10);
      continue;
    }
    if (/^\{X\}$/.test(normalized)) continue;
    total += 1;
  }

  return total;
}

export function resolveUnknownExileUntilAmountForPlayer(
  state: GameState,
  playerId: PlayerID,
  qty: OracleQuantity,
  ctx?: OracleIRExecutionContext
): number | null {
  if (qty.kind !== 'unknown' && qty.kind !== 'reference_amount') return null;

  const raw = normalizeOracleText(String((qty as any).raw || ''));
  if (!raw.startsWith('until ')) return null;

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return null;
  const library: any[] = Array.isArray(player.library) ? player.library : [];

  if (raw === 'until they exile a nonland card' || raw === 'until you exile a nonland card') {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (!typeLine.includes('land')) return i + 1;
    }
    return library.length;
  }

  if (
    raw === 'until they exile an instant or sorcery card' ||
    raw === 'until you exile an instant or sorcery card'
  ) {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('instant') || typeLine.includes('sorcery')) return i + 1;
    }
    return library.length;
  }

  if (raw === 'until you exile a legendary card' || raw === 'until they exile a legendary card') {
    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('legendary')) return i + 1;
    }
    return library.length;
  }

  {
    const discoverMatch = raw.match(/^until (?:they|you) exile a nonland card with mana value (\d+|x) or less$/i);
    if (discoverMatch) {
      const thresholdRaw = String(discoverMatch[1] || '').trim().toLowerCase();
      let threshold: number;
      if (thresholdRaw === 'x') {
        const xValue = Number(ctx?.xValue);
        if (!Number.isFinite(xValue)) return null;
        threshold = Math.max(0, Math.floor(xValue));
      } else {
        threshold = Number(thresholdRaw);
        if (!Number.isFinite(threshold) || threshold < 0) return null;
      }

      for (let i = 0; i < library.length; i++) {
        const typeLine = getCardTypeLineLower(library[i]);
        if (!typeLine) return null;
        if (typeLine.includes('land')) continue;

        const manaValue = getCardManaValue(library[i]);
        if (manaValue === null) return null;
        if (manaValue <= threshold) return i + 1;
      }
      return library.length;
    }
  }

  const totalMvMatch = raw.match(
    /^until (?:they|you) have exiled cards with total mana value (\d+) or greater(?: this way)?$/
  );
  if (totalMvMatch) {
    const threshold = Number(totalMvMatch[1]);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;

    let total = 0;
    for (let i = 0; i < library.length; i++) {
      const manaValue = getCardManaValue(library[i]);
      if (manaValue === null) return null;
      total += manaValue;
      if (total >= threshold) return i + 1;
    }
    return library.length;
  }

  if (
    raw === 'until they exile a card that shares a card type with it' ||
    raw === 'until you exile a card that shares a card type with it'
  ) {
    const refTypes = Array.isArray(ctx?.referenceSpellTypes)
      ? new Set(ctx.referenceSpellTypes.map(t => String(t || '').toLowerCase()).filter(Boolean))
      : null;
    if (!refTypes || refTypes.size === 0) return null;

    for (let i = 0; i < library.length; i++) {
      const cardTypes = getCardTypesFromTypeLine(library[i]);
      if (!cardTypes) return null;
      if (cardTypes.some(type => refTypes.has(type))) return i + 1;
    }
    return library.length;
  }

  if (
    raw === "until you exile a nonland card whose mana value is less than this spell's mana value" ||
    raw === "until they exile a nonland card whose mana value is less than this spell's mana value"
  ) {
    const referenceManaValue = Number(ctx?.referenceSpellManaValue);
    if (!Number.isFinite(referenceManaValue)) return null;

    for (let i = 0; i < library.length; i++) {
      const typeLine = getCardTypeLineLower(library[i]);
      if (!typeLine) return null;
      if (typeLine.includes('land')) continue;

      const manaValue = getCardManaValue(library[i]);
      if (manaValue === null) return null;
      if (manaValue < referenceManaValue) return i + 1;
    }
    return library.length;
  }

  return null;
}

