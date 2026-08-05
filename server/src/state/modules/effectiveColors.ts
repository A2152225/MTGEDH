/**
 * Effective mana colors for permanents/spells, including continuous color additions
 * (Painter's Servant, Alloy Golem, etc.).
 */

import { readDerivedContinuousEffects } from './staticEffectSpec.js';

const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeColorSymbol(raw: string): string | null {
  const key = String(raw || '').trim().toUpperCase();
  if (['W', 'U', 'B', 'R', 'G'].includes(key)) return key;
  const fromWord = COLOR_WORD_TO_SYMBOL[String(raw || '').trim().toLowerCase()];
  return fromWord || null;
}

/**
 * Stamp derived colorAdditions onto battlefield permanents for downstream readers.
 */
export function applyDerivedColorAdditionsToBattlefield(state: unknown): void {
  if (!state || typeof state !== 'object') return;
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  const derived = readDerivedContinuousEffects(state);
  const additions = derived?.colorAdditions;

  for (const permanent of battlefield) {
    if (!permanent) continue;
    const id = String(permanent.id || '');
    const fromDerived = additions?.get(id) || [];
    if (fromDerived.length > 0) {
      (permanent as any).colorAdditions = [...fromDerived];
    } else if ((permanent as any).colorAdditions) {
      delete (permanent as any).colorAdditions;
    }
  }
}

/**
 * Global "are the chosen color in addition…" effects (Painter's Servant) apply to
 * cards, spells, and permanents — including objects that are not on the battlefield map.
 */
function collectGlobalColorAdditions(state: unknown): string[] {
  if (!state || typeof state !== 'object') return [];
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  const colors: string[] = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const oracle = String(permanent.card.oracle_text || '');
    if (!/are the chosen colou?r in addition to their other colors/i.test(oracle)) continue;
    const symbol = normalizeColorSymbol(
      permanent.chosenColor || permanent.card?.chosenColor || '',
    );
    if (symbol && !colors.includes(symbol)) colors.push(symbol);
  }
  return colors;
}

export function getEffectiveColors(
  object: { colors?: readonly string[]; colorAdditions?: readonly string[]; card?: any } | null | undefined,
  state?: unknown,
): string[] {
  if (!object) return [];
  const printed = Array.isArray(object.colors)
    ? object.colors
    : Array.isArray(object.card?.colors)
      ? object.card.colors
      : [];
  const base = printed.map((c) => normalizeColorSymbol(String(c))).filter(Boolean) as string[];

  let additions: string[] = [];
  if (Array.isArray((object as any).colorAdditions)) {
    additions = ((object as any).colorAdditions as string[])
      .map((c) => normalizeColorSymbol(String(c)))
      .filter(Boolean) as string[];
  } else if (state && (object as any).id) {
    const derived = readDerivedContinuousEffects(state);
    const fromMap = derived?.colorAdditions?.get(String((object as any).id)) || [];
    additions = fromMap.map((c) => normalizeColorSymbol(String(c))).filter(Boolean) as string[];
  }

  if (state) {
    for (const color of collectGlobalColorAdditions(state)) {
      if (!additions.includes(color)) additions.push(color);
    }
  }

  return [...new Set([...base, ...additions])];
}

export function objectHasManaColor(
  object: { colors?: readonly string[]; colorAdditions?: readonly string[]; card?: any } | null | undefined,
  colorNameOrSymbol: string,
  state?: unknown,
): boolean {
  const symbol = normalizeColorSymbol(colorNameOrSymbol);
  if (!symbol) return false;
  return getEffectiveColors(object, state).includes(symbol);
}
