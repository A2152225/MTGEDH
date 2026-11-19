import { describe, expect, it } from 'vitest';

import { requestCastSpellGrantsFlash } from '../src/socket/requestCastSpellTimingGate.js';
import {
  activePlaneReplacesSorceryWithInstant,
  sorceryNotOnStackCastsAsInstant,
} from '../src/state/modules/sorceryAsInstantTextChange.js';

const plane = {
  name: 'Deceptive Divination',
  type_line: 'Plane — Secret Lair',
  oracle_text:
    'Change the text of each sorcery spell and sorcery card not on the stack by replacing "sorcery" with "instant."\nWhenever chaos ensues, choose two target players.',
};

describe('sorcery cards become instants while the plane is face up', () => {
  const state = { activePlane: plane, currentPlane: plane };

  it('recognizes the printed replacement and applies it to a sorcery face', () => {
    expect(activePlaneReplacesSorceryWithInstant(state)).toBe(true);
    expect(sorceryNotOnStackCastsAsInstant(state, { type_line: 'Sorcery' })).toBe(true);
    expect(sorceryNotOnStackCastsAsInstant(state, { type_line: 'Kindred Sorcery' })).toBe(true);
    expect(sorceryNotOnStackCastsAsInstant(state, { type_line: 'Sorcery — Adventure' })).toBe(true);
  });

  it('does not turn permanents or an absent plane into instants', () => {
    expect(sorceryNotOnStackCastsAsInstant(state, { type_line: 'Creature — Human Wizard' })).toBe(false);
    expect(sorceryNotOnStackCastsAsInstant(state, { type_line: 'Creature — Human // Sorcery — Adventure' })).toBe(false);
    expect(sorceryNotOnStackCastsAsInstant({}, { type_line: 'Sorcery' })).toBe(false);
  });

  it('lets the cast request treat that sorcery as instant timing', () => {
    expect(requestCastSpellGrantsFlash({
      typeLine: 'sorcery',
      sorceryCastsAsInstant: sorceryNotOnStackCastsAsInstant(state, { type_line: 'Sorcery' }),
    })).toBe(true);
    expect(requestCastSpellGrantsFlash({ typeLine: 'sorcery' })).toBe(false);
  });
});
