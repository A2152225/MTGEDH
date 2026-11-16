// rules-engine/src/batch105ConniveReplacement.ts
// If a creature you control would connive, instead you draw a card, then that creature connives.

import type { GameState, PlayerID } from '../../shared/src';
import { drawCardsForPlayer } from './oracleIRExecutorPlayerUtils';

const LEADER_RE = /if a creature you control would connive, instead you draw a card, then that creature connives/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function isCreature(perm: any): boolean {
  return /\bcreature\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
}

export function applyBatch105PreConniveDraw(
  state: GameState,
  target: any,
  targetControllerId: PlayerID,
): { state: GameState; drawn: number } {
  if (!target || !isCreature(target)) return { state, drawn: 0 };
  const controller = String(target.controller || targetControllerId || '').trim();
  if (!controller) return { state, drawn: 0 };
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const sources = battlefield.filter((src: any) =>
    src
    && src.phasedOut !== true
    && String(src.controller || '') === controller
    && LEADER_RE.test(oracleOf(src)),
  );
  if (sources.length === 0) return { state, drawn: 0 };
  let next = state;
  let drawn = 0;
  for (let i = 0; i < sources.length; i += 1) {
    const result = drawCardsForPlayer(next, controller as PlayerID, 1);
    next = result.state;
    drawn += 1;
  }
  return { state: next, drawn };
}
