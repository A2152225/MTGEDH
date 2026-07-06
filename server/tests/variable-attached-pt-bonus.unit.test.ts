import { describe, expect, it } from 'vitest';

import {
  calculateEquipmentBonus,
  calculateEquipmentBonusWithSources,
  getEquippedAttackRevealPumpPowerPerCard,
  isEquippedAttackRevealUntilLandPump,
} from '../src/state/utils.js';

function makeCreature(id = 'creature_1', controller = 'p1') {
  return {
    id,
    controller,
    card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    attachedEquipment: [] as string[],
  };
}

function makeAttachedPerm(
  id: string,
  creatureId: string,
  opts: { name: string; typeLine: string; oracleText: string; controller?: string },
) {
  return {
    id,
    controller: opts.controller ?? 'p1',
    attachedTo: creatureId,
    card: {
      name: opts.name,
      type_line: opts.typeLine,
      oracle_text: opts.oracleText,
    },
  };
}

describe('parseVariableAttachedPTBonus via calculateEquipmentBonus', () => {
  it('counts artifacts for Cranial Plating (+1/+0 each)', () => {
    const creature = makeCreature();
    const plating = makeAttachedPerm('plating_1', creature.id, {
      name: 'Cranial Plating',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+0 for each artifact you control.',
    });
    creature.attachedEquipment.push(plating.id);
    const battlefield = [
      creature,
      plating,
      { id: 'sol_1', controller: 'p1', card: { type_line: 'Artifact' } },
      { id: 'sol_2', controller: 'p1', card: { type_line: 'Artifact Creature — Golem' } },
      { id: 'island_1', controller: 'p1', card: { type_line: 'Basic Land — Island' } },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 3, toughness: 0 });
  });

  it('counts artifacts and enchantments for Nettlecyst (+1/+1 each)', () => {
    const creature = makeCreature();
    const nettlecyst = makeAttachedPerm('nettle_1', creature.id, {
      name: 'Nettlecyst',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+1 for each artifact and enchantment you control.',
    });
    creature.attachedEquipment.push(nettlecyst.id);
    const battlefield = [
      creature,
      nettlecyst,
      { id: 'rock_1', controller: 'p1', card: { type_line: 'Artifact' } },
      { id: 'rock_2', controller: 'p1', card: { type_line: 'Artifact' } },
      { id: 'pac_1', controller: 'p1', card: { type_line: 'Enchantment — Aura' } },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 4, toughness: 4 });
  });

  it('counts lands for Blackblade Reforged (+1/+1 each)', () => {
    const creature = makeCreature();
    const blackblade = makeAttachedPerm('bb_1', creature.id, {
      name: 'Blackblade Reforged',
      typeLine: 'Legendary Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+1 for each land you control.',
    });
    creature.attachedEquipment.push(blackblade.id);
    const battlefield = [
      creature,
      blackblade,
      { id: 'plains_1', controller: 'p1', card: { type_line: 'Basic Land — Plains' } },
      { id: 'plains_2', controller: 'p1', card: { type_line: 'Basic Land — Plains' } },
      { id: 'plains_3', controller: 'p1', card: { type_line: 'Basic Land — Plains' } },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 3, toughness: 3 });
  });

  it('counts enchantments you control for Ethereal Armor', () => {
    const creature = makeCreature();
    const armor = makeAttachedPerm('armor_1', creature.id, {
      name: 'Ethereal Armor',
      typeLine: 'Enchantment — Aura',
      oracleText: 'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control.',
    });
    creature.attachedEquipment.push(armor.id);
    const battlefield = [
      creature,
      armor,
      { id: 'pac_1', controller: 'p1', card: { type_line: 'Enchantment — Aura' } },
      { id: 'pac_2', controller: 'p1', card: { type_line: 'Enchantment' } },
      { id: 'opp_pac', controller: 'p2', card: { type_line: 'Enchantment' } },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 3, toughness: 3 });
  });

  it('counts other enchantments on the battlefield for Ancestral Mask (+2/+2 each)', () => {
    const creature = makeCreature();
    const mask = makeAttachedPerm('mask_1', creature.id, {
      name: 'Ancestral Mask',
      typeLine: 'Enchantment — Aura',
      oracleText: 'Enchant creature\nEnchanted creature gets +2/+2 for each other enchantment on the battlefield.',
    });
    creature.attachedEquipment.push(mask.id);
    const battlefield = [
      creature,
      mask,
      { id: 'pac_1', controller: 'p1', card: { type_line: 'Enchantment — Aura' } },
      { id: 'pac_2', controller: 'p2', card: { type_line: 'Enchantment' } },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 4, toughness: 4 });
  });

  it('counts opponents for Blazing Sunsteel (+1/+0 each)', () => {
    const creature = makeCreature();
    const sunsteel = makeAttachedPerm('sun_1', creature.id, {
      name: 'Blazing Sunsteel',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+0 for each opponent you have.',
    });
    creature.attachedEquipment.push(sunsteel.id);
    const gameState = {
      players: [
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
        { id: 'p4', hasLost: true },
      ],
    };

    expect(calculateEquipmentBonus(creature, [creature, sunsteel], gameState)).toEqual({
      power: 2,
      toughness: 0,
    });
  });

  it('counts shared creature types for Stoneforge Masterwork', () => {
    const creature = {
      ...makeCreature(),
      card: { name: 'Soldier', type_line: 'Creature — Human Soldier', oracle_text: '' },
    };
    const masterwork = makeAttachedPerm('sf_1', creature.id, {
      name: 'Stoneforge Masterwork',
      typeLine: 'Artifact — Equipment',
      oracleText:
        'Equipped creature gets +1/+1 for each creature you control that shares a creature type with equipped creature.',
    });
    creature.attachedEquipment.push(masterwork.id);
    const battlefield = [
      creature,
      masterwork,
      {
        id: 'knight_1',
        controller: 'p1',
        card: { type_line: 'Creature — Human Knight' },
      },
      {
        id: 'elf_1',
        controller: 'p1',
        card: { type_line: 'Creature — Elf Warrior' },
      },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 1, toughness: 1 });
  });

  it('counts unique colors among controlled permanents for Conqueror\'s Flail', () => {
    const creature = makeCreature();
    const flail = makeAttachedPerm('flail_1', creature.id, {
      name: "Conqueror's Flail",
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+1 for each color among permanents you control.',
    });
    creature.attachedEquipment.push(flail.id);
    const battlefield = [
      creature,
      flail,
      { id: 'plains_1', controller: 'p1', card: { type_line: 'Land', colors: ['W'] } },
      { id: 'island_1', controller: 'p1', card: { type_line: 'Land', colors: ['U'] } },
      { id: 'mountain_1', controller: 'p1', card: { type_line: 'Land', colors: ['R'] } },
      { id: 'duplicate_white', controller: 'p1', card: { type_line: 'Creature', colors: ['W'] } },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 3, toughness: 3 });
  });

  it('does not treat variable text as a flat static bonus', () => {
    const creature = makeCreature();
    const custom = makeAttachedPerm('custom_1', creature.id, {
      name: 'Custom Test Equipment',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+1 for each land you control.',
    });
    creature.attachedEquipment.push(custom.id);
    const battlefield = [creature, custom];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 0, toughness: 0 });
  });

  it('parses static +N/+0 equipment bonuses from oracle text', () => {
    const creature = makeCreature();
    const bonesplitter = makeAttachedPerm('bone_1', creature.id, {
      name: 'Custom Splitter',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +2/+0.',
    });
    creature.attachedEquipment.push(bonesplitter.id);

    expect(calculateEquipmentBonus(creature, [creature, bonesplitter])).toEqual({
      power: 2,
      toughness: 0,
    });
  });

  it('counts auras you control attached to creatures for Sage\'s Reverie', () => {
    const creature = makeCreature();
    const reverie = makeAttachedPerm('reverie_1', creature.id, {
      name: "Sage's Reverie",
      typeLine: 'Enchantment — Aura',
      oracleText:
        'Enchant creature\nEnchanted creature gets +1/+1 for each Aura you control attached to a creature.',
    });
    creature.attachedEquipment.push(reverie.id);
    const battlefield = [
      creature,
      reverie,
      {
        id: 'pac_1',
        controller: 'p1',
        attachedTo: 'creature_1',
        card: { type_line: 'Enchantment — Aura' },
      },
      {
        id: 'pac_2',
        controller: 'p1',
        attachedTo: 'knight_1',
        card: { type_line: 'Enchantment — Aura' },
      },
      {
        id: 'knight_1',
        controller: 'p1',
        card: { type_line: 'Creature — Human Knight' },
      },
      {
        id: 'pac_unattached',
        controller: 'p1',
        card: { type_line: 'Enchantment — Aura' },
      },
      {
        id: 'opp_pac',
        controller: 'p2',
        attachedTo: 'opp_creature',
        card: { type_line: 'Enchantment — Aura' },
      },
      {
        id: 'opp_creature',
        controller: 'p2',
        card: { type_line: 'Creature — Zombie' },
      },
    ];

    expect(calculateEquipmentBonus(creature, battlefield)).toEqual({ power: 3, toughness: 3 });
  });

  it('tracks variable sources in calculateEquipmentBonusWithSources', () => {
    const creature = makeCreature();
    const nettlecyst = makeAttachedPerm('nettle_1', creature.id, {
      name: 'Nettlecyst',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+1 for each artifact and enchantment you control.',
    });
    creature.attachedEquipment.push(nettlecyst.id);
    const battlefield = [
      creature,
      nettlecyst,
      { id: 'rock_1', controller: 'p1', card: { type_line: 'Artifact' } },
    ];

    const result = calculateEquipmentBonusWithSources(creature, battlefield);
    expect(result.power).toBe(2);
    expect(result.toughness).toBe(2);
    expect(result.sources).toEqual([
      { name: 'Nettlecyst', power: 2, toughness: 2, type: 'equipment' },
    ]);
  });

  it('counts creature cards in all graveyards for Bonehoard (+X/+X)', () => {
    const creature = makeCreature();
    const bonehoard = makeAttachedPerm('bone_1', creature.id, {
      name: 'Bonehoard',
      typeLine: 'Artifact — Equipment',
      oracleText:
        'Living weapon\nEquipped creature gets +X/+X, where X is the number of creature cards in all graveyards.\nEquip {2}',
    });
    creature.attachedEquipment.push(bonehoard.id);
    const gameState = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Creature — Zombie' },
            { type_line: 'Instant' },
          ],
        },
        p2: {
          graveyard: [
            { type_line: 'Creature — Elf' },
            { type_line: 'Creature — Goblin' },
          ],
        },
      },
    };

    expect(calculateEquipmentBonus(creature, [creature, bonehoard], gameState)).toEqual({
      power: 3,
      toughness: 3,
    });
  });

  it('counts instants and sorceries in your graveyard for Runechanter\'s Pike (+X/+0)', () => {
    const creature = makeCreature();
    const pike = makeAttachedPerm('pike_1', creature.id, {
      name: "Runechanter's Pike",
      typeLine: 'Artifact — Equipment',
      oracleText:
        "Equipped creature has first strike and gets +X/+0, where X is the number of instant and sorcery cards in your graveyard.\nEquip {2}",
    });
    creature.attachedEquipment.push(pike.id);
    const gameState = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Instant' },
            { type_line: 'Sorcery' },
            { type_line: 'Creature — Human' },
          ],
        },
        p2: {
          graveyard: [{ type_line: 'Instant' }],
        },
      },
    };

    expect(calculateEquipmentBonus(creature, [creature, pike], gameState)).toEqual({
      power: 2,
      toughness: 0,
    });
  });

  it('reads stored reveal count for Trepanation Blade', () => {
    const creature = makeCreature();
    const blade = {
      ...makeAttachedPerm('blade_1', creature.id, {
        name: 'Trepanation Blade',
        typeLine: 'Artifact — Equipment',
        oracleText:
          'Whenever equipped creature attacks, defending player reveals cards from the top of their library until they reveal a land card. The creature gets +1/+0 until end of turn for each card revealed this way. That player puts the revealed cards into their graveyard.',
      }),
      trepanationBonus: 4,
    };
    creature.attachedEquipment.push(blade.id);

    expect(calculateEquipmentBonus(creature, [creature, blade])).toEqual({
      power: 4,
      toughness: 0,
    });
  });

  it('applies Tenza legendary rider from oracle text', () => {
    const creature = {
      ...makeCreature(),
      card: { name: 'Thalia', type_line: 'Legendary Creature — Human Soldier', oracle_text: '' },
    };
    const tenza = makeAttachedPerm('tenza_1', creature.id, {
      name: "Tenza, Godo's Maul",
      typeLine: 'Artifact — Equipment',
      oracleText:
        "Equipped creature gets +1/+1. As long as it's legendary, it gets an additional +2/+2. As long as it's red, it has trample.\nEquip {1}",
    });
    creature.attachedEquipment.push(tenza.id);

    expect(calculateEquipmentBonus(creature, [creature, tenza])).toEqual({
      power: 3,
      toughness: 3,
    });
  });

  it('applies only Tenza base bonus on non-legendary creatures', () => {
    const creature = makeCreature();
    const tenza = makeAttachedPerm('tenza_1', creature.id, {
      name: "Tenza, Godo's Maul",
      typeLine: 'Artifact — Equipment',
      oracleText:
        "Equipped creature gets +1/+1. As long as it's legendary, it gets an additional +2/+2. As long as it's red, it has trample.\nEquip {1}",
    });
    creature.attachedEquipment.push(tenza.id);

    expect(calculateEquipmentBonus(creature, [creature, tenza])).toEqual({
      power: 1,
      toughness: 1,
    });
  });
});

describe('equipped attack reveal-until-land pump detection', () => {
  const trepanationOracle =
    'Whenever equipped creature attacks, defending player reveals cards from the top of their library until they reveal a land card. The creature gets +1/+0 until end of turn for each card revealed this way. That player puts the revealed cards into their graveyard.';

  it('detects reveal-until-land attack pump equipment from oracle text', () => {
    expect(isEquippedAttackRevealUntilLandPump(trepanationOracle)).toBe(true);
    expect(getEquippedAttackRevealPumpPowerPerCard(trepanationOracle)).toBe(1);
  });

  it('rejects equipment without the full attack reveal pattern', () => {
    expect(isEquippedAttackRevealUntilLandPump('Equipped creature gets +2/+2.')).toBe(false);
    expect(
      isEquippedAttackRevealUntilLandPump(
        'Whenever equipped creature attacks, defending player loses 1 life.',
      ),
    ).toBe(false);
  });

  it('applies stored total pump for custom-named reveal equipment', () => {
    const creature = makeCreature();
    const customBlade = {
      ...makeAttachedPerm('blade_custom', creature.id, {
        name: 'Custom Mill Blade',
        typeLine: 'Artifact — Equipment',
        oracleText: trepanationOracle,
      }),
      trepanationBonus: 5,
    };
    creature.attachedEquipment.push(customBlade.id);

    expect(calculateEquipmentBonus(creature, [creature, customBlade])).toEqual({
      power: 5,
      toughness: 0,
    });
  });
});
