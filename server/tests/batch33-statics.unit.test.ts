import { describe, it, expect } from 'vitest';
import { nonTypeCreaturesCantAttackReason } from '../src/socket/combat-handlers/combatBatch33AttackRestrictions.js';
import { equipLifeCostError, payEquipLifeCost } from '../src/state/modules/equipNonManaCosts.js';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities.js';
import { spellHasConvokeForCast } from '../src/state/modules/casting-modifiers.js';
import { permanentActivatedAbilitiesLockedByAttachment } from '../src/state/modules/staticActivationLockFromAttachments.js';

const mk = (id: string, controller: string, name: string, type_line: string, oracle_text = '', extra: any = {}) => ({ id, controller, card: { name, type_line, oracle_text }, ...extra });

describe('B33 statics', () => {
  it('non-Eye creatures you control cannot attack', () => {
    const lock = mk('l', 'p1', 'Eye Lock', 'Creature \u2014 Eye', "Non-Eye creatures you control can't attack.");
    const bear = mk('b', 'p1', 'Bear', 'Creature \u2014 Bear');
    const eye = mk('e', 'p1', 'Other Eye', 'Creature \u2014 Eye');
    const foe = mk('f', 'p2', 'Foe Bear', 'Creature \u2014 Bear');
    const bf = [lock, bear, eye, foe];
    expect(nonTypeCreaturesCantAttackReason(bear, bf)).toMatch(/non-eye/);
    expect(nonTypeCreaturesCantAttackReason(eye, bf)).toBeNull();
    expect(nonTypeCreaturesCantAttackReason(lock, bf)).toBeNull();
    expect(nonTypeCreaturesCantAttackReason(foe, bf)).toBeNull();
  });
  it('parses Equip\u2014Pay N life in text order and pays it', () => {
    const abilities = parseEquipAbilitiesFromOracle('Equipped creature gets +2/+0.\nEquip\u2014Pay 3 life.\nEquip {5}');
    expect(abilities.map((a) => a.cost)).toEqual(['Pay 3 life', '{5}']);
    expect(abilities.map((a) => a.index)).toEqual([0, 1]);
    expect(parseEquipAbilitiesFromOracle('Equip {2}').map((a) => a.label)).toEqual(['Equip {2}']);
    const state: any = { life: { p1: 2 }, players: [{ id: 'p1', life: 2 }] };
    expect(equipLifeCostError(state, 'p1', 'Pay 3 life')).toMatch(/3 life/);
    state.life.p1 = 10;
    expect(equipLifeCostError(state, 'p1', 'Pay 3 life')).toBeNull();
    expect(payEquipLifeCost(state, 'p1', 'Pay 3 life')).toBe(true);
    expect(state.life.p1).toBe(7);
    expect(state.players[0].life).toBe(7);
    expect(payEquipLifeCost(state, 'p1', '{2}')).toBe(false);
  });
  it('creature spells you cast have convoke (existing grant path)', () => {
    const state: any = { battlefield: [mk('c', 'p1', 'Convoker', 'Creature', 'Creature spells you cast have convoke.')] };
    expect(spellHasConvokeForCast(state, 'p1', { name: 'Bear', type_line: 'Creature \u2014 Bear', oracle_text: '' })).toBe(true);
    expect(spellHasConvokeForCast(state, 'p1', { name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' })).toBe(false);
  });
  it("Faith's Fetters locks non-mana activations only", () => {
    const target = mk('t', 'p2', 'Elf', 'Creature \u2014 Elf');
    const fetters = mk('ff', 'p1', "Faith's Fetters", 'Enchantment \u2014 Aura', "Enchant permanent\nWhen Faith's Fetters enters, you gain 4 life.\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.", { attachedTo: 't' });
    const state: any = { battlefield: [target, fetters] };
    expect(permanentActivatedAbilitiesLockedByAttachment(target, state, false).locked).toBe(true);
    expect(permanentActivatedAbilitiesLockedByAttachment(target, state, true).locked).toBe(false);
  });
});
