import { describe, expect, it } from 'vitest';

import {
  filterOracleTextToActiveStationAbilities,
  parseStationAbilities,
  getActiveStationAbilities,
  readChargeCounterCount,
} from '../src/utils/stationParser.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-detection.js';
import { getSpellCastTriggers } from '../src/state/modules/triggers/spell-cast-get-triggers.js';

const TYPE_03_ORACLE =
  "Artifact spells you cast cost {1} less to cast.\n" +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 7+.)\n" +
  "7+ | Flying\n" +
  "Whenever you cast a spell, create a 1/1 colorless Borg artifact creature token.";

describe('Station threshold cast triggers (Type-03 Borg Vessel)', () => {
  it('parses the cast-trigger under the 7+ station gate', () => {
    const parsed = parseStationAbilities(TYPE_03_ORACLE);
    expect(getActiveStationAbilities(0, parsed).join('\n')).not.toMatch(/whenever you cast a spell/i);
    expect(getActiveStationAbilities(7, parsed).join('\n')).toMatch(/whenever you cast a spell/i);
    expect(filterOracleTextToActiveStationAbilities(TYPE_03_ORACLE, 0)).not.toMatch(/whenever you cast a spell/i);
    expect(filterOracleTextToActiveStationAbilities(TYPE_03_ORACLE, 7)).toMatch(/whenever you cast a spell/i);
  });

  it('does not detect the cast trigger at 0 charge counters', () => {
    const permanent = {
      id: 'vessel_1',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Type-03 Borg Vessel',
        type_line: 'Artifact — Spacecraft',
        oracle_text: TYPE_03_ORACLE,
      },
    };
    expect(readChargeCounterCount(permanent)).toBe(0);
    expect(detectSpellCastTriggers(permanent.card, permanent, { battlefield: [permanent] })).toEqual([]);
  });

  it('detects the cast trigger once stationed to 7+', () => {
    const permanent = {
      id: 'vessel_1',
      controller: 'p1',
      counters: { charge: 7 },
      card: {
        name: 'Type-03 Borg Vessel',
        type_line: 'Artifact — Spacecraft',
        oracle_text: TYPE_03_ORACLE,
      },
    };
    const triggers = detectSpellCastTriggers(permanent.card, permanent, { battlefield: [permanent] });
    expect(triggers.some((t) => /borg artifact creature token/i.test(String(t.effect || t.description || '')))).toBe(true);
  });

  it('getSpellCastTriggers skips unstationed vessel on any spell cast', () => {
    const permanent = {
      id: 'vessel_1',
      controller: 'p1',
      counters: {},
      card: {
        name: 'Type-03 Borg Vessel',
        type_line: 'Artifact — Spacecraft',
        oracle_text: TYPE_03_ORACLE,
      },
    };
    const ctx = {
      state: {
        battlefield: [permanent],
        spellsCastThisTurn: [],
      },
    } as any;
    const spell = { name: 'Battle of Wolf 359', type_line: 'Sorcery', colors: [] };
    expect(getSpellCastTriggers(ctx, 'p1', spell)).toEqual([]);
  });
});
