/**
 * Round 41 intervening-if evaluators, consulted first in the chain. Each returns a boolean only when
 * the tracked state is decisive and undefined otherwise, so later modules keep their behaviour.
 * - "if it/this <obj> was|wasn't kicked|bargained|evoked|dashed|blitzed|surged|emerged|foretold|prowled"
 * - "if a player|an opponent|you cast N or more spells last turn" (total-count fallback)
 * - "if you cast a spell from anywhere other than your hand this turn"
 * - "if all opponents were dealt combat damage this turn" (turn-tagged combatDamagedPlayersThisTurn)
 * - "if a modified creature died under your control this turn" (turn-tagged modifiedCreaturesDiedThisTurn)
 * Origin parent: intervening-if.ts evaluateInterveningIfClauseInternal.
 */
import type { InterveningIfPhaseArgs } from './intervening-if-eval-support.js';

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const OPTIONS: Record<string, string> = {
  kicked: 'Kicked', bargained: 'Bargained', evoked: 'Evoked', dashed: 'Dashed', blitzed: 'Blitzed',
  surged: 'Surged', emerged: 'Emerged', foretold: 'Foretold', prowled: 'Prowled',
};
const ALT_ID: Record<string, string> = { evoked: 'evoke', dashed: 'dash', blitzed: 'blitz', surged: 'surge', emerged: 'emerge', foretold: 'foretell', prowled: 'prowl' };

function optionFlag(obj: any, option: string): boolean | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const key = 'was' + OPTIONS[option];
  if (option === 'kicked' && (Number(obj.kickerPaidCount || 0) > 0 || Number(obj.timesKicked || 0) > 0 || Number(obj.kickedTimes || 0) > 0)) return true;
  if (obj[key] === true) return true;
  const alt = String(obj.alternateCostId || '').toLowerCase();
  if (ALT_ID[option] && alt && alt === ALT_ID[option]) return true;
  // Bargain is positive-only unless the resolver recorded bargainResolved (existing contract).
  if (obj[key] === false && (option !== 'bargained' || obj.bargainResolved === true)) return false;
  // Only kicker is stamped on every cast (wasKicked=false when unkicked); other options need explicit flags.
  if (obj.castOptionsStamped === true && option === 'kicked') return false;
  return undefined;
}

/** Turn-tagged tracker: the map when it belongs to the current turn, {} when stale, undefined when absent. */
export function currentTurnMap(state: any, key: string, field: string): Record<string, number> | undefined {
  const tracker = state?.[key];
  if (!tracker || typeof tracker !== 'object') return undefined;
  if (typeof state?.turnNumber === 'number' && tracker.turn !== state.turnNumber) return {};
  return tracker[field] && typeof tracker[field] === 'object' ? tracker[field] : {};
}

/** Records into a turn-tagged tracker, resetting it when the turn changed. */
export function recordTurnScoped(state: any, key: string, field: string, id: string, amount: number): void {
  if (!state || !id) return;
  let tracker = state[key];
  if (!tracker || typeof tracker !== 'object' || tracker.turn !== state.turnNumber) {
    tracker = { turn: state.turnNumber, [field]: {} };
    state[key] = tracker;
  }
  tracker[field] = tracker[field] || {};
  tracker[field][id] = (Number(tracker[field][id]) || 0) + amount;
}

function playerIds(state: any): string[] {
  const players = Array.isArray(state?.players) ? state.players : [];
  return players
    .filter((p: any) => !(p && typeof p === 'object' && (p.hasLost === true || p.eliminated === true || p.conceded === true)))
    .map((p: any) => String(p?.id ?? p)).filter(Boolean);
}

export function tryEvaluateInterveningIfRound41Clauses(args: InterveningIfPhaseArgs): boolean | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args as any;
  const state: any = (ctx as any)?.state;
  const text = String(clause || '').trim();
  const me = String(controllerId || '');

  const opt = /^if (?:it|this (?:creature|spell|permanent|artifact|enchantment|card|land|vehicle)|~) (was|wasn't|was not) (kicked|bargained|evoked|dashed|blitzed|surged|emerged|foretold|prowled)$/.exec(text);
  if (opt) {
    const negate = opt[1] !== 'was';
    const objs = refs?.stackItem ? [refs.stackItem, refs.stackItem.card] : [sourcePermanent, sourcePermanent?.card, refs];
    let found: boolean | undefined;
    for (const o of objs) {
      const f = optionFlag(o, opt[2]);
      if (f === true) { found = true; break; }
      if (f === false && found === undefined) found = false;
    }
    if (found === undefined) return undefined;
    return negate ? !found : found;
  }

  const last = /^if (a player|an opponent|you|any player) cast (one|two|three|four|five|\d+) or more spells last turn$/.exec(text);
  if (last && state) {
    const n = NUM[last[2]] ?? Number(last[2]);
    if (!Number.isFinite(n) || n < 1) return undefined;
    const map = state.spellsCastLastTurnByPlayerCounts;
    const total = Number(state.spellsCastLastTurnCount);
    if (map && typeof map === 'object') {
      const ids = last[1] === 'you' ? [me] : last[1] === 'an opponent' ? playerIds(state).filter((id) => id !== me) : Object.keys(map).concat(playerIds(state));
      return ids.some((id) => (Number(map[id]) || 0) >= n);
    }
    if (Number.isFinite(total) && total < n) return false;
    return undefined;
  }

  if (/^if you(?:'ve)? cast a spell from anywhere other than (?:your|a) hand this turn$/.test(text) && state) {
    const list = Array.isArray(state.spellsCastThisTurn) ? state.spellsCastThisTurn : undefined;
    if (!list) return undefined;
    const mine = list.filter((e: any) => String(e?.casterId || '') === me);
    if (mine.some((e: any) => typeof e?.castSourceZone === 'string' && e.castSourceZone && e.castSourceZone !== 'hand')) return true;
    if (mine.length === 0) return false;
    const fromHand = state.spellsCastFromHandThisTurn?.[me];
    if (typeof fromHand === 'number') return mine.length > fromHand;
    if (mine.every((e: any) => e?.castSourceZone === 'hand')) return false;
    return undefined;
  }

  if (/^if (?:all|each of) (?:your )?opponents (?:were|was) dealt combat damage this turn$/.test(text) && state) {
    const map = currentTurnMap(state, 'combatDamagedPlayersThisTurn', 'players');
    if (!map) return undefined;
    const opps = playerIds(state).filter((id) => id !== me);
    if (!opps.length) return false;
    return opps.every((id) => (Number(map[id]) || 0) > 0);
  }

  if (/^if a modified creature (?:died under your control|you controlled died) this turn$/.test(text) && state) {
    const map = currentTurnMap(state, 'modifiedCreaturesDiedThisTurn', 'byController');
    if (!map) return undefined;
    return (Number(map[me]) || 0) > 0;
  }

  return undefined;
}
