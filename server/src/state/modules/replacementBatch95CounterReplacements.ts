// server/src/state/modules/replacementBatch95CounterReplacements.ts
// B95: Doc Samson / Pir (that many plus N of each kind), Vizier of Remedies
// (-1/-1 minus N), Melira, the Living Cure (first poison this turn is 1, then
// no more). Public: parseBatch95CounterSentence, collectBatch95CounterReplacementSpecs,
// collectBatch95CounterReplacementSpecsFromState, applyMeliraPoisonReplacement.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const YOU_PUT_PLUS_RE = /if you would put (?:one or more|n or more|\d+ or more) counters on a (?:permanent you control|creature or planeswalker you control(?: or on yourself)?), put that many plus (one|two|three|four|five|\d+|n) of each of those kinds of counters on that (?:permanent|permanent or player) instead/i;
const TEAM_PLUS_RE = /if (?:one or more|n or more|\d+ or more) counters would be put on a permanent (?:you|your team) controls?, that many plus (one|two|three|four|five|\d+|n) of each of those kinds of counters (?:are|is) put on that permanent instead/i;
const MINUS_M1M1_RE = /if (?:one or more|n or more|\d+ or more) (?:[-+]1\/[-+]1|\u00b1n\/\u00b1n) counters would be put on a creature you control, that many (?:[-+]1\/[-+]1|\u00b1n\/\u00b1n) counters minus (one|two|three|four|five|\d+|n) are put on it instead/i;
const MELIRA_POISON_RE = /if you would get (?:one or more|n or more|\d+ or more) poison counters, instead you get (one|a|1|n) poison counters? and you can't get additional poison counters this turn/i;

function num(raw: string | undefined, fallback = 1): number {
  const s = String(raw || '').toLowerCase();
  return WORD[s] ?? (parseInt(s, 10) || fallback);
}

export type Batch95CounterParse =
  | { kind: 'any-counters-plus'; plus: number; actorIsYou?: boolean; team?: boolean }
  | { kind: 'm1m1-minus'; minus: number }
  | { kind: 'poison-first-then-cap'; cap: number };

export function parseBatch95CounterSentence(oracle: string): Batch95CounterParse[] {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Batch95CounterParse[] = [];
  const you = text.match(YOU_PUT_PLUS_RE);
  if (you) out.push({ kind: 'any-counters-plus', plus: num(you[1]), actorIsYou: true });
  const team = text.match(TEAM_PLUS_RE);
  if (team) out.push({ kind: 'any-counters-plus', plus: num(team[1]), team: /your team/.test(team[0]) });
  const minus = text.match(MINUS_M1M1_RE);
  if (minus) out.push({ kind: 'm1m1-minus', minus: num(minus[1]) });
  if (MELIRA_POISON_RE.test(text)) out.push({ kind: 'poison-first-then-cap', cap: 1 });
  return out;
}

export function collectBatch95CounterReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch95CounterSentence(oracle).map((entry, i) => {
    if (entry.kind === 'any-counters-plus') {
      return {
        id: `${source.sourcePermanentId}:any-counters-plus-${entry.plus}${i ? `-${i}` : ''}`,
        event: 'counter-placement' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { targetControllerIsSourceController: true },
        instead: { modify: 'add_flat' as const, value: entry.plus },
        effectId: entry.actorIsYou ? 'you-put-counters-plus-n' : 'team-counters-plus-n',
        reason: entry.actorIsYou ? 'you_put_counters_plus_n' : 'team_counters_plus_n',
        metadata: { plus: entry.plus, actorIsYou: entry.actorIsYou === true, team: entry.team === true },
      } as ReplacementEffectSpec;
    }
    if (entry.kind === 'm1m1-minus') {
      return {
        id: `${source.sourcePermanentId}:m1m1-counters-minus-${entry.minus}${i ? `-${i}` : ''}`,
        event: 'counter-placement' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { counterTypeIncludes: '-1/-1', targetControllerIsSourceController: true, targetTypeIncludes: 'creature' },
        instead: { modify: 'add_flat' as const, value: -entry.minus },
        effectId: 'm1m1-counters-minus-n',
        reason: 'm1m1_counters_minus_n',
        metadata: { minus: entry.minus },
      } as ReplacementEffectSpec;
    }
    return {
      id: `${source.sourcePermanentId}:poison-first-then-cap`,
      event: 'counter-placement' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { counterTypeIncludes: 'poison', targetControllerIsSourceController: true },
      instead: { modify: 'cap' as const, value: entry.cap },
      effectId: 'poison-first-then-cap',
      reason: 'poison_first_then_cap',
      metadata: { cap: entry.cap },
    } as ReplacementEffectSpec;
  });
}

export function collectBatch95CounterReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch95CounterReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

/** Cap poison gained this turn per Melira, the Living Cure. Returns the amount to actually apply. */
export function applyMeliraPoisonReplacement(state: any, playerId: string, amount: number): number {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!playerId || n <= 0) return 0;
  const specs = collectBatch95CounterReplacementSpecsFromState(state)
    .filter((s) => s.effectId === 'poison-first-then-cap' && String(s.sourceController) === String(playerId));
  if (!specs.length) return n;
  const flags = (state.poisonCappedThisTurn = state.poisonCappedThisTurn || {});
  if (flags[playerId]) return 0;
  flags[playerId] = true;
  return Math.min(n, 1);
}
