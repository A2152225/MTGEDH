import { describe, it, expect } from 'vitest';
import { computePermanentRulesStatus } from '../src/state/modules/viewPermanentRulesStatus.js';
import { computeGrantedCrew } from '../src/state/modules/viewPermanentCharacteristics.js';

const vehicle: any = { id: 'v1', controller: 'p1', card: { id: 'v1', name: 'Odd Vehicle', type_line: 'Artifact \u2014 Vehicle', oracle_text: 'Flying' } };
const kotori: any = { id: 'k1', controller: 'p1', card: { id: 'k1', name: 'Kotori, Pilot Prodigy', type_line: 'Legendary Creature', oracle_text: 'Vehicles you control have crew 2.' } };

describe('view granted crew', () => {
  it('reports crew granted by another permanent', () => {
    const state: any = { battlefield: [vehicle, kotori], players: [{ id: 'p1' }] };
    expect(computeGrantedCrew(vehicle, state)).toEqual({ value: 2, sourceName: 'Kotori, Pilot Prodigy' });
    expect((computePermanentRulesStatus(vehicle, state) as any)?.grantedCrew?.value).toBe(2);
  });
  it('returns null without a grant', () => {
    expect(computeGrantedCrew(vehicle, { battlefield: [vehicle], players: [] } as any)).toBeUndefined();
  });
});
