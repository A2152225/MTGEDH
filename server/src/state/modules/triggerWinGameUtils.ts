/**
 * triggerWinGameUtils.ts
 *
 * Generic trigger-effect execute for leftover "you win the game" clauses
 * (landfall / intervening-if remnants) when Oracle IR trigger primary is off
 * or IR does not own the fragment. Entry: tryApplyWinTheGameFromTriggerText
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';

export function tryApplyWinTheGameFromTriggerText(
  ctx: GameContext,
  controller: PlayerID,
  description: string,
  sourceName: string,
): boolean {
  const text = String(description || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text.includes('you win the game')) return false;

  const state = (ctx as any).state;
  if (!state || state.gameOver) return false;

  state.winner = controller;
  state.gameOver = true;
  state.winCondition = `${sourceName}: you win the game`;
  if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
  return true;
}
