import { describe, expect, it } from 'vitest';

import {
  getActualPowerToughness,
  resolveSetBasePTFromAttachedAuras,
} from '../src/state/utils.js';

function makeCreature(id = 'creature_1', controller = 'p1', opts: { power?: number; toughness?: number; counters?: Record<string, number> } = {}) {
  return {
    id,
    controller,
    basePower: opts.power ?? 5,
    baseToughness: opts.toughness ?? 5,
    counters: opts.counters ?? {},
    card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '5', toughness: '5', oracle_text: '' },
    attachedEquipment: [] as string[],
  };
}

function makeAura(id: string, creatureId: string, oracleText: string) {
  return {
    id,
    controller: 'p1',
    attachedTo: creatureId,
    card: {
      name: 'Test Aura',
      type_line: 'Enchantment — Aura',
      oracle_text: oracleText,
    },
  };
}

describe('resolveSetBasePTFromAttachedAuras', () => {
  it('sets base P/T from Frogify-style aura', () => {
    const creature = makeCreature();
    const frogify = makeAura(
      'frogify_1',
      creature.id,
      'Enchant creature\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.',
    );
    creature.attachedEquipment.push(frogify.id);

    expect(resolveSetBasePTFromAttachedAuras(creature, [creature, frogify])).toEqual({
      power: 1,
      toughness: 1,
    });
  });

  it('sets base P/T from Lignify-style aura', () => {
    const creature = makeCreature();
    const lignify = makeAura(
      'lignify_1',
      creature.id,
      'Enchant creature\nEnchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.',
    );
    creature.attachedEquipment.push(lignify.id);

    expect(resolveSetBasePTFromAttachedAuras(creature, [creature, lignify])).toEqual({
      power: 0,
      toughness: 4,
    });
  });

  it('sets base P/T from Kenrith\'s Transformation-style aura', () => {
    const creature = makeCreature();
    const kenrith = makeAura(
      'kenrith_1',
      creature.id,
      'Enchant creature\nEnchanted creature loses all abilities and has base power and toughness 3/3.',
    );
    creature.attachedEquipment.push(kenrith.id);

    expect(resolveSetBasePTFromAttachedAuras(creature, [creature, kenrith])).toEqual({
      power: 3,
      toughness: 3,
    });
  });
});

describe('getActualPowerToughness with set-base-P/T auras', () => {
  it('applies counters on top of Frogify base P/T', () => {
    const creature = makeCreature('bear_1', 'p1', { counters: { '+1/+1': 2 } });
    const frogify = makeAura(
      'frogify_1',
      creature.id,
      'Enchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.',
    );
    creature.attachedEquipment.push(frogify.id);
    const state = { battlefield: [creature, frogify] };

    expect(getActualPowerToughness(creature, state)).toEqual({ power: 3, toughness: 3 });
  });
});
