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
});