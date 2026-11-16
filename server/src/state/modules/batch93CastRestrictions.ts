// server/src/state/modules/batch93CastRestrictions.ts
// B93: Firestorm Phoenix "can't play it until owner's next turn" and Mana Maze
// "players can't cast spells that share a color with the spell most recently
// cast this turn." Public: isCardUnplayableUntilOwnersNextTurn,
// clearCantPlayUntilOwnersNextTurnForPlayer, manaMazeCastViolation,
// findBatch93CastRestrictionViolation.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const MAZE_RE = /players can't cast spells that share a color with the spell most recently cast this turn/i;

export function parseManaMazeSentence(oracle: string): boolean {
  return MAZE_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function isCardUnplayableUntilOwnersNextTurn(card: any, state: any, playerId?: string): { prohibited: boolean; reason?: string } {
  const rec = card?.card || card;
  if (!rec || rec.cantPlayUntilOwnersNextTurn !== true) return { prohibited: false };
  const owner = String(rec.cantPlayOwnerId || rec.owner || playerId || '').trim();
  // Cleared at the start of the owner's next turn; while the flag remains, it cannot be played.
  return {
    prohibited: true,
    reason: `${String(rec.name || rec.card?.name || 'That card')} is revealed and can't be played until its owner's next turn.`,
  };
}

export function clearCantPlayUntilOwnersNextTurnForPlayer(state: any, playerId: string): void {
  const pid = String(playerId || '');
  if (!pid || !state) return;
  const hand: any[] = state?.zones?.[pid]?.hand;
  if (!Array.isArray(hand)) return;
  for (const card of hand) {
    const rec = card?.card && card.cantPlayUntilOwnersNextTurn == null ? card.card : card;
    if (!rec || rec.cantPlayUntilOwnersNextTurn !== true) continue;
    const owner = String(rec.cantPlayOwnerId || card?.owner || rec.owner || pid);
    if (owner !== pid) continue;
    rec.cantPlayUntilOwnersNextTurn = false;
    rec.playRevealedInHand = false;
  }
}

function colorsOf(card: any): string[] {
  const raw = card?.colors ?? card?.card?.colors ?? card?.color_identity ?? card?.card?.color_identity;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((c: any) => String(c || '').toUpperCase()).filter((c: string) => /[WUBRG]/.test(c));
  }
  const out = new Set<string>();
  const cost = String(card?.mana_cost || card?.card?.mana_cost || card?.manaCost || '');
  for (const m of cost.matchAll(/\{([WUBRG])\}/gi)) out.add(m[1].toUpperCase());
  return [...out];
}

export function findMostRecentlyCastSpellThisTurn(state: any): any | null {
  const list = state?.spellsCastThisTurn;
  if (Array.isArray(list) && list.length) return list[list.length - 1];
  return state?.mostRecentlyCastSpellThisTurn || null;
}

export function manaMazeCastViolation(state: any, spell: any): string | null {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const has = battlefield.some((p: any) => p && p.phasedOut !== true && parseManaMazeSentence(readCardOracleText(p.card || p)));
  if (!has) return null;
  const last = findMostRecentlyCastSpellThisTurn(state);
  if (!last) return null;
  const lastCard = last.card || last.spell || last;
  const a = colorsOf(spell?.card || spell);
  const b = colorsOf(lastCard);
  if (!a.length || !b.length) return null;
  if (!a.some((c) => b.includes(c))) return null;
  return "Mana Maze: you can't cast a spell that shares a color with the spell most recently cast this turn.";
}

export function findBatch93CastRestrictionViolation(state: any, playerId: string, spell: any): { prohibited: boolean; reason?: string } {
  const unplayable = isCardUnplayableUntilOwnersNextTurn(spell, state, playerId);
  if (unplayable.prohibited) return unplayable;
  const maze = manaMazeCastViolation(state, spell);
  if (maze) return { prohibited: true, reason: maze };
  return { prohibited: false };
}
