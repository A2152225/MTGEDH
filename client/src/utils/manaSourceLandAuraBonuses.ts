/**
 * Client payment-source helpers for stored chosen colors (Thriving Grove) and
 * land auras that add mana when the enchanted land is tapped (Fertile Ground,
 * Wild Growth, Utopia Sprawl, Overgrowth).
 */
import type { BattlefieldPermanent, ManaColor } from '../../../shared/src';

export const ANY_COLOR_BONUS_OPTIONS: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];

export type ManaBonusChunk = {
  options: ManaColor[];
  amount: number;
  /** All mana from this chunk must be the same color (Dawn's Reflection). */
  sameColor?: boolean;
};

const COLOR_NAME_TO_SYMBOL: Record<string, ManaColor> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  w: 'W',
  u: 'U',
  b: 'B',
  r: 'R',
  g: 'G',
};

const COLOR_SYMBOLS: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function resolveClientPermanentChosenColorSymbol(permanent: unknown): ManaColor | null {
  const record = permanent as {
    chosenColor?: unknown;
    chosenMana?: unknown;
    card?: { chosenColor?: unknown; chosenMana?: unknown };
  } | null | undefined;

  const candidates = [
    record?.chosenColor,
    record?.chosenMana,
    record?.card?.chosenColor,
    record?.card?.chosenMana,
  ];

  for (const raw of candidates) {
    const text = String(raw || '').trim();
    if (!text) continue;

    const braceMatch = text.match(/^\{([WUBRG])\}$/i);
    if (braceMatch?.[1]) {
      return braceMatch[1].toUpperCase() as ManaColor;
    }

    const lower = text.toLowerCase();
    if (COLOR_NAME_TO_SYMBOL[lower]) return COLOR_NAME_TO_SYMBOL[lower];

    const upper = text.toUpperCase();
    if ((COLOR_SYMBOLS as readonly string[]).includes(upper) && upper !== 'C') {
      return upper as ManaColor;
    }
  }

  return null;
}

function isAuraOrAttachedTo(perm: BattlefieldPermanent, hostId: string): boolean {
  const attachedTo = String((perm as { attachedTo?: string }).attachedTo || '').trim();
  if (attachedTo && attachedTo === hostId) return true;
  const enchanting = String((perm as { enchanting?: string }).enchanting || '').trim();
  return Boolean(enchanting && enchanting === hostId);
}

function parseTapForManaAuraBonus(
  oracleText: string,
  auraPermanent: BattlefieldPermanent,
): ManaBonusChunk[] {
  const text = String(oracleText || '');
  if (!/tapped for mana/i.test(text) || !/\badds?\b/i.test(text)) return [];

  const twoAnyOneColor = /(?:add|adds)\s+two\s+mana\s+of\s+any(?:\s+one)?\s+color/i.test(text);
  if (twoAnyOneColor) {
    return [{ options: [...ANY_COLOR_BONUS_OPTIONS], amount: 2, sameColor: true }];
  }

  if (/mana\s+of\s+any(?:\s+one)?\s+color/i.test(text)) {
    return [{ options: [...ANY_COLOR_BONUS_OPTIONS], amount: 1 }];
  }

  if (/mana\s+of\s+the\s+chosen\s+colou?r/i.test(text)) {
    const chosen = resolveClientPermanentChosenColorSymbol(auraPermanent);
    if (!chosen) return [];
    return [{ options: [chosen], amount: 1 }];
  }

  const multiSymbols = text.match(/adds?\s+((?:\{[WUBRGC]\}){2,})/i);
  if (multiSymbols?.[1]) {
    const symbols = Array.from(String(multiSymbols[1]).matchAll(/\{([WUBRGC])\}/gi))
      .map((match) => String(match[1] || '').toUpperCase() as ManaColor)
      .filter((color) => COLOR_SYMBOLS.includes(color));
    if (symbols.length >= 2 && symbols.every((color) => color === symbols[0])) {
      return [{ options: [symbols[0]], amount: symbols.length }];
    }
    if (symbols.length >= 2) {
      return [{ options: [...new Set(symbols)], amount: symbols.length, sameColor: true }];
    }
  }

  const singleSymbol = text.match(/adds?(?:\s+an\s+additional)?\s*\{([WUBRGC])\}/i)
    || text.match(/additional\s*\{([WUBRGC])\}/i);
  if (singleSymbol?.[1]) {
    const color = String(singleSymbol[1] || '').toUpperCase() as ManaColor;
    if (COLOR_SYMBOLS.includes(color)) {
      return [{ options: [color], amount: 1 }];
    }
  }

  return [];
}

export function collectLandAuraManaBonuses(
  perm: BattlefieldPermanent,
  battlefield: BattlefieldPermanent[],
): ManaBonusChunk[] {
  const hostId = String(perm?.id || '').trim();
  if (!hostId) return [];

  const chunks: ManaBonusChunk[] = [];
  for (const candidate of battlefield) {
    if (!candidate || !isAuraOrAttachedTo(candidate, hostId)) continue;
    const oracleText = String((candidate as { card?: { oracle_text?: string }; oracle_text?: string }).oracle_text
      || (candidate as { card?: { oracle_text?: string } }).card?.oracle_text
      || '');
    chunks.push(...parseTapForManaAuraBonus(oracleText, candidate));
  }
  return chunks;
}
