// server/src/state/modules/breathstealersCryptDrawReveal.ts
// Breathstealer's Crypt: if a player would draw a card, instead they draw and
// reveal it; if it's a creature, they discard it unless they pay N life.
// Payment goes through payLifeAmount (Sylex does not block this — it is not a
// spell or activated-ability cost). Public: getBreathstealerDrawRevealTax,
// applyBreathstealerAfterDraw, BREATHSTEALER_PAY_OR_DISCARD_FLAG.

import { parseDrawRevealDiscardCreatureUnlessPayLife } from './batch107Parsers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

export const BREATHSTEALER_PAY_OR_DISCARD_FLAG = 'breathstealerPayOrDiscard';

export function getBreathstealerDrawRevealTax(state: any): { payLife: number; sourceId: string; sourceName: string } | null {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true || permanent.faceDown === true) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    const parsed = parseDrawRevealDiscardCreatureUnlessPayLife(oracle);
    if (!parsed || !(parsed.payLife > 0)) continue;
    return {
      payLife: parsed.payLife,
      sourceId: String(permanent.id || ''),
      sourceName: String(permanent.card?.name || permanent.name || "Breathstealer's Crypt"),
    };
  }
  return null;
}

function isCreatureCard(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || card?.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

function revealDrawnCard(state: any, playerId: string, card: any, sourceName: string): void {
  if (!state || !card) return;
  const sources = [sourceName];
  try { card.revealedOnDraw = sources; } catch { /* frozen ref */ }
  const turn = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  const entry = {
    playerId: String(playerId),
    cardId: String(card.id || ''),
    name: String(card.name || ''),
    type_line: String(card.type_line || card.typeLine || ''),
    revealedBy: sources,
    turn,
  };
  state.lastRevealedDraw = entry;
  const log = Array.isArray(state.revealedDraws) ? state.revealedDraws : (state.revealedDraws = []);
  log.push(entry);
  if (log.length > 20) log.splice(0, log.length - 20);
}

export function applyBreathstealerAfterDraw(ctx: any, playerId: string, drawnCards: any[]): number {
  const state = ctx?.state;
  const tax = getBreathstealerDrawRevealTax(state);
  if (!tax || !Array.isArray(drawnCards) || drawnCards.length === 0) return 0;
  const pid = String(playerId);
  let queued = 0;
  const gameId = String(ctx?.gameId || '').trim();
  for (const card of drawnCards) {
    if (!card) continue;
    revealDrawnCard(state, pid, card, tax.sourceName);
    if (!isCreatureCard(card)) continue;
    if (!gameId || gameId === 'unknown') continue;
    if ((ctx as any)?.isReplaying) continue;
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: pid as any,
      sourceId: tax.sourceId,
      sourceName: tax.sourceName,
      cardId: String(card.id || ''),
      cardName: String(card.name || 'Creature'),
      description: `${tax.sourceName}: ${card.name || 'This creature'} was revealed as it was drawn. Discard it unless you pay ${tax.payLife} life.`,
      mandatory: true,
      amount: tax.payLife,
      [BREATHSTEALER_PAY_OR_DISCARD_FLAG]: true,
      options: [
        { id: 'pay', label: `Pay ${tax.payLife} life` },
        { id: 'discard', label: `Discard ${card.name || 'this card'}` },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);
    queued += 1;
  }
  return queued;
}
