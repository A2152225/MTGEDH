import type { GameState, PlayerID } from '../../../../shared/src/types.js';

/**
 * Batch 23: "You can't cast this spell during your first, second, or third turns of the game"
 * (Serra Avenger, Spider-Man 2099, Jace Reawakened). Turns are counted per player in
 * state.turnsStartedByPlayer, recorded at the start of each turn.
 * Public entry symbols: recordTurnStartedForPlayer, ownTurnsStarted, firstTurnsCastViolation.
 */
export function recordTurnStartedForPlayer(state: GameState): void {
  const tp = String(state.turnPlayer || '');
  if (!tp) return;
  const counts = { ...(state.turnsStartedByPlayer || {}) };
  counts[tp] = (counts[tp] || 0) + 1;
  state.turnsStartedByPlayer = counts;
}

/** Turns this player has started; falls back to a round-robin estimate for games without the counter. */
export function ownTurnsStarted(state: GameState, playerId: PlayerID): number {
  const recorded = state.turnsStartedByPlayer?.[playerId];
  if (typeof recorded === 'number') return recorded;
  const n = Math.max(1, (state.players || []).length);
  return Math.ceil(Math.max(1, Number(state.turnNumber) || 1) / n);
}

const FIRST_TURNS_RE = /you can't cast (?:this spell|~|[^.\n]+?) during your first, second, or third turns of the game/;

function spellOracle(spell: unknown): string {
  if (!spell || typeof spell !== 'object') return '';
  const direct: unknown = Reflect.get(spell, 'oracle_text');
  const card: unknown = Reflect.get(spell, 'card');
  const nested: unknown = card && typeof card === 'object' ? Reflect.get(card, 'oracle_text') : '';
  const text = typeof direct === 'string' && direct ? direct : (typeof nested === 'string' ? nested : '');
  return text.toLowerCase().replace(/\u2019/g, "'");
}

export function firstTurnsCastViolation(state: GameState, playerId: PlayerID, spell: unknown): string | null {
  if (!FIRST_TURNS_RE.test(spellOracle(spell))) return null;
  if (String(state.turnPlayer || '') !== String(playerId)) return null;
  const turns = ownTurnsStarted(state, playerId);
  return turns <= 3 ? `This spell can't be cast during your first, second, or third turns of the game (turn ${turns}).` : null;
}
