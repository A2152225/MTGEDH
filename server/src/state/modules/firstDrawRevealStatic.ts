// server/src/state/modules/firstDrawRevealStatic.ts
// B51: "Reveal the first card you draw each turn" / "... on each of your turns" (Primitive Etchings, Rowen,
// Keranos, Serendib Djinn-style reveal statics). This is a static instruction applied at the draw point: the
// first card a player draws each turn is revealed while a permanent they control has the text. The
// "Whenever you reveal a <kind> card this way" follow-up triggers stay in triggers/card-draw.ts (trigger worker).
// Origin parent: zones-handlers/zonesDrawCards.ts processDrawTriggers (draw-number bookkeeping lives there).
// Public entry symbols: FIRST_DRAW_REVEAL_RE, firstDrawRevealSources, applyFirstDrawReveal,
// optionalFirstDrawRevealPermanent, queueOptionalFirstDrawReveal, applyOptionalFirstDrawRevealChoice.

import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';

export const FIRST_DRAW_REVEAL_RE = /\breveal the first card you draw (each turn|on each of your turns)\b/i;

const MAX_REVEAL_LOG = 20;

/** Names of permanents controlled by playerId that reveal that player's first draw this turn. */
export function firstDrawRevealSources(state: any, playerId: string): string[] {
  const out: string[] = [];
  const active = String(state?.turnPlayer || state?.activePlayer || '');
  for (const perm of state?.battlefield || []) {
    if (!perm || perm.faceDown || String(perm.controller || '') !== String(playerId)) continue;
    const oracle = String(perm?.card?.oracle_text || '');
    if (/you may reveal the first card you draw/i.test(oracle)) continue;
    const m = FIRST_DRAW_REVEAL_RE.exec(oracle);
    if (!m) continue;
    if (m[1].toLowerCase() === 'on each of your turns' && active !== String(playerId)) continue;
    const name = String(perm?.card?.name || 'Permanent');
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Reveals drawnCard when it is the player's first draw this turn and a reveal source applies.
 * Marks the hand card (revealedOnDraw) and records state.revealedDraws / state.lastRevealedDraw for views
 * and logs. Returns the revealing source names (empty when nothing was revealed).
 */
export function applyFirstDrawReveal(ctx: any, playerId: string, drawNumber: number, drawnCard: any): string[] {
  const state = ctx?.state;
  if (!state || drawNumber !== 1 || !drawnCard) return [];
  const sources = firstDrawRevealSources(state, playerId);
  if (!sources.length) return [];
  const turn = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  try { drawnCard.revealedOnDraw = sources; } catch { /* frozen ref */ }
  const entry = {
    playerId: String(playerId),
    cardId: String(drawnCard.id || ''),
    name: String(drawnCard.name || ''),
    type_line: String(drawnCard.type_line || ''),
    revealedBy: sources,
    turn,
  };
  state.lastRevealedDraw = entry;
  const log = Array.isArray(state.revealedDraws) ? state.revealedDraws : (state.revealedDraws = []);
  log.push(entry);
  if (log.length > MAX_REVEAL_LOG) log.splice(0, log.length - MAX_REVEAL_LOG);
  return sources;
}

const OPTIONAL_REVEAL_RE = /you may reveal the first card you draw each turn/i;

export function optionalFirstDrawRevealPermanent(state: any, playerId: string): any | null {
  for (const perm of state?.battlefield || []) {
    if (!perm || String(perm.controller || '') !== String(playerId)) continue;
    if (OPTIONAL_REVEAL_RE.test(String(perm?.card?.oracle_text || ''))) return perm;
  }
  return null;
}

export function queueOptionalFirstDrawReveal(ctx: any, playerId: string, drawnCard: any): boolean {
  const source = optionalFirstDrawRevealPermanent(ctx?.state, playerId);
  if (!source || !drawnCard || drawnCard.revealedOnDraw) return false;
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: String(playerId),
    sourceId: String(source.id || ''),
    sourceName: String(source.card?.name || 'Permanent'),
    description: `${String(source.card?.name || 'Permanent')}: You may reveal ${String(drawnCard.name || 'the card you drew')}.`,
    mandatory: false,
    options: [
      { id: 'reveal', label: 'Reveal it' },
      { id: 'decline', label: 'Leave it hidden' },
    ],
    minSelections: 1,
    maxSelections: 1,
    optionalFirstDrawReveal: true,
    drawnCardId: String(drawnCard.id || ''),
    sourcePermanentId: String(source.id || ''),
  } as any);
  return true;
}

export function applyOptionalFirstDrawRevealChoice(game: any, step: any, choice: string): boolean {
  if (step?.optionalFirstDrawReveal !== true) return false;
  const state = game?.state;
  const playerId = String(step.playerId || '');
  if (choice !== 'reveal' || !state) return true;
  const hand = state?.zones?.[playerId]?.hand;
  const card = Array.isArray(hand) ? hand.find((entry: any) => String(entry?.id || '') === String(step.drawnCardId || '')) : null;
  const source = (state.battlefield || []).find((perm: any) => String(perm?.id || '') === String(step.sourcePermanentId || ''));
  if (card) card.revealedOnDraw = [String(source?.card?.name || 'Permanent')];
  const effect = String(source?.card?.oracle_text || '').match(/whenever you reveal an instant or sorcery card this way,?\s*([^.]+)/i)?.[1]?.trim();
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (effect && card && /\binstant\b|\bsorcery\b/.test(typeLine)) {
    state.stack = Array.isArray(state.stack) ? state.stack : [];
    state.stack.push({
      id: `reveal-${String(card.id || '')}`,
      type: 'triggered_ability',
      controller: playerId,
      source: source?.id,
      permanentId: source?.id,
      sourceName: source?.card?.name,
      description: effect,
      effect,
      triggerType: 'reveal_this_way',
      mandatory: true,
      triggeringPlayer: playerId,
      targetPlayer: playerId,
    });
  }
  return true;
}
