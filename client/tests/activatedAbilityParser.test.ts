import { describe, it, expect } from 'vitest';
import { getConditionalManaAbilityStatus, parseActivatedAbilities } from '../src/utils/activatedAbilityParser';
import type { KnownCardRef } from '../../shared/src';

describe('parseActivatedAbilities station parsing', () => {
  it('parses Station when the threshold is on the next line', () => {
    const card: KnownCardRef = {
      id: 'station-card-1',
      name: 'Squadron Carrier',
      type_line: 'Artifact — Spacecraft',
      oracle_text: 'Spacecraft you control have "Exhaust — {W}: Conjure a card named Starfighter Pilot onto the battlefield."\nStation\n10+ | Creatures you control have flying.',
    };

    const abilities = parseActivatedAbilities(card);
    const stationAbility = abilities.find((ability) => ability.isStationAbility);

    expect(stationAbility).toBeDefined();
    expect(stationAbility?.label).toBe('Station 10');
    expect(stationAbility?.stationThreshold).toBe(10);
  });

  it('parses text-only sacrifice activations as generic abilities', () => {
    const card: KnownCardRef = {
      id: 'sphere-card-1',
      name: "Commander's Sphere",
      type_line: 'Artifact',
      oracle_text: "{T}: Add one mana of any color in your commander's color identity.\nSacrifice Commander's Sphere: Draw a card.",
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(2);
    expect(abilities[0]?.id).toBe('sphere-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.isManaAbility).toBe(true);
    expect(abilities[1]?.id).toBe('sphere-card-1-ability-1');
    expect(abilities[1]?.cost).toBe("Sacrifice Commander's Sphere");
    expect(abilities[1]?.effect).toBe('Draw a card.');
    expect(abilities[1]?.requiresSacrifice).toBe(true);
    expect(abilities[1]?.isManaAbility).toBe(false);
  });

  it('parses Arcane Signet as a single mana ability without a duplicate synthetic entry', () => {
    const card: KnownCardRef = {
      id: 'signet-card-1',
      name: 'Arcane Signet',
      type_line: 'Artifact',
      oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('signet-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.effect).toBe("Add one mana of any color in your commander's color identity.");
    expect(abilities[0]?.isManaAbility).toBe(true);
  });

  it('marks Mox Amber mana activation unavailable without a colored legendary creature or planeswalker', () => {
    const card: KnownCardRef = {
      id: 'mox-amber-card-1',
      name: 'Mox Amber',
      type_line: 'Legendary Artifact',
      oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
    };

    const abilities = parseActivatedAbilities(card);
    expect(abilities).toHaveLength(1);

    const status = getConditionalManaAbilityStatus(
      abilities[0],
      {
        id: 'mox-amber-perm-1',
        controller: 'player1',
        owner: 'player1',
        card,
      },
      [
        {
          id: 'mox-amber-perm-1',
          controller: 'player1',
          owner: 'player1',
          card,
        },
        {
          id: 'bear-perm-1',
          controller: 'player1',
          owner: 'player1',
          card: {
            id: 'bear-card-1',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
            colors: ['G'],
          },
        },
      ],
    );

    expect(status).toEqual({
      canActivate: false,
      reason: 'Needs a colored legendary creature or planeswalker',
    });
  });

  it('marks Mox Amber mana activation available when a qualifying legend provides a color', () => {
    const card: KnownCardRef = {
      id: 'mox-amber-card-1',
      name: 'Mox Amber',
      type_line: 'Legendary Artifact',
      oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
    };

    const abilities = parseActivatedAbilities(card);
    const status = getConditionalManaAbilityStatus(
      abilities[0],
      {
        id: 'mox-amber-perm-1',
        controller: 'player1',
        owner: 'player1',
        card,
      },
      [
        {
          id: 'mox-amber-perm-1',
          controller: 'player1',
          owner: 'player1',
          card,
        },
        {
          id: 'legend-perm-1',
          controller: 'player1',
          owner: 'player1',
          card: {
            id: 'legend-card-1',
            name: 'Yoshimaru, Ever Faithful',
            type_line: 'Legendary Creature — Dog',
            oracle_text: '',
            colors: ['W'],
          },
        },
      ],
    );

    expect(status).toEqual({ canActivate: true });
  });

  it('parses Cryptolith Rite granted mana text on the creature receiving it', () => {
    const card: KnownCardRef = {
      id: 'bear-card-1',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
    };

    const abilities = parseActivatedAbilities(card, ['tap_for_any_color']);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('native_any');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.effect).toBe('Add one mana of any color');
    expect(abilities[0]?.isManaAbility).toBe(true);
  });

  it('does not treat Cryptolith Rite itself as having the granted tap ability', () => {
    const card: KnownCardRef = {
      id: 'cryptolith-card-1',
      name: 'Cryptolith Rite',
      type_line: 'Enchantment',
      oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(0);
  });

  it('parses quoted granted mana abilities from battlefield effects', () => {
    const card: KnownCardRef = {
      id: 'elf-card-1',
      name: 'Llanowar Scout',
      type_line: 'Creature — Elf Scout',
      oracle_text: '',
    };

    const abilities = parseActivatedAbilities(card, ['"{T}: Add {G}."']);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('native_g');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.effect).toBe('Add {G}');
    expect(abilities[0]?.isManaAbility).toBe(true);
  });

  it('parses Luxury Suite mana text as a mana ability', () => {
    const card: KnownCardRef = {
      id: 'suite-card-1',
      name: 'Luxury Suite',
      type_line: 'Land',
      oracle_text: 'Luxury Suite enters the battlefield tapped unless you have two or more opponents.\n{T}: Add {B} or {R}.',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('suite-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.effect).toBe('Add {B} or {R}.');
    expect(abilities[0]?.isManaAbility).toBe(true);
  });

  it('prefers explicit basic-land mana text over a synthetic type-based entry', () => {
    const card: KnownCardRef = {
      id: 'forest-card-1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('forest-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.effect).toBe('Add {G}.');
    expect(abilities[0]?.isManaAbility).toBe(true);
  });

  it('keeps Myriad Landscape abilities aligned with server scoped ability indexes', () => {
    const card: KnownCardRef = {
      id: 'myriad-card-1',
      name: 'Myriad Landscape',
      type_line: 'Land',
      oracle_text: '{T}: Add {C}.\n{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(2);
    expect(abilities[0]?.id).toBe('myriad-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('{T}');
    expect(abilities[0]?.isManaAbility).toBe(true);
    expect(abilities[0]?.isFetchAbility).toBe(false);
    expect(abilities[1]?.id).toBe('myriad-card-1-ability-1');
    expect(abilities[1]?.cost).toBe('{2}, {T}, Sacrifice Myriad Landscape');
    expect(abilities[1]?.isManaAbility).toBe(false);
    expect(abilities[1]?.isFetchAbility).toBe(true);
  });

  it('parses Evendo threshold mana ability alongside Station', () => {
    const card: KnownCardRef = {
      id: 'evendo-card-1',
      name: 'Evendo, Waking Haven',
      type_line: 'Land',
      oracle_text: 'Evendo, Waking Haven enters tapped.\n{T}: Add {G}.\nStation\n12+ | {G}, {T}: Add {G} for each creature you control.',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(3);
    expect(abilities[0]?.id).toBe('evendo-card-1-ability-0');
    expect(abilities[0]?.isManaAbility).toBe(true);
    expect(abilities[1]?.id).toBe('evendo-card-1-ability-1');
    expect(abilities[1]?.cost).toBe('{G}, {T}');
    expect(abilities[1]?.effect).toBe('Add {G} for each creature you control.');
    expect(abilities[1]?.isManaAbility).toBe(true);
    expect(abilities[1]?.stationThreshold).toBe(12);
    expect(abilities[2]?.id).toBe('evendo-card-1-station-2');
    expect(abilities[2]?.isStationAbility).toBe(true);
  });

  it('parses pay-life activations as generic abilities with a life cost', () => {
    const card: KnownCardRef = {
      id: 'greed-card-1',
      name: 'Greed',
      type_line: 'Enchantment',
      oracle_text: 'Pay 2 life: Draw a card.',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('greed-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('Pay 2 life');
    expect(abilities[0]?.effect).toBe('Draw a card.');
    expect(abilities[0]?.lifeCost).toBe(2);
    expect(abilities[0]?.isManaAbility).toBe(false);
  });

  it('parses discard and exile-from-hand text-only activations as generic abilities', () => {
    const discardCard: KnownCardRef = {
      id: 'looter-card-1',
      name: 'Test Looter',
      type_line: 'Artifact',
      oracle_text: 'Discard a card: Draw a card.',
    };

    const exileCard: KnownCardRef = {
      id: 'relic-card-1',
      name: 'Test Relic',
      type_line: 'Artifact',
      oracle_text: 'Exile a card from your hand: Draw a card.',
    };

    const discardAbilities = parseActivatedAbilities(discardCard);
    const exileAbilities = parseActivatedAbilities(exileCard);

    expect(discardAbilities).toHaveLength(1);
    expect(discardAbilities[0]?.id).toBe('looter-card-1-ability-0');
    expect(discardAbilities[0]?.cost).toBe('Discard a card');
    expect(discardAbilities[0]?.effect).toBe('Draw a card.');

    expect(exileAbilities).toHaveLength(1);
    expect(exileAbilities[0]?.id).toBe('relic-card-1-ability-0');
    expect(exileAbilities[0]?.cost).toBe('Exile a card from your hand');
    expect(exileAbilities[0]?.effect).toBe('Draw a card.');
  });

  it('parses mixed pay-life plus discard text-cost activations as one generic ability', () => {
    const card: KnownCardRef = {
      id: 'hybrid-cost-card-1',
      name: 'Test Engine',
      type_line: 'Artifact',
      oracle_text: 'Pay 2 life, Discard a card: Draw a card.',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('hybrid-cost-card-1-ability-0');
    expect(abilities[0]?.cost).toBe('Pay 2 life, Discard a card');
    expect(abilities[0]?.effect).toBe('Draw a card.');
    expect(abilities[0]?.lifeCost).toBe(2);
    expect(abilities[0]?.otherCosts).toContain('Discard a card');
    expect(abilities[0]?.isManaAbility).toBe(false);
  });

  it('parses cycling abilities with parser-emitted cycling ids', () => {
    const card: KnownCardRef = {
      id: 'cycler-card-1',
      name: 'Test Cycler',
      type_line: 'Creature - Beast',
      oracle_text: 'Cycling {2}',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('cycler-card-1-cycling-0');
    expect(abilities[0]?.manaCost).toBe('{2}');
    expect(abilities[0]?.effect).toBe('Discard this card, then draw a card');
  });

  it('parses basic landcycling as a cycling-routed library search ability', () => {
    const card: KnownCardRef = {
      id: 'landcycler-card-1',
      name: 'Test Landcycler',
      type_line: 'Creature - Wurm',
      oracle_text: 'Basic landcycling {2}',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('landcycler-card-1-cycling-0');
    expect(abilities[0]?.label).toBe('Basic Landcycling {2}');
    expect(abilities[0]?.effect).toBe('Discard this card, then search your library for a Basic Land card');
  });

  it('parses wizardcycling as a creature-type library search ability', () => {
    const card: KnownCardRef = {
      id: 'wizardcycler-card-1',
      name: 'Test Wizardcycler',
      type_line: 'Creature - Horror',
      oracle_text: 'Wizardcycling {3}',
    };

    const abilities = parseActivatedAbilities(card);

    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.id).toBe('wizardcycler-card-1-cycling-0');
    expect(abilities[0]?.label).toBe('Wizardcycling {3}');
    expect(abilities[0]?.effect).toBe('Discard this card, then search your library for a Wizard creature card');
  });

  it('keeps ordinary braced battlefield activations on generic -ability- ids', () => {
    const cards: KnownCardRef[] = [
      {
        id: 'draw-card-1',
        name: 'Draw Device',
        type_line: 'Artifact',
        oracle_text: '{2}, {T}: Draw a card.',
      },
      {
        id: 'damage-card-1',
        name: 'Damage Device',
        type_line: 'Artifact',
        oracle_text: '{2}, {T}: Deal 1 damage to any target.',
      },
      {
        id: 'search-card-1',
        name: 'Search Device',
        type_line: 'Artifact',
        oracle_text: '{2}, {T}: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      },
      {
        id: 'counter-card-1',
        name: 'Counter Device',
        type_line: 'Artifact',
        oracle_text: '{2}, {T}: Put a +1/+1 counter on target creature.',
      },
    ];

    for (const card of cards) {
      const abilities = parseActivatedAbilities(card);
      expect(abilities).toHaveLength(1);
      expect(abilities[0]?.id).toBe(`${card.id}-ability-0`);
    }
  });
});