// server/src/socket/game-actions-handlers/spellCastXUpperBound.ts
// Upper bound offered in the spell-cast "Choose X" prompt. Used to be a flat 20, which capped
// big convoke turns (71 Soldiers + Pearl Medallion, issue #55). The bound counts every way the
// player could produce payment: floating mana, untapped mana-producing permanents (a source that
// adds several mana counts its largest "Add {..}{..}"), untapped creatures when the spell has
// convoke, and generic cost reducers on the battlefield. It's a ceiling only; payment is still
// validated on cast. Never below the old 20 so nothing that worked before gets tighter.
// Public entry symbols: computeSpellCastXUpperBound.

import { spellHasConvokeForCast } from "../../state/modules/casting-modifiers.js";

const DEFAULT_X_CAP = 20;

function manaSymbolsInBiggestAdd(oracle: string): number {
  let best = 0;
  const re = /\badd ((?:\{[^}]+\})+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(oracle)) !== null) {
    best = Math.max(best, (m[1].match(/\{[^}]+\}/g) || []).length);
  }
  if (best === 0 && /\badd (?:one|two|three) mana\b|\badd an amount of\b|\badd x mana\b/i.test(oracle)) best = 1;
  return best;
}

function nonXManaValue(manaCost: string): number {
  let total = 0;
  for (const sym of String(manaCost || '').match(/\{[^}]+\}/g) || []) {
    const inner = sym.slice(1, -1).toUpperCase();
    if (inner === 'X') continue;
    total += /^\d+$/.test(inner) ? Number(inner) : 1;
  }
  return total;
}

export function computeSpellCastXUpperBound(
  game: any,
  playerId: string,
  card: any,
  manaCost: string,
  xCount: number,
  castSourceZone?: string,
): number {
  try {
    const state = game?.state || {};
    const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
    const pool = state.manaPool?.[playerId] || {};
    let available = 0;
    for (const value of Object.values(pool)) if (typeof value === 'number') available += Math.max(0, value);

    const convoke = spellHasConvokeForCast(state, playerId as any, card, castSourceZone);
    let reducers = 0;
    for (const perm of battlefield) {
      if (!perm || String(perm.controller || '') !== String(playerId)) continue;
      const oracle = String(perm.card?.oracle_text || '');
      const typeLine = String(perm.card?.type_line || '').toLowerCase();
      if (/\bspells? you cast cost \{(\d+)\} less\b/i.test(oracle)) {
        reducers += Number(oracle.match(/cost \{(\d+)\} less/i)?.[1] || 0);
      }
      if (perm.tapped) continue;
      const producesMana = typeLine.includes('land') ? Math.max(1, manaSymbolsInBiggestAdd(oracle)) : manaSymbolsInBiggestAdd(oracle);
      const isCreature = typeLine.includes('creature');
      // A creature either taps for mana or convokes, never both.
      available += convoke && isCreature ? Math.max(1, producesMana) : producesMana;
    }
    const perX = Math.max(1, Math.floor(Number(xCount) || 1));
    const bound = Math.floor(Math.max(0, available + reducers - nonXManaValue(manaCost)) / perX);
    return Math.max(DEFAULT_X_CAP, bound);
  } catch {
    return DEFAULT_X_CAP;
  }
}
