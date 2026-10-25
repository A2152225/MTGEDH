import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context.js';
import { applyDamageSideEffectReplacements } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsDamageSideEffects.js';
import { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { parseBatch18PreventAllSentence } from '../src/state/modules/replacementBatch18PreventAll.js';
import { dropSkippedExtraTurns } from '../src/state/modules/replacementBatch16LongTail.js';
import { applyBatch18EmptyLibraryDrawInstead } from '../src/state/modules/replacementBatch18DrawInstead.js';
import { collectBatch17DamagePreventionRules, applyBatch17DamagePrevention } from '../src/state/modules/replacementBatch17DamagePrevention.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

type Perm = { id: string; controller: string; owner: string; card: { name: string; type_line: string; oracle_text: string }; counters?: Record<string, number>; [k: string]: unknown };
const perm = (id: string, name: string, oracle: string, extra: Partial<Perm> = {}, controller = 'p1', type_line = 'Creature'): Perm =>
  ({ id, controller, owner: controller, card: { name, type_line, oracle_text: oracle }, ...extra });
const players = () => [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }];
// Single fixture adapter: tests build plain state objects, the API takes a GameContext.
const ctxOf = (state: object): GameContext => ({ state }) as unknown as GameContext;

function prevented(state: { battlefield: Perm[] }, input: { damageDealer: string; damageReceiver: string; damageSourcePermanentId?: string; targetPermanentId?: string; isCombatDamage?: boolean }): boolean {
  return collectOraclePatternDamageReplacementSpecsFromState(state)
    .some((spec) => spec.instead?.modify === 'cap' && spec.instead?.value === 0 && overlaySpecsMatchDamage(spec, input, state));
}

describe('batch18 noncombat prevention (isCombatDamage plumbed)', () => {
  it('Purity prevents noncombat damage to you and gains that much life; combat damage passes', () => {
    const p = perm('pu', 'Purity', 'Flying\nIf noncombat damage would be dealt to you, prevent that damage. You gain life equal to the damage prevented this way.');
    const state = { battlefield: [p], players: players(), life: {} as Record<string, number> };
    expect(applyDamageSideEffectReplacements(ctxOf(state), 3, 'p2', 'p1', undefined, undefined, false)?.amount).toBe(0);
    expect(state.life.p1).toBe(43);
    expect(applyDamageSideEffectReplacements(ctxOf(state), 3, 'p2', 'p1', undefined, undefined, true)).toBeNull();
  });
  it('Stormwild Capridor turns noncombat damage into +1/+1 counters', () => {
    const p = perm('sc', 'Stormwild Capridor', 'Flying\nIf noncombat damage would be dealt to this creature, prevent that damage. Put a +1/+1 counter on this creature for each 1 damage prevented this way.', { counters: {} });
    const state = { battlefield: [p], players: players() };
    expect(applyDamageSideEffectReplacements(ctxOf(state), 2, 'p2', 'p1', undefined, 'sc', false)?.amount).toBe(0);
    expect(p.counters?.['+1/+1']).toBe(2);
    expect(applyDamageSideEffectReplacements(ctxOf(state), 2, 'p2', 'p1', undefined, 'sc', true)).toBeNull();
  });
});

describe('batch18 generic prevent-all', () => {
  it('Fog Bank prevents combat damage to and by itself only', () => {
    const fb = perm('fb', 'Fog Bank', 'Defender, flying\nPrevent all combat damage that would be dealt to and dealt by Fog Bank.');
    const atk = perm('a', 'Bear', '', {}, 'p2');
    const state = { battlefield: [fb, atk] };
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'a', targetPermanentId: 'fb', isCombatDamage: true })).toBe(true);
    expect(prevented(state, { damageDealer: 'p1', damageReceiver: 'p2', damageSourcePermanentId: 'fb', targetPermanentId: 'a', isCombatDamage: true })).toBe(true);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'a', targetPermanentId: 'fb', isCombatDamage: false })).toBe(false);
  });
  it('The Wanderer covers you and other permanents you control, noncombat only', () => {
    const w = perm('w', 'The Wanderer', 'Prevent all noncombat damage that would be dealt to you and other permanents you control.', {}, 'p1', 'Legendary Planeswalker');
    const mine = perm('m', 'Elf', '');
    const theirs = perm('t', 'Orc', '', {}, 'p2');
    const state = { battlefield: [w, mine, theirs] };
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', isCombatDamage: false })).toBe(true);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'm', isCombatDamage: false })).toBe(true);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'w', isCombatDamage: false })).toBe(false);
    expect(prevented(state, { damageDealer: 'p1', damageReceiver: 'p2', targetPermanentId: 't', isCombatDamage: false })).toBe(false);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', isCombatDamage: true })).toBe(false);
  });
  it('Iroas protects attacking creatures you control; Desert Nomads only from deserts', () => {
    const ir = perm('ir', 'Iroas, God of Victory', 'Prevent all damage that would be dealt to attacking creatures you control.');
    const atk = perm('x', 'Bear', '', { attacking: 'p2' });
    const idle = perm('y', 'Bear', '');
    const dn = perm('dn', 'Desert Nomads', 'Prevent all damage that would be dealt to Desert Nomads by Deserts.');
    const desert = perm('d', 'Desert', '', {}, 'p2', 'Land — Desert');
    const state = { battlefield: [ir, atk, idle, dn, desert] };
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'x' })).toBe(true);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'y' })).toBe(false);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'd', targetPermanentId: 'dn' })).toBe(true);
    expect(prevented(state, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'x', targetPermanentId: 'dn' })).toBe(false);
  });
  it('Personal Sanctuary only during your turn; source-side snow filter parses', () => {
    const ps = perm('ps', 'Personal Sanctuary', 'During your turn, prevent all damage that would be dealt to you.', {}, 'p1', 'Enchantment');
    expect(prevented({ battlefield: [ps], turnPlayer: 'p1' } as { battlefield: Perm[] }, { damageDealer: 'p2', damageReceiver: 'p1' })).toBe(true);
    expect(prevented({ battlefield: [ps], turnPlayer: 'p2' } as { battlefield: Perm[] }, { damageDealer: 'p2', damageReceiver: 'p1' })).toBe(false);
    expect(parseBatch18PreventAllSentence('prevent all damage that ~ would deal to snow creatures')).toHaveLength(1);
    expect(parseBatch18PreventAllSentence('prevent all damage that would be dealt to you and permanents you control by sources with the chosen name')).toEqual([]);
  });
});

describe('batch18 Stranglehold, empty-library draw, article', () => {
  it('Stranglehold skips only opponents\' extra turns', () => {
    const state = { battlefield: [perm('s', 'Stranglehold', "Your opponents can't search libraries.\nIf an opponent would begin an extra turn, that player skips that turn instead.", {}, 'p1', 'Enchantment')] } as { battlefield: Perm[]; skippedExtraTurns?: unknown[] };
    const turns = [{ playerId: 'p1' }, { playerId: 'p2' }];
    expect(dropSkippedExtraTurns(state, turns)).toBe(1);
    expect(turns).toEqual([{ playerId: 'p1' }]);
    expect(state.skippedExtraTurns).toHaveLength(1);
  });
  it('Ormos gets five counters instead of drawing from an empty library', () => {
    const o = perm('o', 'Ormos, Archive Keeper', 'If you would draw a card while your library has no cards in it, instead put five +1/+1 counters on Ormos.', { counters: {} });
    const state = { battlefield: [o] };
    expect(applyBatch18EmptyLibraryDrawInstead(state, 'p1', 3)).toBe(false);
    expect(applyBatch18EmptyLibraryDrawInstead(state, 'p1', 0)).toBe(true);
    expect(o.counters?.['+1/+1']).toBe(5);
    expect(applyBatch18EmptyLibraryDrawInstead(state, 'p2', 0)).toBe(false);
  });
  it('Nine Lives message uses "an incarnation counter"', () => {
    const p = perm('nl', 'Nine Lives', 'If a source would deal damage to you, prevent that damage and put an incarnation counter on this enchantment.', { counters: {} });
    const state = { battlefield: [p], players: players() };
    expect(collectBatch17DamagePreventionRules(state)).toHaveLength(1);
    expect(applyBatch17DamagePrevention(ctxOf(state), 2, 'p1')?.modifiers[0]).toContain('added an incarnation counter');
  });
  it('census classifies the Batch 18 families', () => {
    for (const [line, name] of [
      ['If noncombat damage would be dealt to you, prevent that damage.', 'Purity'],
      ['If an opponent would begin an extra turn, that player skips that turn instead.', 'Stranglehold'],
      ['If you would draw a card while your library has no cards in it, instead put five +1/+1 counters on Ormos.', 'Ormos, Archive Keeper'],
    ]) expect(classifyStaticCensusLine(line, name)?.system, line).toBeTruthy();
  });
});