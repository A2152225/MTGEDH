/**
 * Magnetic Mountain style paid untap: "At the beginning of each player's upkeep, that player may choose any
 * number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player
 * does, untap those creatures."
 * Pure helpers (no trigger wiring): list offers for an upkeep player, and apply a paid choice.
 * Payment itself is done by the caller (prompt + mana payment), which passes the number of creatures paid for.
 */
const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const RE = /that player may choose any number of tapped (?:(white|blue|black|red|green) )?creatures they control and pay \{(\d+)\} for each creature chosen this way\. if the player does, untap those creatures/i;

export interface PaidUntapOffer { sourceId: string; sourceName: string; costPerCreature: number; eligibleIds: string[] }

export function parsePaidUntapClause(oracle: string): { color?: string; cost: number } | null {
  const m = String(oracle || '').match(RE);
  return m ? { color: m[1] ? COLORS[m[1].toLowerCase()] : undefined, cost: Number(m[2]) } : null;
}

function hasColor(perm: any, c: string): boolean {
  const cols = perm?.colors || perm?.card?.colors || [];
  return Array.isArray(cols) && cols.map((x: any) => String(x).toUpperCase()).includes(c);
}

export function getPaidUntapOffers(state: any, playerId: string): PaidUntapOffer[] {
  const out: PaidUntapOffer[] = [];
  const bf: any[] = state?.battlefield || [];
  for (const src of bf) {
    const spec = parsePaidUntapClause(src?.card?.oracle_text);
    if (!spec) continue;
    const eligibleIds = bf.filter((p) => String(p?.controller) === playerId && p?.tapped
      && /\bcreature\b/i.test(String(p?.card?.type_line || p?.type_line || ''))
      && (!spec.color || hasColor(p, spec.color))).map((p) => String(p.id));
    if (eligibleIds.length) out.push({ sourceId: String(src.id), sourceName: String(src.card?.name || ''), costPerCreature: spec.cost, eligibleIds });
  }
  return out;
}

/** Untap the chosen creatures that are still eligible. Returns the ids untapped and the total generic cost owed. */
export function applyPaidUntapChoice(state: any, playerId: string, sourceId: string, chosenIds: string[]): { untapped: string[]; cost: number } {
  const offer = getPaidUntapOffers(state, playerId).find((o) => o.sourceId === sourceId);
  if (!offer) return { untapped: [], cost: 0 };
  const ok = new Set(offer.eligibleIds);
  const untapped: string[] = [];
  for (const id of new Set((chosenIds || []).map(String))) {
    if (!ok.has(id)) continue;
    const perm = (state.battlefield as any[]).find((p) => String(p?.id) === id);
    if (perm) { perm.tapped = false; untapped.push(id); }
  }
  return { untapped, cost: untapped.length * offer.costPerCreature };
}
