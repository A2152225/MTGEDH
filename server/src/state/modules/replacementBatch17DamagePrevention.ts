// Batch 17: mixed-sentence damage prevention replacements that do something besides preventing.
//  - "If damage would be dealt to ~[ while it has a +1/+1 counter on it], prevent that damage, remove
//    (a|that many) +1/+1 counter(s) from ~[, and create that many 1/1 colorless Spirit creature tokens |,
//    then give each player a rad counter for each +1/+1 counter removed this way]" (Sekki, Bloatfly Swarm)
//  - "If damage would be dealt to ~, prevent that damage and put that many +1/+1 counters on (it|him|her)"
//    (Anti-Venom, Horrifying Healer)
//  - "If a source would deal damage to you, prevent that damage and put an incarnation counter on ~" (Nine Lives)
// Called from applyDamageSideEffectReplacements before the older side-effect templates.
// Public entry symbols: collectBatch17DamagePreventionRules, applyBatch17DamagePrevention.

import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpec-handlers/replacementEffectSpecDamagePreventionOracleTemplates.js';
import { createToken } from './counters_tokens-handlers/countersTokensCreateToken.js';

export type Batch17PreventionRule =
  | { kind: 'prevent-remove'; sourcePermanentId: string; sourceName: string; controller: string;
      removeMode: 'one' | 'amount'; requiresCounter: boolean; followUp: 'none' | 'spirit-tokens' | 'rad-each-player' }
  | { kind: 'prevent-add-counters'; sourcePermanentId: string; sourceName: string; controller: string; counter: string }
  | { kind: 'player-prevent-add-counter'; sourcePermanentId: string; sourceName: string; controller: string; counter: string }
  // B57: Angel of Suffering — prevent damage to you and mill twice that many.
  | { kind: 'player-prevent-mill'; sourcePermanentId: string; sourceName: string; controller: string; millMultiplier: number }
  // B58: Immortal Coil — prevent damage to you and exile that many cards from your graveyard.
  | { kind: 'player-prevent-exile-gy'; sourcePermanentId: string; sourceName: string; controller: string };

const SELF = '(?:~|this enchantment|this artifact)';
const PREVENT_COMMA_REMOVE = new RegExp(
  `^if damage would be dealt to ${SELF}( while it has a \\+1/\\+1 counter on it)?, prevent that damage, remove (an?|that many) \\+1/\\+1 counters? from (?:it|${SELF})` +
  `(?:(, and create that many 1/1 colorless spirit creature tokens)|(, then give each player a rad counter for each \\+1/\\+1 counter removed this way))?$`,
);
const PREVENT_ADD_COUNTERS = new RegExp(
  `^if damage would be dealt to ${SELF}, prevent that damage and put that many ([+-]1/[+-]1) counters on (?:it|him|her|them|${SELF})$`,
);
const PLAYER_PREVENT_ADD_COUNTER = new RegExp(
  `^if a source would deal damage to you, prevent that damage and put an? ([a-z]+) counter on ${SELF}$`,
);
// B57: Angel of Suffering
const PLAYER_PREVENT_MILL = /^if damage would be dealt to you, prevent that damage and mill (twice that many|that many) cards?$/;
// B58: Immortal Coil (two sentences collapsed via selfReferenceSentences / adjacent).
const PLAYER_PREVENT_EXILE_GY = /^if damage would be dealt to you, prevent that damage(?:\.|$)(?:\s*exile (?:a|one) cards? from your graveyard for each 1 damage prevented this way)?$/;
const PLAYER_PREVENT_EXILE_GY_FOLLOW = /^exile (?:a|one) cards? from your graveyard for each 1 damage prevented this way$/;

export function collectBatch17DamagePreventionRules(state: any): Batch17PreventionRule[] {
  const out: Batch17PreventionRule[] = [];
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of bf) {
    if (!perm?.card || perm.phasedOut === true) continue;
    const id = String(perm.id || '').trim();
    const oracle = readCardOracleText(perm.card);
    if (!id || !oracle || !/would (?:be dealt|deal damage)/i.test(oracle)) continue;
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    const base = { sourcePermanentId: id, sourceName, controller: String(perm.controller || '').trim() };
    for (const s of selfReferenceSentences(oracle, sourceName)) {
      const r = s.match(PREVENT_COMMA_REMOVE);
      if (r) {
        out.push({ ...base, kind: 'prevent-remove', removeMode: r[2] === 'that many' ? 'amount' : 'one', requiresCounter: !!r[1],
          followUp: r[3] ? 'spirit-tokens' : r[4] ? 'rad-each-player' : 'none' });
        continue;
      }
      const a = s.match(PREVENT_ADD_COUNTERS);
      if (a) { out.push({ ...base, kind: 'prevent-add-counters', counter: a[1] }); continue; }
      const p = s.match(PLAYER_PREVENT_ADD_COUNTER);
      if (p) { out.push({ ...base, kind: 'player-prevent-add-counter', counter: p[1] }); continue; }
      const mill = s.match(PLAYER_PREVENT_MILL);
      if (mill) { out.push({ ...base, kind: 'player-prevent-mill', millMultiplier: /twice/i.test(mill[1]) ? 2 : 1 }); continue; }
      // Immortal Coil: require both prevent-to-you and exile-from-GY follow-up somewhere on the card.
      if (/if damage would be dealt to you, prevent that damage/i.test(oracle)
        && /exile (?:a|one) cards? from your graveyard for each 1 damage prevented this way/i.test(oracle)
        && (PLAYER_PREVENT_EXILE_GY.test(s) || PLAYER_PREVENT_EXILE_GY_FOLLOW.test(s))) {
        if (!out.some((r) => r.kind === 'player-prevent-exile-gy' && r.sourcePermanentId === id))
          out.push({ ...base, kind: 'player-prevent-exile-gy' });
      }
    }
  }
  return out;
}

/** Local mill helper (avoid importing gameStateEffectsMillDamage — circular with this module). */
function millLibraryTop(state: any, ctx: any, playerId: string, count: number): number {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0 || !playerId) return 0;
  const zones = (state.zones = state.zones || {});
  const z = (zones[playerId] = zones[playerId] || { hand: [], graveyard: [], library: [], libraryCount: 0, graveyardCount: 0 });
  let lib: any[] =
    (ctx?.libraries && typeof ctx.libraries.get === 'function' && ctx.libraries.get(playerId))
    || (Array.isArray(z.library) ? z.library : []);
  if (!Array.isArray(lib)) lib = [];
  const milled: any[] = [];
  for (let i = 0; i < n && lib.length > 0; i += 1) {
    const card = lib.pop();
    if (card) milled.push(card);
  }
  if (ctx?.libraries && typeof ctx.libraries.set === 'function') ctx.libraries.set(playerId, lib);
  z.library = lib;
  z.libraryCount = lib.length;
  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
  for (const card of milled) z.graveyard.push(card);
  z.graveyardCount = z.graveyard.length;
  return milled.length;
}

function addRad(state: any, playerId: string, n: number): void {
  const player = (state.players || []).find((p: any) => String(p?.id) === playerId);
  const cur = Number(player?.counters?.rad ?? player?.radCounters ?? state.radCounters?.[playerId] ?? 0) || 0;
  const next = cur + n;
  if (player) { player.counters = player.counters || {}; player.counters.rad = next; player.radCounters = next; }
  state.radCounters = state.radCounters || {};
  state.radCounters[playerId] = next;
}

/** Returns a replaced damage result (amount 0) or null when no Batch 17 rule applies. */
export function applyBatch17DamagePrevention(
  ctx: any, damageAmount: number, damageReceiver: string, targetPermanentId?: string,
): { amount: number; modifiers: string[] } | null {
  const state = ctx?.state || ctx;
  if (!(Number(damageAmount) > 0) || !state) return null;
  const rules = collectBatch17DamagePreventionRules(state);
  if (!rules.length) return null;
  const bf: any[] = state.battlefield || [];
  const targetId = String(targetPermanentId || '').trim();
  for (const rule of rules) {
    const src = bf.find((p: any) => String(p?.id) === rule.sourcePermanentId);
    if (!src) continue;
    src.counters = src.counters || {};
    if (rule.kind === 'player-prevent-add-counter') {
      if (targetId || String(damageReceiver || '') !== rule.controller) continue;
      src.counters[rule.counter] = (Number(src.counters[rule.counter]) || 0) + 1;
      return { amount: 0, modifiers: [`${rule.sourceName}: prevented ${damageAmount} damage, added ${/^[aeiou]/i.test(rule.counter) ? 'an' : 'a'} ${rule.counter} counter`] };
    }
    if (rule.kind === 'player-prevent-mill') {
      if (targetId || String(damageReceiver || '') !== rule.controller) continue;
      const millCount = Math.max(0, Math.floor(Number(damageAmount) || 0) * Math.max(1, Number(rule.millMultiplier) || 1));
      const milled = millLibraryTop(state, ctx, rule.controller, millCount);
      return { amount: 0, modifiers: [`${rule.sourceName}: prevented ${damageAmount} damage, milled ${milled}`] };
    }
    if (rule.kind === 'player-prevent-exile-gy') {
      if (targetId || String(damageReceiver || '') !== rule.controller) continue;
      const need = Math.max(0, Math.floor(Number(damageAmount) || 0));
      const zones = (state.zones = state.zones || {});
      const z = (zones[rule.controller] = zones[rule.controller] || { graveyard: [], exile: [] });
      z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
      z.exile = Array.isArray(z.exile) ? z.exile : [];
      let exiled = 0;
      for (let i = 0; i < need && z.graveyard.length > 0; i += 1) {
        const card = z.graveyard.pop();
        if (card) { z.exile.push(card); exiled += 1; }
      }
      z.graveyardCount = z.graveyard.length;
      return { amount: 0, modifiers: [`${rule.sourceName}: prevented ${damageAmount} damage, exiled ${exiled} from graveyard`] };
    }
    if (targetId !== rule.sourcePermanentId) continue;
    if (rule.kind === 'prevent-add-counters') {
      src.counters[rule.counter] = (Number(src.counters[rule.counter]) || 0) + damageAmount;
      return { amount: 0, modifiers: [`${rule.sourceName}: prevented ${damageAmount} damage, put ${damageAmount} ${rule.counter} counter(s)`] };
    }
    const have = Math.max(0, Number(src.counters['+1/+1']) || 0);
    if (rule.requiresCounter && have <= 0) continue;
    const removed = Math.min(have, rule.removeMode === 'amount' ? damageAmount : 1);
    if (removed > 0) src.counters['+1/+1'] = have - removed;
    const mods = [`${rule.sourceName}: prevented ${damageAmount} damage and removed ${removed} +1/+1 counter(s)`];
    if (rule.followUp === 'spirit-tokens' && removed > 0 && ctx?.state) {
      try { createToken(ctx, rule.controller as any, 'Spirit', removed, 1, 1); mods.push(`created ${removed} Spirit token(s)`); } catch { /* token pipeline unavailable */ }
    } else if (rule.followUp === 'rad-each-player' && removed > 0) {
      for (const p of state.players || []) addRad(state, String(p.id), removed);
      mods.push(`each player got ${removed} rad counter(s)`);
    }
    return { amount: 0, modifiers: mods };
  }
  return null;
}