import { describe, it, expect } from 'vitest';
import { applyDamageSideEffectReplacements } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsDamageSideEffects.js';
import { collectBatch17DamagePreventionRules } from '../src/state/modules/replacementBatch17DamagePrevention.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const perm = (id: string, name: string, oracle: string, extra: any = {}) =>
  ({ id, controller: 'p1', owner: 'p1', card: { name, type_line: 'Creature', oracle_text: oracle }, ...extra });
const players = [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }];

describe('batch17 mixed "prevent that damage, remove a counter" sentences', () => {
  it('generic comma form removes one counter', () => {
    const p = perm('h', 'Hydra Test', 'If damage would be dealt to this creature, prevent that damage, remove a +1/+1 counter from it.', { counters: { '+1/+1': 3 } });
    const res = applyDamageSideEffectReplacements({ state: { battlefield: [p], players } } as any, 2, 'x', 'p1', undefined, 'h');
    expect(res?.amount).toBe(0);
    expect(p.counters['+1/+1']).toBe(2);
  });
  it('Bloatfly Swarm removes that many and gives each player rad counters; needs a counter', () => {
    const o = 'Flying\nIf damage would be dealt to this creature while it has a +1/+1 counter on it, prevent that damage, remove that many +1/+1 counters from it, then give each player a rad counter for each +1/+1 counter removed this way.';
    const p = perm('b', 'Bloatfly Swarm', o, { counters: { '+1/+1': 2 } });
    const state: any = { battlefield: [p], players: players.map((x) => ({ ...x })) };
    const res = applyDamageSideEffectReplacements({ state } as any, 5, 'x', 'p1', undefined, 'b');
    expect(res?.amount).toBe(0);
    expect(p.counters['+1/+1']).toBe(0);
    expect(state.radCounters).toEqual({ p1: 2, p2: 2 });
    expect(applyDamageSideEffectReplacements({ state } as any, 1, 'x', 'p1', undefined, 'b')?.amount ?? 1).not.toBe(0);
  });
  it('Sekki parses with the spirit-token follow-up', () => {
    const o = "If damage would be dealt to Sekki, prevent that damage, remove that many +1/+1 counters from Sekki, and create that many 1/1 colorless Spirit creature tokens.";
    const rules = collectBatch17DamagePreventionRules({ battlefield: [perm('s', "Sekki, Seasons' Guide", o)] });
    expect(rules).toEqual([expect.objectContaining({ kind: 'prevent-remove', removeMode: 'amount', followUp: 'spirit-tokens' })]);
  });
  it('Anti-Venom puts that many +1/+1 counters instead', () => {
    const p = perm('av', 'Anti-Venom, Horrifying Healer', 'If damage would be dealt to Anti-Venom, prevent that damage and put that many +1/+1 counters on him.', { counters: {} });
    const res = applyDamageSideEffectReplacements({ state: { battlefield: [p], players } } as any, 4, 'x', 'p1', undefined, 'av');
    expect(res?.amount).toBe(0);
    expect(p.counters['+1/+1']).toBe(4);
  });
  it('Nine Lives prevents damage to its controller and adds an incarnation counter', () => {
    const p = perm('nl', 'Nine Lives', 'If a source would deal damage to you, prevent that damage and put an incarnation counter on this enchantment.', { counters: {} });
    const res = applyDamageSideEffectReplacements({ state: { battlefield: [p], players } } as any, 3, 'p2', 'p1');
    expect(res?.amount).toBe(0);
    expect(p.counters.incarnation).toBe(1);
    expect(applyDamageSideEffectReplacements({ state: { battlefield: [p], players } } as any, 3, 'p1', 'p2')).toBeNull();
  });
  it('census classifies the new families and Knight of the Holy Nimbus with reminder text', () => {
    expect(classifyStaticCensusLine('If this creature would be destroyed, regenerate it. (Tap it, remove it from combat, and heal all damage on it.)', 'Knight of the Holy Nimbus')?.system).toBeTruthy();
    expect(classifyStaticCensusLine('If a source would deal damage to you, prevent that damage and put an incarnation counter on this enchantment.', 'Nine Lives')?.system).toBeTruthy();
  });
});