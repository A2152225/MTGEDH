// server/src/state/modules/manaSpendAsThough.ts
// Celestial Dawn / Mycosynth Lattice spend-as-though rules for payment
// validation and auto-pay.

import {
  parsePlayersSpendManaAsAnyColor,
  parseSpendColorManaAsAny,
  parseSpendOtherManaOnlyColorless,
} from './batch103Parsers.js';

export type SpendManaColor = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
export const SPEND_MANA_COLORS: SpendManaColor[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

export type ManaSpendAsThoughRules = {
  /** Mycosynth Lattice: all players may spend mana as though it were mana of any color. */
  anyColor: boolean;
  /** Celestial Dawn (controller only): spend this color as though it were any color. */
  colorAsAny: SpendManaColor | null;
  /** Celestial Dawn (controller only): other mana may be spent only as colorless. */
  otherOnlyColorless: boolean;
};

export const DEFAULT_MANA_SPEND_RULES: ManaSpendAsThoughRules = {
  anyColor: false,
  colorAsAny: null,
  otherOnlyColorless: false,
};

const COLOR_WORD_TO_KEY: Record<string, SpendManaColor> = {
  white: 'white', blue: 'blue', black: 'black', red: 'red', green: 'green', colorless: 'colorless',
  W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless',
};

export function manaColorKey(raw: string): SpendManaColor | null {
  const key = COLOR_WORD_TO_KEY[String(raw || '').trim()] || COLOR_WORD_TO_KEY[String(raw || '').trim().toLowerCase()];
  return key || null;
}

export function getManaSpendAsThoughRules(state: any, playerId: string): ManaSpendAsThoughRules {
  const rules: ManaSpendAsThoughRules = { ...DEFAULT_MANA_SPEND_RULES };
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const pid = String(playerId || '');
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    if (!oracle) continue;
    if (parsePlayersSpendManaAsAnyColor(oracle)) rules.anyColor = true;
    if (String(permanent.controller || '') !== pid) continue;
    const colorAsAny = parseSpendColorManaAsAny(oracle);
    if (colorAsAny && COLOR_WORD_TO_KEY[colorAsAny]) rules.colorAsAny = COLOR_WORD_TO_KEY[colorAsAny];
    if (parseSpendOtherManaOnlyColorless(oracle)) rules.otherOnlyColorless = true;
  }
  if (rules.anyColor) {
    rules.colorAsAny = null;
    rules.otherOnlyColorless = false;
  }
  return rules;
}

/**
 * Can `from` mana be spent to pay `need`?
 * `need` is a colored/colorless symbol or 'generic'.
 */
export function canSpendManaAs(
  from: SpendManaColor,
  need: SpendManaColor | 'generic',
  rules: ManaSpendAsThoughRules = DEFAULT_MANA_SPEND_RULES,
): boolean {
  if (need === 'generic') return true;
  if (rules.anyColor) return need !== 'colorless' || from === 'colorless';
  if (rules.colorAsAny && from === rules.colorAsAny) return need !== 'colorless';
  if (rules.otherOnlyColorless) return need === 'colorless';
  if (need === 'colorless') return from === 'colorless';
  return from === need;
}


const KEY_TO_LETTER: Record<SpendManaColor, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
};

export function colorAmountFromCost(colors: Record<string, number> | undefined, key: SpendManaColor): number {
  if (!colors) return 0;
  const letter = KEY_TO_LETTER[key];
  return Math.max(0, Math.floor(Number(colors[key] || colors[letter] || colors[letter.toLowerCase()] || 0)));
}

export function copyManaPool(pool: Record<string, number> | null | undefined): Record<SpendManaColor, number> {
  const out = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  if (!pool) return out;
  for (const key of SPEND_MANA_COLORS) out[key] = Math.max(0, Math.floor(Number(pool[key] || 0)));
  return out;
}

function takeMana(
  pool: Record<SpendManaColor, number>,
  need: SpendManaColor | 'generic',
  rules: ManaSpendAsThoughRules,
  prefer: SpendManaColor[] = SPEND_MANA_COLORS,
): SpendManaColor | null {
  const order = [...prefer];
  for (const from of order) {
    if ((pool[from] || 0) <= 0) continue;
    if (!canSpendManaAs(from, need, rules)) continue;
    pool[from] -= 1;
    return from;
  }
  return null;
}

export type ParsedSpendCost = {
  colors?: Record<string, number>;
  generic?: number;
  hybrid?: Array<string[]>;
  hybrids?: Array<string[]>;
};

export function canPayManaCostWithSpendAsThough(
  pool: Record<string, number>,
  parsedCost: ParsedSpendCost,
  rules: ManaSpendAsThoughRules = DEFAULT_MANA_SPEND_RULES,
): boolean {
  const left = copyManaPool(pool);
  const colors = parsedCost.colors || {};
  for (const key of SPEND_MANA_COLORS) {
    const amount = colorAmountFromCost(colors, key);
    for (let i = 0; i < amount; i++) {
      const preferred = [key, ...SPEND_MANA_COLORS.filter((c) => c !== key)];
      if (!takeMana(left, key, rules, preferred)) return false;
    }
  }
  const hybrids = parsedCost.hybrid || parsedCost.hybrids || [];
  for (const group of hybrids) {
    const needs = (Array.isArray(group) ? group : [])
      .map((part) => manaColorKey(String(part)))
      .filter((part): part is SpendManaColor => Boolean(part));
    let paid = false;
    for (const need of needs) {
      if (takeMana(left, need, rules, [need, ...SPEND_MANA_COLORS.filter((c) => c !== need)])) {
        paid = true;
        break;
      }
    }
    if (!paid) return false;
  }
  const generic = Math.max(0, Math.floor(Number(parsedCost.generic || 0)));
  for (let i = 0; i < generic; i++) {
    if (!takeMana(left, 'generic', rules, ['colorless', 'white', 'blue', 'black', 'red', 'green'])) return false;
  }
  return true;
}

/** Deduct a parsed cost from a pool under spend-as-though rules. Returns false if unpaid. */
export function payManaCostWithSpendAsThough(
  pool: Record<string, number>,
  parsedCost: ParsedSpendCost,
  rules: ManaSpendAsThoughRules = DEFAULT_MANA_SPEND_RULES,
): boolean {
  if (!canPayManaCostWithSpendAsThough(pool, parsedCost, rules)) return false;
  const left = copyManaPool(pool);
  const colors = parsedCost.colors || {};
  for (const key of SPEND_MANA_COLORS) {
    const amount = colorAmountFromCost(colors, key);
    for (let i = 0; i < amount; i++) {
      takeMana(left, key, rules, [key, ...SPEND_MANA_COLORS.filter((c) => c !== key)]);
    }
  }
  const hybrids = parsedCost.hybrid || parsedCost.hybrids || [];
  for (const group of hybrids) {
    const needs = (Array.isArray(group) ? group : [])
      .map((part) => manaColorKey(String(part)))
      .filter((part): part is SpendManaColor => Boolean(part));
    for (const need of needs) {
      if (takeMana(left, need, rules, [need, ...SPEND_MANA_COLORS.filter((c) => c !== need)])) break;
    }
  }
  const generic = Math.max(0, Math.floor(Number(parsedCost.generic || 0)));
  for (let i = 0; i < generic; i++) {
    takeMana(left, 'generic', rules, ['colorless', 'white', 'blue', 'black', 'red', 'green']);
  }
  for (const key of SPEND_MANA_COLORS) pool[key] = left[key];
  return true;
}

export function effectiveSpendOptions(
  produced: readonly string[],
  rules: ManaSpendAsThoughRules = DEFAULT_MANA_SPEND_RULES,
): SpendManaColor[] {
  const producedKeys = produced
    .map((part) => manaColorKey(String(part)))
    .filter((part): part is SpendManaColor => Boolean(part));
  const out = new Set<SpendManaColor>();
  const colored: SpendManaColor[] = ['white', 'blue', 'black', 'red', 'green'];
  for (const from of producedKeys) {
    if (rules.anyColor) {
      for (const color of colored) out.add(color);
      if (from === 'colorless') out.add('colorless');
      continue;
    }
    if (rules.colorAsAny && from === rules.colorAsAny) {
      for (const color of colored) out.add(color);
      continue;
    }
    if (rules.otherOnlyColorless) {
      out.add('colorless');
      continue;
    }
    out.add(from);
  }
  return [...out];
}
