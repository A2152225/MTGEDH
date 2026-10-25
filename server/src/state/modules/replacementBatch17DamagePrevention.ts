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
  | { kind: 'player-prevent-add-counter'; sourcePermanentId: string; sourceName: string; controller: string; counter: string };

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
      if (p) out.push({ ...base, kind: 'player-prevent-add-counter', counter: p[1] });
    }
  }
  return out;
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