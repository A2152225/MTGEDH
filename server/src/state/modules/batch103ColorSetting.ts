// server/src/state/modules/batch103ColorSetting.ts
// B103 layer 5 colour setting for Mycosynth Lattice ("all cards that aren't
// on the battlefield, spells, and permanents are colorless") and Celestial
// Dawn ("nonland permanents you control are COLOR. The same is true for
// spells you control and nonland cards you own that aren't on the battlefield").
// Public: readBatch103ColorSetting. Hooked from getEffectiveColors.

import {
  parseOffBattlefieldSpellsAndPermanentsColorless,
  parseNonlandPermanentsYouControlAreColor,
} from './batch103Parsers.js';

const WORD: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(object: any): string {
  return String(object?.card?.type_line || object?.type_line || '').toLowerCase();
}

function isOnBattlefield(state: any, object: any): boolean {
  const id = String(object?.id || '').trim();
  if (!id) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm) => perm && String(perm.id || '') === id);
}

function controllerOf(object: any): string {
  return String(object?.controller || object?.card?.controller || '').trim();
}

function ownerOf(object: any): string {
  return String(object?.owner || object?.card?.owner || controllerOf(object)).trim();
}

function isNonland(object: any): boolean {
  return !/\bland\b/.test(typeLineOf(object));
}

/**
 * Colour setters from B103 global / controller-scoped lines.
 * colorless=true means the object's colours are set to none.
 */
export function readBatch103ColorSetting(state: any, object: any): { set: string[]; colorless: boolean } {
  const out = { set: [] as string[], colorless: false };
  if (!state || !object) return out;
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  const onBf = isOnBattlefield(state, object);
  const zone = String(object?.zone || object?.card?.zone || '').toLowerCase();
  const isSpell = zone === 'stack' || object?.isSpell === true || object?.onStack === true;
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    const oracle = oracleOf(perm);
    if (parseOffBattlefieldSpellsAndPermanentsColorless(oracle)) {
      // Permanents, spells, and cards not on the battlefield — every game object.
      out.colorless = true;
      out.set = [];
      return out;
    }
    const colorWord = parseNonlandPermanentsYouControlAreColor(oracle);
    if (!colorWord) continue;
    const controller = String(perm.controller || '').trim();
    if (!controller || !isNonland(object)) continue;
    const symbol = WORD[colorWord];
    if (!symbol) continue;
    if (onBf) {
      if (controllerOf(object) !== controller) continue;
    } else if (isSpell) {
      if (controllerOf(object) !== controller) continue;
    } else {
      // Nonland cards you own that aren't on the battlefield.
      if (ownerOf(object) !== controller) continue;
    }
    if (!out.set.includes(symbol)) out.set.push(symbol);
  }
  if (out.set.length > 0) out.colorless = false;
  return out;
}
