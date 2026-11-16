// server/src/state/modules/batch96GrantedKeywordHooks.ts
// B96: runtime lookup for B95 spell/hand keyword grants at existing
// emerge/evoke alternate-cost and on-cast stamp seams. Casualty,
// demonstrate, and conspire have no dedicated handlers yet — this stamps
// granted* fields so later payment/on-cast code can see them.
// Public: resolveGrantedKeywordAlternateCost, stampGrantedCastKeywords,
// readStampedGrantedKeyword.

import { getGrantedSpellOrHandKeyword } from './batch95SpellAndHandKeywordGrants.js';

export const GRANTED_CAST_ALTERNATE_KEYWORDS = ['emerge', 'evoke'] as const;
export const GRANTED_CAST_STAMP_KEYWORDS = ['emerge', 'evoke', 'casualty', 'demonstrate', 'conspire'] as const;

export type GrantedCastKeyword = (typeof GRANTED_CAST_STAMP_KEYWORDS)[number];

function cardHintFromMetadata(paymentMetadata: any, fallbackOracle?: string): any {
  const hinted = paymentMetadata?.card || paymentMetadata?.spell || paymentMetadata;
  if (hinted && typeof hinted === 'object') return hinted;
  return fallbackOracle ? { oracle_text: fallbackOracle } : null;
}

export function resolveGrantedKeywordAlternateCost(
  state: any,
  playerId: string,
  card: any,
  keyword: string,
  opts?: { fromZone?: string },
): string | undefined {
  const kw = String(keyword || '').trim().toLowerCase();
  if (kw !== 'emerge' && kw !== 'evoke') return undefined;
  const grant = getGrantedSpellOrHandKeyword(state, playerId, card, kw as 'emerge' | 'evoke', {
    zone: 'cast',
    fromZone: opts?.fromZone,
  });
  const cost = String(grant?.cost || '').trim();
  return cost || undefined;
}

export function stampGrantedCastKeywords(state: any, playerId: string, cards: any[], fromZone?: string): void {
  for (const card of cards || []) {
    if (!card || typeof card !== 'object') continue;
    for (const kw of GRANTED_CAST_STAMP_KEYWORDS) {
      const grant = getGrantedSpellOrHandKeyword(state, playerId, card, kw, { zone: 'cast', fromZone });
      if (kw === 'casualty') {
        if (grant) card.grantedCasualty = Number(grant.numericValue ?? 1) || 1;
        else delete card.grantedCasualty;
      } else if (kw === 'demonstrate') {
        if (grant) card.grantedDemonstrate = true;
        else delete card.grantedDemonstrate;
      } else if (kw === 'conspire') {
        if (grant) card.grantedConspire = true;
        else delete card.grantedConspire;
      } else if (kw === 'emerge' || kw === 'evoke') {
        const field = kw === 'emerge' ? 'grantedEmergeCost' : 'grantedEvokeCost';
        if (grant && grant.cost) card[field] = grant.cost;
        else delete card[field];
      }
    }
  }
}

export function readStampedGrantedKeyword(card: any, keyword: string): string | number | boolean | undefined {
  const kw = String(keyword || '').trim().toLowerCase();
  if (kw === 'emerge') return String(card?.grantedEmergeCost || '').trim() || undefined;
  if (kw === 'evoke') return String(card?.grantedEvokeCost || '').trim() || undefined;
  if (kw === 'casualty') {
    const n = Number(card?.grantedCasualty);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (kw === 'demonstrate') return card?.grantedDemonstrate === true ? true : undefined;
  if (kw === 'conspire') return card?.grantedConspire === true ? true : undefined;
  return undefined;
}

export function cardHintForAlternateCostListing(paymentMetadata: any, fallbackOracle?: string): any {
  return cardHintFromMetadata(paymentMetadata, fallbackOracle);
}
