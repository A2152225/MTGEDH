import type { KnownCardRef } from './types.js';

export type CardOracleLookupRecord = Pick<
  KnownCardRef,
  | 'oracle_text'
  | 'type_line'
  | 'mana_cost'
  | 'power'
  | 'toughness'
  | 'loyalty'
  | 'card_faces'
  | 'layout'
  | 'colors'
  | 'color_identity'
>;

export type CardOracleLookup = (name: string) => CardOracleLookupRecord | undefined;

/** Prototype tokens (Soldier, Treasure, etc.) — not copies of a printed card. */
export function isPrototypeTokenCard(card: unknown): boolean {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  const typeLine = String((card as { type_line?: string }).type_line || '').trim();
  return /^token\b/i.test(typeLine);
}

export function isPrintedCardCopyToken(
  card: unknown,
  options?: { isToken?: boolean; isCopyToken?: boolean; copiedFromPermanentId?: string },
): boolean {
  const isToken = options?.isToken === true || (card as { isToken?: boolean })?.isToken === true;
  if (!isToken) return false;
  if (options?.isCopyToken === true) return true;
  if (String(options?.copiedFromPermanentId || '').trim()) return true;
  // Prototype tokens may share a name with a printed card (e.g. Horn of Gondor's
  // "Human Soldier" tokens). Only explicit copy flags should pull printed oracle text.
  return false;
}

export function cardShouldHydrateOracleText(
  card: unknown,
  options?: {
    isToken?: boolean;
    isFaceDown?: boolean;
    isCopyToken?: boolean;
    copiedFromPermanentId?: string;
  },
): boolean {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  if (options?.isFaceDown === true) return false;

  const isToken = options?.isToken === true || (card as { isToken?: boolean }).isToken === true;
  if (isToken && !isPrintedCardCopyToken(card, options)) return false;

  const name = String((card as { name?: string }).name || '').trim();
  if (!name || name === 'Face-down Creature') return false;

  const oracleText = String((card as { oracle_text?: string }).oracle_text || '').trim();
  const manaCost = String(
    (card as { mana_cost?: string; manaCost?: string }).mana_cost
    || (card as { manaCost?: string }).manaCost
    || '',
  ).trim();
  const typeLine = String(
    (card as { type_line?: string; typeLine?: string }).type_line
    || (card as { typeLine?: string }).typeLine
    || '',
  ).trim();
  // Repair thin / post-reload stubs that kept oracle text (or images) but lost cast fields.
  if (!oracleText || !manaCost || !typeLine) return true;

  // Copy tokens may have only override keywords (e.g. "Haste") applied before hydration runs.
  if (isPrintedCardCopyToken(card, options) && !oracleText.includes('\n') && oracleText.length < 80) {
    return true;
  }

  return false;
}

function isThinCopyOverrideOracle(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  if (trimmed.includes('\n')) return false;
  if (trimmed.length >= 80) return false;
  if (/\bwhenever\b/i.test(trimmed) || /\bat the beginning\b/i.test(trimmed)) return false;
  return true;
}

export function mergeOracleFieldsFromLookup(
  card: Record<string, unknown>,
  lookup: CardOracleLookup,
  options?: { replaceThinOracle?: boolean },
): boolean {
  const name = String(card.name || '').trim();
  if (!name) return false;

  const record = lookup(name);
  if (!record) return false;

  let changed = false;
  const existingOracle = String(card.oracle_text || '').trim();
  const shouldReplaceOracle =
    !existingOracle
    || (options?.replaceThinOracle === true && isThinCopyOverrideOracle(existingOracle));
  if (record.oracle_text && shouldReplaceOracle) {
    card.oracle_text = record.oracle_text;
    changed = true;
  }
  if (record.type_line && !String(card.type_line || '').trim()) {
    card.type_line = record.type_line;
    changed = true;
  }
  if (record.mana_cost && !String(card.mana_cost || '').trim()) {
    card.mana_cost = record.mana_cost;
    changed = true;
  }
  if (record.power != null && card.power == null) {
    card.power = record.power;
    changed = true;
  }
  if (record.toughness != null && card.toughness == null) {
    card.toughness = record.toughness;
    changed = true;
  }
  if (record.loyalty != null && card.loyalty == null) {
    card.loyalty = record.loyalty;
    changed = true;
  }
  if (record.card_faces && !card.card_faces) {
    card.card_faces = record.card_faces;
    changed = true;
  }
  if (record.layout && !card.layout) {
    card.layout = record.layout;
    changed = true;
  }
  if (record.colors && !card.colors) {
    card.colors = record.colors;
    changed = true;
  }
  if (record.color_identity && !card.color_identity) {
    card.color_identity = record.color_identity;
    changed = true;
  }

  return changed;
}

export function hydratePermanentCardOracle(
  permanent: {
    card?: unknown;
    isToken?: boolean;
    isFaceDown?: boolean;
    isCopyToken?: boolean;
    copiedFromPermanentId?: string;
  },
  lookup: CardOracleLookup,
): boolean {
  if (!permanent?.card || typeof permanent.card !== 'object' || Array.isArray(permanent.card)) {
    return false;
  }
  if (!cardShouldHydrateOracleText(permanent.card, {
    isToken: permanent.isToken === true,
    isFaceDown: permanent.isFaceDown === true,
    isCopyToken: permanent.isCopyToken === true,
    copiedFromPermanentId: permanent.copiedFromPermanentId,
  })) {
    return false;
  }
  return mergeOracleFieldsFromLookup(permanent.card as Record<string, unknown>, lookup, {
    replaceThinOracle: permanent.isCopyToken === true,
  });
}

export function hydrateCardOracle(
  card: unknown,
  lookup: CardOracleLookup,
  options?: { isToken?: boolean; isCopyToken?: boolean; copiedFromPermanentId?: string },
): boolean {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  if (!cardShouldHydrateOracleText(card, options)) return false;
  return mergeOracleFieldsFromLookup(card as Record<string, unknown>, lookup, {
    replaceThinOracle: options?.isCopyToken === true,
  });
}
