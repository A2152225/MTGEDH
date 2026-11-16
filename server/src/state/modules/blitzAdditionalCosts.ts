// server/src/state/modules/blitzAdditionalCosts.ts
// Extra costs attached to a blitz alternate cost (Tenacious Underdog
// "Blitz — {1}{B}, Pay 2 life.", Sabin "Blitz — {cost}, Discard a card.").
// Public: parseBlitzAdditionalCosts, type BlitzAdditionalCost.

export type BlitzPayLifeAdditionalCost = {
  type: 'pay_life';
  amount: number;
  mandatory: true;
  label: string;
};

export type BlitzDiscardAdditionalCost = {
  type: 'discard';
  count: number;
  mandatory: true;
  label: string;
};

export type BlitzAdditionalCost = BlitzPayLifeAdditionalCost | BlitzDiscardAdditionalCost;

/**
 * Parse non-mana extras that follow a Blitz cost, e.g.
 *   "Blitz — {1}{B}, Pay 2 life."
 *   "Blitz—{2}{R}, Discard a card."
 * Mana symbols themselves are left to parseKeywordAlternateManaCost.
 */
export function parseBlitzAdditionalCosts(oracleText: string): BlitzAdditionalCost[] {
  const text = String(oracleText || '');
  if (!text) return [];
  const clauseMatch = text.match(
    /\bblitz\s*[—–-]\s*(\{[^}]+\})+(?:\s*,\s*([^.]+))?/i,
  );
  // Also allow "Blitz {1}{B}, Pay 2 life" (no dash) and a trailing "Blitz — {1}{B}. Pay 2 life." is
  // not additional to the keyword cost; only comma-joined extras on the same blitz cost.
  const looseMatch = clauseMatch || text.match(
    /\bblitz\s*(\{[^}]+\})+(?:\s*,\s*([^.]+))?/i,
  );
  if (!looseMatch) return [];
  const extra = String(looseMatch[2] || looseMatch[looseMatch.length - 1] || '').trim();
  if (!extra || /^\{/.test(extra)) return [];

  const out: BlitzAdditionalCost[] = [];
  const payLife = extra.match(/pay\s+(\d+)\s+life/i);
  if (payLife) {
    const amount = Math.max(1, Math.floor(Number(payLife[1])));
    out.push({
      type: 'pay_life',
      amount,
      mandatory: true,
      label: `Pay ${amount} life`,
    });
  }
  const discard = extra.match(/discard\s+(a|one|\d+)\s+card/i);
  if (discard) {
    const raw = String(discard[1] || '1').toLowerCase();
    const count = raw === 'a' || raw === 'one' ? 1 : Math.max(1, Math.floor(Number(raw) || 1));
    out.push({
      type: 'discard',
      count,
      mandatory: true,
      label: count === 1 ? 'Discard a card' : `Discard ${count} cards`,
    });
  }
  return out;
}

export function cardHasGraveyardBlitz(oracleText: string): boolean {
  return /you may cast [^.]+ from your graveyard using its blitz ability/i.test(String(oracleText || ''));
}

export function cardHasGraveyardBestow(oracleText: string): boolean {
  return /you may cast [^.]+ from your graveyard using its bestow ability/i.test(String(oracleText || ''));
}

/**
 * When a card is cast from the graveyard using bestow, it may also require
 * collect evidence N ("If you do, it also requires collect evidence 6.").
 */
export function parseGraveyardBestowCollectEvidence(oracleText: string): { required: number; mandatory: true } | null {
  const text = String(oracleText || '');
  if (!cardHasGraveyardBestow(text)) return null;
  const match = text.match(/it also requires collect evidence\s+(\d+)/i)
    || text.match(/collect evidence\s+(\d+)/i);
  if (!match) return null;
  const required = Math.max(1, Math.floor(Number(match[1])));
  return { required, mandatory: true };
}
