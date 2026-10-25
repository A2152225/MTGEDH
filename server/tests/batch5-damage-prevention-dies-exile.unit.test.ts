import { describe, expect, it } from 'vitest';
import { collectReplacementEffectSpecsFromState, evaluateDeclarativeReplacementEvent } from '../src/state/modules/replacementEffectSpec.js';
import { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { findMinimumBlockersViolation, getMinimumBlockers } from '../src/socket/combat-handlers/combatMinimumBlockers.js';

const perm = (id: string, controller: string, name: string, oracle_text: string, type_line = 'Creature', extra: any = {}) =>
  ({ id, controller, owner: controller, card: { name, oracle_text, type_line, ...(extra.card || {}) }, ...extra });

function damageSpecs(battlefield: any[]) {
  return collectOraclePatternDamageReplacementSpecsFromState({ battlefield });
}

describe('batch 5 damage prevention templates', () => {
  it('prevents damage to the named source only', () => {
    const state = { battlefield: [perm('w', 'p1', 'Wall of Glass', 'If damage would be dealt to Wall of Glass, prevent that damage.'), perm('o', 'p1', 'Other', '')] };
    const [spec] = damageSpecs(state.battlefield).filter((s) => s.effectId === 'prevent-all-damage-to-self');
    expect(spec?.instead).toMatchObject({ modify: 'cap', value: 0 });
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'w' }, state)).toBe(true);
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'o' }, state)).toBe(false);
  });

  it('skips Phantom-style prevention with a follow-up counter cost', () => {
    const bf = [perm('ph', 'p1', 'Phantom Thing', 'If damage would be dealt to Phantom Thing, prevent that damage. Remove a +1/+1 counter from Phantom Thing.')];
    expect(damageSpecs(bf).some((s) => s.effectId === 'prevent-all-damage-to-self')).toBe(false);
  });

  it('combat-only and by-creatures variants', () => {
    const state = { battlefield: [perm('a', 'p1', 'Guard', 'Prevent all combat damage that would be dealt to Guard.'), perm('b', 'p1', 'Shield', 'Prevent all damage that would be dealt to Shield by creatures.'), perm('src', 'p2', 'Shock Thing', '', 'Instant')] };
    const specs = damageSpecs(state.battlefield);
    const combat = specs.find((s) => s.effectId === 'prevent-combat-damage-to-self')!;
    expect(overlaySpecsMatchDamage(combat, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'a', isCombatDamage: true }, state)).toBe(true);
    expect(overlaySpecsMatchDamage(combat, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'a', isCombatDamage: false }, state)).toBe(false);
    const byCreature = specs.find((s) => s.effectId === 'prevent-creature-damage-to-self')!;
    state.battlefield.push(perm('bear', 'p2', 'Bear', ''));
    expect(overlaySpecsMatchDamage(byCreature, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'b', damageSourcePermanentId: 'bear' }, state)).toBe(true);
    expect(overlaySpecsMatchDamage(byCreature, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'b', damageSourcePermanentId: 'src' }, state)).toBe(false);
  });

  it('enchanted creature to-and-by produces two specs', () => {
    const bf = [perm('aura', 'p1', 'Sandskin', 'Enchant creature\nPrevent all combat damage that would be dealt to and dealt by enchanted creature.', 'Enchantment - Aura', { attachedTo: 'c' }), perm('c', 'p2', 'Bear', '')];
    const ids = damageSpecs(bf).map((s) => s.effectId);
    expect(ids).toEqual(expect.arrayContaining(['prevent-combat-damage-by-enchanted', 'prevent-combat-damage-to-enchanted']));
    const to = damageSpecs(bf).find((s) => s.effectId === 'prevent-combat-damage-to-enchanted')!;
    expect(overlaySpecsMatchDamage(to, { damageDealer: 'p1', damageReceiver: 'p2', targetPermanentId: 'c', isCombatDamage: true }, { battlefield: bf })).toBe(true);
  });

  it('prevent N from colored or opponent sources to you', () => {
    const state = { battlefield: [perm('cop', 'p1', 'Ward Thing', 'If a red source would deal damage to you, prevent 1 of that damage.', 'Enchantment'), perm('r', 'p2', 'Goblin', '', 'Creature', { card: { colors: ['R'] } }), perm('g', 'p2', 'Elf', '', 'Creature', { card: { colors: ['G'] } })] };
    const spec = damageSpecs(state.battlefield).find((s) => s.reason === 'prevent_n_damage_to_you')!;
    expect(spec.instead).toMatchObject({ modify: 'add_flat', value: -1 });
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'r' }, state)).toBe(true);
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'g' }, state)).toBe(false);
    const opp = damageSpecs([perm('x', 'p1', 'Opp Ward', 'If a source an opponent controls would deal damage to you, prevent 2 of that damage.', 'Enchantment')])[0];
    expect(opp.instead).toMatchObject({ value: -2 });
    expect(overlaySpecsMatchDamage(opp, { damageDealer: 'p2', damageReceiver: 'p1' }, { battlefield: [] })).toBe(true);
    expect(overlaySpecsMatchDamage(opp, { damageDealer: 'p1', damageReceiver: 'p1' }, { battlefield: [] })).toBe(false);
  });

  it('noncombat damage to other creatures you control', () => {
    const bf = [perm('s', 'p1', 'Shelter', 'Prevent all noncombat damage that would be dealt to other creatures you control.'), perm('c', 'p1', 'Bear', '')];
    const spec = damageSpecs(bf).find((s) => s.effectId.includes('noncombat'))!;
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'c' }, { battlefield: bf })).toBe(true);
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 's' }, { battlefield: bf })).toBe(false);
    expect(overlaySpecsMatchDamage(spec, { damageDealer: 'p2', damageReceiver: 'p1', targetPermanentId: 'c', isCombatDamage: true }, { battlefield: bf })).toBe(false);
  });
});

describe('batch 5 dies-exile templates', () => {
  it('exiles opponent creatures that would die, not own', () => {
    const own = perm('mine', 'p1', 'Bear', '');
    const theirs = perm('theirs', 'p2', 'Bear', '');
    const state = { battlefield: [perm('k', 'p1', 'Keeper', 'If a creature an opponent controls would die, exile it instead.'), own, theirs] };
    expect(collectReplacementEffectSpecsFromState(state).some((s) => s.effectId === 'opponent-creature-die-exile-instead')).toBe(true);
    const ev = (o: any) => evaluateDeclarativeReplacementEvent({ type: 'zone-change', object: o, objectId: o.id, sourceZone: 'battlefield', destinationZone: 'graveyard', controller: o.controller, state } as any, state);
    expect(ev(theirs)?.applied).toBe(true);
    expect(ev(own)?.applied ?? false).toBe(false);
  });

  it('exiles the source itself when it would die', () => {
    const self = perm('s', 'p1', 'Ghost Bear', 'If Ghost Bear would die, exile it instead.');
    const other = perm('o', 'p1', 'Bear', '');
    const state = { battlefield: [self, other] };
    const ev = (o: any) => evaluateDeclarativeReplacementEvent({ type: 'zone-change', object: o, objectId: o.id, sourceZone: 'battlefield', destinationZone: 'graveyard', controller: 'p1', state } as any, state);
    expect(ev(self)?.applied).toBe(true);
    expect(ev(other)?.applied ?? false).toBe(false);
  });
});

describe('batch 5 minimum blockers', () => {
  it('reads menace and "N or more creatures"', () => {
    expect(getMinimumBlockers({ card: { oracle_text: 'Menace' } })).toBe(2);
    expect(getMinimumBlockers({ card: { oracle_text: "Tromokratis can't be blocked except by three or more creatures." } })).toBe(3);
    expect(getMinimumBlockers({ card: { oracle_text: 'Flying' } })).toBe(1);
  });

  it('flags too few blockers', () => {
    const bf = [{ id: 'a', card: { name: 'Menacer', oracle_text: 'Menace' } }, { id: 'b1' }, { id: 'b2' }];
    expect(findMinimumBlockersViolation(bf as any, [{ blockerId: 'b1', attackerId: 'a' }] as any)).toMatchObject({ attackerId: 'a', required: 2, count: 1 });
    expect(findMinimumBlockersViolation(bf as any, [{ blockerId: 'b1', attackerId: 'a' }, { blockerId: 'b2', attackerId: 'a' }] as any)).toBeNull();
  });
});
