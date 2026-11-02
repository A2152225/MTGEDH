// server/src/state/modules/graveyardKeywordNonManaCost.ts
// B41: graveyard keyword abilities whose cost has non-mana parts: "Eternalize\u2014{3}{U}{U}, Discard a card."
// (Sinuous Striker, Sunscourge Champion), "Unearth\u2014Pay eight {E}." (Salvation Colossus), and the same shapes
// for embalm. Mana keeps the existing pool payment; energy and life are paid immediately; a discard reuses
// the shared DISCARD_SELECTION step (mandatory, reason 'effect') like the echo/equip discard costs.
// Public entry symbols: parseGraveyardKeywordCost, graveyardKeywordCostError,
// payGraveyardKeywordImmediateCosts, queueGraveyardKeywordDiscardCost, GraveyardKeywordCost.

import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { equipDiscardCandidates, parseEnergyCost, payEnergyCost, payEquipLifeCost } from './equipNonManaCosts.js';

export interface GraveyardKeywordCost { text: string; manaCost?: string; discard?: number; energy?: number; life?: number }

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function num(s: string): number { const t = String(s || '').toLowerCase(); return /^\d+$/.test(t) ? Number(t) : (NUM[t] ?? 0); }

/** Parsed cost for the keyword's line, or null when it is mana-only / absent / has an unknown part. */
export function parseGraveyardKeywordCost(card: any, keyword: string): GraveyardKeywordCost | null {
  const text = String(card?.oracle_text || card?.oracleText || '');
  const kw = String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!kw) return null;
  const re = new RegExp(`^\\s*${kw}\\s*(?:\\u2014|\\u2013|-)?\\s*([^(\\n]+)`, 'i');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const body = m[1].trim().replace(/[.]+$/, '');
    const out: GraveyardKeywordCost = { text: body };
    let nonMana = false;
    for (const raw of body.split(/,\s*/)) {
      const p = raw.trim();
      if (!p) continue;
      if (/^(\{[^}]+\})+$/.test(p) && !/\{E\}/i.test(p)) { out.manaCost = p; continue; }
      const e = parseEnergyCost(p);
      if (e !== null) { out.energy = e; nonMana = true; continue; }
      const d = p.match(/^discard\s+(a|an|one|two|three|\d+)\s+cards?$/i);
      if (d) { out.discard = num(d[1]); nonMana = true; continue; }
      const l = p.match(/^pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life$/i);
      if (l) { out.life = num(l[1]); nonMana = true; continue; }
      return null;
    }
    return nonMana ? out : null;
  }
  return null;
}

export function graveyardKeywordCostError(state: any, playerId: string, cost: GraveyardKeywordCost | null): string | null {
  if (!cost) return null;
  if (cost.energy && Number(state?.energy?.[playerId] || 0) < cost.energy) return `you need ${cost.energy} energy (you have ${Number(state?.energy?.[playerId] || 0)})`;
  if (cost.discard && equipDiscardCandidates(state, playerId, 'Discard a card').length < cost.discard) return `you need ${cost.discard} card(s) in hand to discard`;
  if (cost.life && Number(state?.life?.[playerId] ?? 0) < cost.life) return `you don't have ${cost.life} life to pay`;
  return null;
}

/** Pays the energy and life parts. Call only after graveyardKeywordCostError returned null. */
export function payGraveyardKeywordImmediateCosts(state: any, playerId: string, cost: GraveyardKeywordCost | null): void {
  if (!cost) return;
  if (cost.energy) payEnergyCost(state, playerId, `Pay ${cost.energy} {E}`);
  if (cost.life) payEquipLifeCost(state, playerId, `Pay ${cost.life} life`);
}

/** Queues the mandatory discard for the cost's discard part (no-op without one). */
export function queueGraveyardKeywordDiscardCost(gameId: string, state: any, playerId: string, sourceId: string, sourceName: string, keyword: string, cost: GraveyardKeywordCost | null): boolean {
  const count = Number(cost?.discard || 0);
  if (count <= 0) return false;
  const hand = equipDiscardCandidates(state, playerId, 'Discard a card');
  if (hand.length === 0) return false;
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DISCARD_SELECTION,
    playerId: playerId as any,
    sourceId,
    sourceName,
    description: `${sourceName}: Discard ${count === 1 ? 'a card' : `${count} cards`} (${keyword} cost)`,
    mandatory: true,
    hand: hand.map((c: any) => ({ id: c.id, label: c.name || 'Card', imageUrl: c.image_uris?.small || c.image_uris?.normal })),
    discardCount: Math.min(count, hand.length),
    currentHandSize: hand.length,
    maxHandSize: Math.max(7, hand.length),
    reason: 'effect',
    graveyardKeywordDiscardCost: keyword,
  } as any);
  return true;
}
