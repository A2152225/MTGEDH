import { describe, expect, it } from 'vitest';
import { deriveSelfEntryCountersFromOracleIR } from '../src/oracleIRSelfEntryCounters';

const GRENZO_ORACLE =
  'Grenzo enters with X +1/+1 counters on it.\n{2}: Put the bottom card of your library into your graveyard. If it\'s a creature card with power less than or equal to Grenzo\'s power, put it onto the battlefield.';

describe('deriveSelfEntryCountersFromOracleIR', () => {
  it('resolves Grenzo X-cost +1/+1 counters from the chosen X', () => {
    expect(
      deriveSelfEntryCountersFromOracleIR({
        oracleText: GRENZO_ORACLE,
        cardName: 'Grenzo, Dungeon Warden',
        xValue: 4,
      })
    ).toEqual({ '+1/+1': 4 });
  });

  it('resolves Magma Pummeler-style this-creature X counters', () => {
    expect(
      deriveSelfEntryCountersFromOracleIR({
        oracleText: 'This creature enters with X +1/+1 counters on it.',
        cardName: 'Magma Pummeler',
        xValue: 3,
      })
    ).toEqual({ '+1/+1': 3 });
  });

  it('applies kicked self-entry counters only when the spell was kicked', () => {
    const oracle =
      'Kicker {3} (You may pay an additional {3} as you cast this spell.)\nIf this creature was kicked, it enters with two +1/+1 counters on it.';
    expect(
      deriveSelfEntryCountersFromOracleIR({
        oracleText: oracle,
        cardName: 'Kicked Illusion Probe',
        wasKicked: true,
      })
    ).toEqual({ '+1/+1': 2 });
    expect(
      deriveSelfEntryCountersFromOracleIR({
        oracleText: oracle,
        cardName: 'Kicked Illusion Probe',
        wasKicked: false,
      })
    ).toBeUndefined();
  });

  it('does not treat other-creature entry bonuses as self-entry counters', () => {
    expect(
      deriveSelfEntryCountersFromOracleIR({
        oracleText:
          'As Metallic Mimic enters, choose a creature type.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.',
        cardName: 'Metallic Mimic',
        xValue: 3,
      })
    ).toBeUndefined();
  });
});
