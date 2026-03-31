import { describe, it, expect } from 'vitest';
import { parseActivatedAbilities } from '../src/utils/activatedAbilityParser';
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