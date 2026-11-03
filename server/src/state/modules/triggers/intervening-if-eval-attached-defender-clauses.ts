/**
 * Intervening-if evaluators for defending-player and enchanted/equipped subjects.
 * Returns true/false when decidable, null when recognised but the board lacks the data,
 * undefined when the clause shape is not handled here.
 */
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from './intervening-if-eval-support.js';

const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const CARD_TYPES = new Set(['permanent', 'creature', 'land', 'artifact', 'enchantment', 'planeswalker', 'battle']);
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const singular = (w: string) => w.replace(/(?:es)$/i, (m) => (/(?:ches|shes|sses|xes)$/i.test(w) ? '' : m)).replace(/s$/i, '').toLowerCase();
const bf = (ctx: any): any[] => (Array.isArray(ctx?.state?.battlefield) ? ctx.state.battlefield : []);
const tl = (p: any) => String(p?.card?.type_line || p?.type_line || '').toLowerCase();
const colorsOf = (p: any): string[] => {
  const c = p?.card?.colors ?? p?.colors;
  return Array.isArray(c) ? c.map((x: any) => String(x).toUpperCase()) : [];
};
const hasWord = (line: string, w: string) => new RegExp('\\b' + w.replace(/[^a-z0-9-]/gi, '') + 's?\\b', 'i').test(line);

/** Matches "no <color>* <nontoken>? <type|subtype> (permanents|creatures)?" against one permanent. */
function permMatchesDescriptor(p: any, words: string[]): boolean | null {
  const line = tl(p);
  for (const raw of words) {
    const w = singular(raw);
    if (COLORS[w]) { const cs = colorsOf(p); if (!cs.length && !p?.card) return null; if (!cs.includes(COLORS[w])) return false; continue; }
    if (w === 'nontoken') { if (p?.isToken === true || /\btoken\b/.test(line)) return false; continue; }
    if (w === 'permanent') continue;
    if (!line) return null;
    if (!hasWord(line, w)) return false;
  }
  return true;
}

export function resolveDefendingPlayerId(args: InterveningIfPhaseArgs): string | undefined {
  const { ctx, sourcePermanent, refs } = args as any;
  const players: string[] = (Array.isArray(ctx?.state?.players) ? ctx.state.players : []).map((p: any) => String(p?.id ?? p));
  const cands = [refs?.defendingPlayerId, sourcePermanent?.defendingPlayerId, sourcePermanent?.attacking, sourcePermanent?.attackingPlayerId];
  for (const c of cands) if (typeof c === 'string' && c && (!players.length || players.includes(c))) return c;
  // An attacked planeswalker/battle: its controller (planeswalker) is the defending player.
  const tgt = sourcePermanent?.attackingTargetId ?? sourcePermanent?.attacking;
  if (typeof tgt === 'string') { const p = bf(ctx).find((x: any) => String(x?.id) === tgt); if (p?.controller) return String(p.controller); }
  return undefined;
}

function handSize(ctx: any, pid: string): number | null {
  const z = ctx?.state?.zones?.[pid];
  if (Array.isArray(z?.hand)) return z.hand.length;
  if (typeof z?.handCount === 'number') return z.handCount;
  return null;
}

export function tryEvaluateInterveningIfAttachedDefenderClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent } = args as any;

  if (/^if\s+defending\s+player\b/i.test(clause)) {
    const dp = resolveDefendingPlayerId(args);
    let m = clause.match(/^if\s+defending\s+player\s+controls\s+no\s+([a-z\s-]+)$/i);
    if (m) {
      if (!dp) return null;
      const words = m[1].trim().split(/\s+/).filter((w: string) => !/^(?:and|or)$/i.test(w));
      let unknown = false;
      for (const p of bf(ctx)) {
        if (String(p?.controller) !== dp) continue;
        const v = permMatchesDescriptor(p, words);
        if (v === true) return false;
        if (v === null) unknown = true;
      }
      return unknown ? null : true;
    }
    m = clause.match(/^if\s+defending\s+player\s+controls\s+(more|fewer)\s+(lands|creatures|artifacts|enchantments|permanents)\s+than\s+you$/i);
    if (m) {
      if (!dp) return null;
      const w = singular(m[2]);
      const count = (pid: string) => bf(ctx).filter((p: any) => String(p?.controller) === pid && (w === 'permanent' || hasWord(tl(p), w))).length;
      const a = count(dp), b = count(String(controllerId));
      return m[1].toLowerCase() === 'more' ? a > b : a < b;
    }
    m = clause.match(/^if\s+defending\s+player\s+has\s+(more|fewer)\s+cards\s+in\s+hand\s+than\s+you$/i);
    if (m) {
      if (!dp) return null;
      const a = handSize(ctx, dp), b = handSize(ctx, String(controllerId));
      if (a === null || b === null) return null;
      return m[1].toLowerCase() === 'more' ? a > b : a < b;
    }
    return undefined;
  }

  const am = clause.match(/^if\s+(enchanted|equipped)\s+(creature|permanent|land|artifact|planeswalker)(?:'s\s+power\s+is\s+(\d+|[a-z]+)\s+or\s+(greater|less)|\s+is\s+(.+))$/i);
  if (am) {
    const hostId = sourcePermanent?.attachedTo ?? sourcePermanent?.enchanting ?? sourcePermanent?.equippedTo;
    if (!hostId) return null;
    const host = bf(ctx).find((p: any) => String(p?.id) === String(hostId));
    if (!host) return null;
    if (am[3]) {
      const n = /^\d+$/.test(am[3]) ? Number(am[3]) : NUM[am[3].toLowerCase()];
      const pw = Number(host?.effectivePower ?? host?.power ?? host?.card?.power);
      if (n === undefined || !Number.isFinite(pw)) return null;
      return am[4].toLowerCase() === 'greater' ? pw >= n : pw <= n;
    }
    const pred = String(am[5] || '').trim().toLowerCase();
    if (pred === 'tapped' || pred === 'untapped') return typeof host.tapped === 'boolean' ? (host.tapped === (pred === 'tapped')) : (pred === 'untapped' ? !host.tapped : !!host.tapped);
    if (pred === 'attacking') return !!(host.attacking || host.isAttacking);
    if (COLORS[pred]) { const cs = colorsOf(host); return host?.card ? cs.includes(COLORS[pred]) : null; }
    const sm = pred.match(/^an?\s+([a-z-]+)(?:\s+or\s+(?:an?\s+)?([a-z-]+))?$/i);
    if (sm) {
      const line = tl(host);
      if (!line) return null;
      return [sm[1], sm[2]].filter(Boolean).some((w) => hasWord(line, singular(String(w))) || CARD_TYPES.has(singular(String(w))) && hasWord(line, singular(String(w))));
    }
    return undefined;
  }
  return undefined;
}
