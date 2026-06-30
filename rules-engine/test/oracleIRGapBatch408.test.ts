import { describe, expect, it } from 'vitest';
import { isCurrentlyCreature } from '../src/actions/combat.ts';
import {
  isStationPermanentCreatureNow,
  isStationPermanentTypeLine,
  readStationChargeCreatureThresholdFromOracleText,
} from '../src/stationPermanentUtils.ts';

const KAVARON_STATION_LINE =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery. It's an artifact creature at 12+.)";

describe('oracle IR gap batch408 — station permanent utils', () => {
  it('detects Planet and Spacecraft type lines', () => {
    expect(isStationPermanentTypeLine('Land — Planet')).toBe(true);
    expect(isStationPermanentTypeLine('Artifact — Spacecraft')).toBe(true);
    expect(isStationPermanentTypeLine('Creature — Human')).toBe(false);
  });

  it('reads creature threshold from inline at N+ reminder text', () => {
    expect(readStationChargeCreatureThresholdFromOracleText(KAVARON_STATION_LINE)).toBe(12);
    expect(
      readStationChargeCreatureThresholdFromOracleText(
        'Station\n10+ | Creatures you control have flying.',
      ),
    ).toBe(10);
  });

  it('treats stationed Planet permanents as creatures in combat', () => {
    const oracle = `{T}: Add {G}.\n${KAVARON_STATION_LINE}`;
    const belowThreshold = {
      id: 'planet_1',
      controller: 'p1',
      counters: { charge: 11 },
      card: { name: 'Test Planet', type_line: 'Land — Planet', oracle_text: oracle },
    };
    const stationed = {
      ...belowThreshold,
      counters: { charge: 12 },
      stationed: true,
      grantedTypes: ['Creature'],
    };

    expect(isStationPermanentCreatureNow(belowThreshold, oracle)).toBe(false);
    expect(isStationPermanentCreatureNow(stationed, oracle)).toBe(true);
    expect(isCurrentlyCreature(stationed)).toBe(true);
    expect(isCurrentlyCreature(belowThreshold)).toBe(false);
  });
});
