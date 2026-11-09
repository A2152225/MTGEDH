import { describe, expect, it } from 'vitest';
import { attachedMakesHostCreature, stampAttachedTypeSettingOverrides } from '../src/state/modules/attachedTypeSettingStamp.js';
import { resolveSetBasePTFromAttachedAuras } from '../src/state/utils-handlers/ptAttachedBonusParseHelpers.js';
import { collectStaticEffectSpecsFromState } from '../src/state/modules/staticEffectSpec.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { qualifiedUntapProhibitionSource } from '../src/state/modules/untapQualifierProhibitions.js';
import { permanentCantHaveCountersPut } from '../src/state/modules/counterPlacementRestrictions.js';
import { calculateCostReduction } from '../src/socket/game-actions-handlers/gameActionsCastCostReduction.js';
import { cantAttackAloneReason } from '../src/socket/combat-handlers/combatBatch53AttackAlone.js';

const aura = (id: string, name: string, oracle: string, attachedTo: string, extra: any = {}) => ({
  id, controller: 'p1', owner: 'p1', attachedTo,
  card: { id: id + 'c', name, type_line: 'Enchantment — Aura', oracle_text: oracle, ...extra.card },
  ...extra,
});
const land = (id: string, type_line = 'Basic Land — Mountain') => ({
  id, controller: 'p1', owner: 'p1',
  card: { id: id + 'c', name: id, type_line, oracle_text: '' },
});
const creature = (id: string, oracle: string, extra: any = {}) => ({
  id, controller: 'p1', owner: 'p1',
  card: { id: id + 'c', name: extra.name || id, type_line: extra.type_line || 'Creature — Test', oracle_text: oracle },
  counters: extra.counters || {},
  ...extra,
});

describe('batch53 long-tail statics', () => {
  it('Awaken the Ancient animates enchanted Mountain with haste and 7/7', () => {
    const oracle = 'Enchant Mountain\nEnchanted Mountain is a 7/7 red Giant creature with haste. It\'s still a land.';
    expect(attachedMakesHostCreature(oracle)).toBe(true);
    const mountain = land('m1');
    const awaken = aura('a1', 'Awaken the Ancient', oracle, 'm1');
    const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [mountain, awaken], zones: {} };
    stampAttachedTypeSettingOverrides(state);
    expect(mountain.isCreature).toBe(true);
    const pt = resolveSetBasePTFromAttachedAuras(mountain, state.battlefield);
    expect(pt).toEqual({ power: 7, toughness: 7 });
    collectStaticEffectSpecsFromState(state);
    const abilities = getContinuousGrantedAbilitiesForPermanent(mountain, state).map((a: string) => String(a).toLowerCase());
    expect(abilities).toEqual(expect.arrayContaining(['haste']));
  });

  it('Living Terrain that\'s-still form sets base P/T', () => {
    const oracle = 'Enchant land\nEnchanted land is a 5/6 green Treefolk creature that\'s still a land.';
    expect(attachedMakesHostCreature(oracle)).toBe(true);
    const forest = land('f1', 'Basic Land — Forest');
    const living = aura('a2', 'Living Terrain', oracle, 'f1');
    const pt = resolveSetBasePTFromAttachedAuras(forest, [forest, living]);
    expect(pt).toEqual({ power: 5, toughness: 6 });
  });

  it('Blossombind blocks untap and counters on enchanted creature', () => {
    const host = creature('c1', '');
    const blossom = aura('b1', 'Blossombind',
      'Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature can\'t become untapped and can\'t have counters put on it.',
      'c1');
    const bf = [host, blossom];
    expect(qualifiedUntapProhibitionSource(bf, host)).toMatch(/Blossombind/i);
    expect(permanentCantHaveCountersPut({ battlefield: bf }, host)).toBe(true);
  });

  it('Ragemonger reduces Minotaur spells by {B}{R}', () => {
    const game = {
      state: {
        battlefield: [{
          id: 'r1', controller: 'p1',
          card: {
            name: 'Ragemonger',
            oracle_text: 'Minotaur spells you cast cost {B}{R} less to cast. This effect reduces only the amount of colored mana you pay.',
            type_line: 'Creature — Minotaur Shaman',
          },
        }],
      },
    };
    const spell = { name: 'Minotaur Skullcleaver', type_line: 'Creature — Minotaur Berserker', mana_cost: '{2}{R}', colors: ['R'] };
    const red = calculateCostReduction(game, 'p1', spell);
    expect(red.colors.black).toBeGreaterThanOrEqual(1);
    expect(red.colors.red).toBeGreaterThanOrEqual(1);
    expect(red.messages.join(' ')).toMatch(/Ragemonger/i);
  });

  it('Edgewalker reduces Cleric spells by {W}{B}', () => {
    const game = {
      state: {
        battlefield: [{
          id: 'e1', controller: 'p1',
          card: {
            name: 'Edgewalker',
            oracle_text: 'Cleric spells you cast cost {W}{B} less to cast. This effect reduces only the amount of colored mana you pay.',
            type_line: 'Creature — Human Cleric',
          },
        }],
      },
    };
    const spell = { name: 'Soul Warden', type_line: 'Creature — Human Cleric', mana_cost: '{W}', colors: ['W'] };
    const red = calculateCostReduction(game, 'p1', spell);
    expect(red.colors.white).toBeGreaterThanOrEqual(1);
    expect(red.colors.black).toBeGreaterThanOrEqual(1);
  });

  it('Bonded Construct cannot attack alone but can with a partner', () => {
    const alone = creature('bc', 'This creature can\'t attack alone.', { name: 'Bonded Construct' });
    expect(cantAttackAloneReason(alone, ['bc'], [alone])).toMatch(/alone/i);
    expect(cantAttackAloneReason(alone, ['bc', 'other'], [alone, creature('other', '')])).toBeNull();
  });

  it('Pipsqueak alone-unless-+1/+1 lifts when it has a counter', () => {
    const pip = creature('pip', 'Pipsqueak can\'t attack alone unless he has a +1/+1 counter on him.', {
      name: 'Pipsqueak, Rebel Strongarm',
      counters: { '+1/+1': 1 },
    });
    expect(cantAttackAloneReason(pip, ['pip'], [pip])).toBeNull();
    const pip0 = { ...pip, counters: {} };
    expect(cantAttackAloneReason(pip0, ['pip'], [pip0])).toMatch(/alone/i);
  });

  it('Long-Lost Lances grants first strike and vigilance to equipped creatures on your turn', () => {
    const lance = {
      id: 'lll', controller: 'p1', owner: 'p1',
      card: {
        id: 'lllc', name: 'Long-Lost Lances', type_line: 'Artifact',
        oracle_text: 'During your turn, creatures you control that are equipped have first strike and vigilance.',
      },
    };
    const equipped = creature('eq', '', { name: 'Armed' });
    const gear = {
      id: 'eqp', controller: 'p1', owner: 'p1', attachedTo: 'eq',
      card: { id: 'eqpc', name: 'Sword', type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature gets +1/+1.' },
    };
    const unequipped = creature('ue', '', { name: 'Bare' });
    const state: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      turnPlayer: 'p1',
      battlefield: [lance, equipped, gear, unequipped],
      zones: {},
    };
    collectStaticEffectSpecsFromState(state);
    const eqAbilities = getContinuousGrantedAbilitiesForPermanent(equipped, state).map((a: string) => String(a).toLowerCase());
    expect(eqAbilities).toEqual(expect.arrayContaining(['first strike', 'vigilance']));
    const ueAbilities = getContinuousGrantedAbilitiesForPermanent(unequipped, state).map((a: string) => String(a).toLowerCase());
    expect(ueAbilities.join('|')).not.toMatch(/first strike|vigilance/);
  });

});
