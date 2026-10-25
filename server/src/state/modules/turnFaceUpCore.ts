/**
 * Batch 13: turn a face-down permanent face up (special action, CR 116.2b / 702.37e).
 * Doesn't use the stack and ignores timing restrictions: legal any time the controller has priority.
 * Costs: mana (paid by the socket layer), reveal a COLOR card from hand, or pay N life.
 * Manifested / cloaked creature cards turn face up for their mana cost (CR 701.34b / 701.58c).
 */
import { parseTurnFaceUpCost, revealCandidatesForTurnFaceUp, type TurnFaceUpCost } from './faceDownCasting.js';

export interface TurnFaceUpValidation {
  ok: boolean;
  error?: string;
  code?: string;
  permanent?: any;
  actualCard?: any;
  cost?: TurnFaceUpCost;
}

export function getTurnFaceUpCostForPermanent(perm: any): TurnFaceUpCost | null {
  if (!perm || perm.isFaceDown !== true) return null;
  const real = perm.faceUpCard;
  if (!real) return null;
  const kind = String(perm.faceDownType || 'morph').toLowerCase();
  if (kind === 'morph' || kind === 'megamorph' || kind === 'disguise') {
    // A face-down permanent with no faceDownType keyword on its real card falls through to manifest rules.
    const cost = parseTurnFaceUpCost(real.oracle_text, kind as any)
      || (kind === 'morph' ? (parseTurnFaceUpCost(real.oracle_text, 'megamorph') || parseTurnFaceUpCost(real.oracle_text, 'disguise')) : null);
    if (cost) return cost;
  }
  const realIsCreature = /\bcreature\b/i.test(String(real.type_line || ''));
  const manaCost = String(real.mana_cost || '').trim();
  if ((kind === 'manifest' || kind === 'cloak' || kind === 'manifested' || kind === 'cloaked') && realIsCreature && manaCost) {
    return { kind: 'morph', raw: manaCost, manaCost };
  }
  // Last resort: the real card has a morph-family keyword even if faceDownType is something else.
  return parseTurnFaceUpCost(real.oracle_text, 'megamorph')
    || parseTurnFaceUpCost(real.oracle_text, 'morph')
    || parseTurnFaceUpCost(real.oracle_text, 'disguise');
}

export function validateTurnFaceUp(state: any, playerId: string, permanentId: string): TurnFaceUpValidation {
  const perm = (Array.isArray(state?.battlefield) ? state.battlefield : []).find((p: any) => p && String(p.id) === String(permanentId));
  if (!perm) return { ok: false, code: 'NOT_FOUND', error: 'Permanent not found.' };
  if (perm.isFaceDown !== true) return { ok: false, code: 'NOT_FACE_DOWN', error: 'That permanent is not face down.' };
  if (String(perm.controller || '') !== String(playerId)) return { ok: false, code: 'NOT_CONTROLLER', error: 'You can only turn face up permanents you control.' };
  const priority = state?.priority;
  if (priority && String(priority) !== String(playerId)) return { ok: false, code: 'NO_PRIORITY', error: 'You need priority to turn a permanent face up.' };
  const cost = getTurnFaceUpCostForPermanent(perm);
  if (!cost) return { ok: false, code: 'NO_TURN_UP_COST', error: 'This permanent has no turn-face-up cost.' };
  return { ok: true, permanent: perm, actualCard: perm.faceUpCard, cost };
}

export interface NonManaTurnFaceUpPayment {
  ok: boolean;
  error?: string;
  code?: string;
  needsReveal?: { colorWord: string; candidateCardIds: string[] };
  revealedCard?: any;
  lifePaid?: number;
}

/** Check / pay the non-mana part of a turn-face-up cost. Reveal does not move the card. */
export function payNonManaTurnFaceUpCost(state: any, playerId: string, cost: TurnFaceUpCost, revealCardId?: string): NonManaTurnFaceUpPayment {
  if (cost.revealColor) {
    const hand = state?.zones?.[playerId]?.hand || [];
    const candidates = revealCandidatesForTurnFaceUp(hand, cost);
    if (candidates.length === 0) return { ok: false, code: 'NO_REVEAL_CARD', error: `You have no ${cost.revealColorWord} card in hand to reveal.` };
    if (!revealCardId) {
      return { ok: false, code: 'NEEDS_REVEAL', needsReveal: { colorWord: String(cost.revealColorWord), candidateCardIds: candidates.map((c: any) => String(c.id)) } };
    }
    const chosen = candidates.find((c: any) => String(c.id) === String(revealCardId));
    if (!chosen) return { ok: false, code: 'BAD_REVEAL_CARD', error: `Reveal a ${cost.revealColorWord} card from your hand.` };
    return { ok: true, revealedCard: chosen };
  }
  if (typeof cost.lifeCost === 'number') {
    state.life = state.life || {};
    const current = Number(state.life[playerId] ?? state.startingLife ?? 40);
    if (current < cost.lifeCost) return { ok: false, code: 'CANNOT_PAY_LIFE', error: `You can't pay ${cost.lifeCost} life.` };
    state.life[playerId] = current - cost.lifeCost;
    const player = (state.players || []).find((p: any) => String(p?.id) === String(playerId));
    if (player && typeof player.life === 'number') player.life = state.life[playerId];
    state.lifeLostThisTurn = state.lifeLostThisTurn || {};
    state.lifeLostThisTurn[playerId] = (state.lifeLostThisTurn[playerId] || 0) + cost.lifeCost;
    return { ok: true, lifePaid: cost.lifeCost };
  }
  return { ok: true };
}