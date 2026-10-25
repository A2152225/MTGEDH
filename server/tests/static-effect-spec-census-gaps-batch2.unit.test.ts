import { describe, expect, it } from 'vitest';

import {
  getContinuousGrantedAbilitiesForPermanent,
  getContinuousPTBonusForPermanent,
} from '../src/state/modules/staticEffectSpec.js';

function creature(id: string, controller: string, oracle = '', name = 'Bear ' + id) {
  return { id, controller, card: { name, type_line: 'Creature \u2014 Bear', oracle_text: oracle, colors: ['G'] } };
}

// Granted ability text is stored lowercased, matching the oracle pipeline.
describe('Static census batch 2: attached quoted grants', () => {
  it('Fire Whip-style aura grants the quoted ability to its host only', () => {
    const state: any = {
      battlefield: [
        creature('host', 'p1'),
        creature('other', 'p1'),
        { id: 'whip', controller: 'p1', attachedTo: 'host', card: { name: 'Fire Whip', type_line: 'Enchantment \u2014 Aura',
          oracle_text: 'Enchant creature you control\nEnchanted creature has "{T}: This creature deals 1 damage to any target."\nSacrifice Fire Whip: Fire Whip deals 1 damage to any target.' } },
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0], state))
      .toContain('{t}: this creature deals 1 damage to any target.');
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1], state))
      .not.toContain('{t}: this creature deals 1 damage to any target.');
  });

  it('equipment "+N/+N and has" grants the quoted ability without doubling P/T', () => {
    const state: any = {
      battlefield: [
        creature('host', 'p1'),
        { id: 'eq', controller: 'p1', attachedTo: 'host', card: { name: 'Test Blade', type_line: 'Artifact \u2014 Equipment',
          oracle_text: 'Equipped creature gets +1/+1 and has "Whenever this creature deals combat damage to a player, draw a card."\nEquip {2}' } },
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0], state))
      .toContain('whenever this creature deals combat damage to a player, draw a card.');
    const before = getContinuousPTBonusForPermanent(state.battlefield[0], { battlefield: [state.battlefield[0]] } as any);
    const after = getContinuousPTBonusForPermanent(state.battlefield[0], state);
    expect(after.power - before.power).toBeLessThanOrEqual(1);
  });

  it('land aura grants a quoted mana ability to the enchanted land', () => {
    const state: any = {
      battlefield: [
        { id: 'land', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land \u2014 Forest', oracle_text: '({T}: Add {G}.)' } },
        { id: 'aura', controller: 'p1', attachedTo: 'land', card: { name: 'Test Bloom', type_line: 'Enchantment \u2014 Aura',
          oracle_text: 'Enchant land\nEnchanted land has "{T}: Add two mana of any one color."' } },
      ],
    };
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[0], state))
      .toContain('{t}: add two mana of any one color.');
  });
});

describe('Static census batch 2: conditional self grants', () => {
  it('"During your turn, this creature has first strike" applies only on its controller\'s turn', () => {
    const knight = creature('k', 'p1', 'During your turn, this creature has first strike.', 'Test Knight');
    const mine: any = { battlefield: [knight], turnPlayer: 'p1' };
    const theirs: any = { battlefield: [knight], turnPlayer: 'p2' };
    expect(getContinuousGrantedAbilitiesForPermanent(knight as any, mine)).toContain('first strike');
    expect(getContinuousGrantedAbilitiesForPermanent(knight as any, theirs)).not.toContain('first strike');
  });

  it('threshold "gets +N/+N as long as seven or more cards are in your graveyard" (no "and has")', () => {
    const mongoose = creature('m', 'p1', 'Shroud\nThreshold \u2014 This creature gets +2/+2 as long as seven or more cards are in your graveyard.', 'Nimble Mongoose');
    const gy = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'g' + i }));
    const on: any = { battlefield: [mongoose], zones: { p1: { graveyard: gy(7) } } };
    const off: any = { battlefield: [mongoose], zones: { p1: { graveyard: gy(6) } } };
    expect(getContinuousPTBonusForPermanent(mongoose as any, on)).toEqual({ power: 2, toughness: 2 });
    expect(getContinuousPTBonusForPermanent(mongoose as any, off)).toEqual({ power: 0, toughness: 0 });
  });

  it('"as long as there are N or more cards in your graveyard" uses the printed count', () => {
    const c = creature('c', 'p1', 'This creature gets +1/+0 as long as there are four or more cards in your graveyard.', 'Test Ghoul');
    const gy = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'g' + i }));
    expect(getContinuousPTBonusForPermanent(c as any, { battlefield: [c], zones: { p1: { graveyard: gy(4) } } } as any))
      .toEqual({ power: 1, toughness: 0 });
    expect(getContinuousPTBonusForPermanent(c as any, { battlefield: [c], zones: { p1: { graveyard: gy(3) } } } as any))
      .toEqual({ power: 0, toughness: 0 });
  });
});
