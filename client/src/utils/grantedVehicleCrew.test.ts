import { describe, it, expect } from 'vitest';
import { grantedCrewFor } from './grantedVehicleCrew';
import { parseActivatedAbilities } from './activatedAbilityParser-handlers/parseActivatedAbilities';

const vehicle: any = { id: 'v1', controller: 'p1', card: { id: 'v1', name: 'Odd Vehicle', type_line: 'Artifact \u2014 Vehicle', oracle_text: 'Flying' } };
const kotori: any = { id: 'k1', controller: 'p1', card: { id: 'k1', name: 'Kotori, Pilot Prodigy', type_line: 'Legendary Creature', oracle_text: 'Vehicles you control have crew 2.' } };

describe('grantedCrewFor', () => {
  it('prefers rulesStatus.grantedCrew', () => {
    expect(grantedCrewFor({ ...vehicle, rulesStatus: { grantedCrew: { value: 1, sourceName: 'X' } } }, [])).toEqual({ value: 1, sourceName: 'X' });
  });
  it('scans battlefield for same controller only', () => {
    expect(grantedCrewFor(vehicle, [vehicle, kotori])).toEqual({ value: 2, sourceName: 'Kotori, Pilot Prodigy' });
    expect(grantedCrewFor(vehicle, [{ ...kotori, controller: 'p2' }])).toBeNull();
  });
  it('adds a crew ability to a vehicle without printed crew', () => {
    const abs = parseActivatedAbilities(vehicle.card, undefined, { battlefield: [vehicle, kotori], permanent: vehicle });
    const crew = abs.find((a: any) => a.isCrewAbility) as any;
    expect(crew).toBeTruthy();
    expect(crew.label).toBe('Crew 2 (from Kotori, Pilot Prodigy)');
    expect(crew.id).toMatch(/^v1-crew-\d+$/);
    expect(parseActivatedAbilities(vehicle.card, undefined, { battlefield: [vehicle], permanent: vehicle }).some((a: any) => a.isCrewAbility)).toBe(false);
  });
});
