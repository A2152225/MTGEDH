// Offspring {N}: an optional additional cost while casting a creature spell,
// printed on the spell or granted by "creature spells you cast gain offspring {N}".
// Paying it stamps the spell; when that creature enters, this creates a 1/1 token copy.
// Origin: gameActionsRequestCastSpellModes.ts (the replicate additional-cost prompt).
// Public: offspringCostForSpell, stampOffspringPaid, maybeCreateOffspringToken.

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { createToken } from './counters_tokens-handlers/countersTokensCreateToken.js';

const PRINTED_RE = /(?:^|[.\n])\s*offspring\s*(\{[^}]+\})/i;
const GRANTED_RE = /creature spells you cast gain offspring\s*(\{[^}]+\})/i;

function manaCostOf(match: RegExpMatchArray | null): string | null {
  const cost = String(match?.[1] || '').replace(/\s+/g, '').toUpperCase();
  return /^\{[^}]+\}$/.test(cost) ? cost : null;
}

export function offspringCostForSpell(state: any, playerId: string, card: any, typeLine: string): string | null {
  if (!String(typeLine || card?.type_line || '').toLowerCase().includes('creature')) return null;
  const printed = manaCostOf(String(card?.oracle_text || '').match(PRINTED_RE));
  if (printed) return printed;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    if (String(permanent.controller || '') !== String(playerId || '')) continue;
    const granted = manaCostOf(String(permanent.card?.oracle_text || permanent.oracle_text || '').match(GRANTED_RE));
    if (granted) return granted;
  }
  return null;
}

export function stampOffspringPaid(state: any, card: any, cardId: string): void {
  if (card && typeof card === 'object') card.offspringPaid = true;
  if (!state || typeof state !== 'object') return;
  state.offspringPaidByCardId = state.offspringPaidByCardId || {};
  const id = String(cardId || card?.id || '').trim();
  if (id) state.offspringPaidByCardId[id] = true;
}

function offspringWasPaid(state: any, permanent: any): boolean {
  if (permanent?.offspringToken === true || permanent?.offspringTokenCreated === true) return false;
  if (permanent?.offspringPaid === true || permanent?.card?.offspringPaid === true) return true;
  const id = String(permanent?.card?.id || permanent?.id || '').trim();
  return Boolean(id && state?.offspringPaidByCardId?.[id] === true);
}

export function maybeCreateOffspringToken(ctx: GameContext, permanent: any, controller: string): string[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any)?.state;
  if (!offspringWasPaid(state, permanent)) return [];
  permanent.offspringTokenCreated = true;
  permanent.offspringPaid = false;
  if (permanent.card && typeof permanent.card === 'object') permanent.card.offspringPaid = false;
  const cardId = String(permanent?.card?.id || '').trim();
  if (cardId && state?.offspringPaidByCardId) delete state.offspringPaidByCardId[cardId];
  const card = permanent.card || permanent;
  const ids = createToken(
    ctx,
    String(controller || permanent.controller || '') as PlayerID,
    String(card.name || 'Creature'),
    1,
    1,
    1,
    {
      typeLine: String(card.type_line || 'Token Creature'),
      copyOfPermanentId: String(permanent.id || ''),
      colors: Array.isArray(card.colors) ? card.colors : undefined,
      skipTokenReplacements: true,
    } as any,
    true,
  );
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const id of ids) {
    const token = battlefield.find((entry: any) => String(entry?.id || '') === String(id));
    if (!token) continue;
    token.offspringToken = true;
    token.offspringPaid = false;
    token.basePower = 1;
    token.baseToughness = 1;
    token.power = 1;
    token.toughness = 1;
    if (token.card && typeof token.card === 'object') {
      token.card.power = '1';
      token.card.toughness = '1';
      token.card.offspringPaid = false;
    }
  }
  return ids;
}
