import { describe, expect, it } from 'vitest';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { hasExecutorClass, isExecutorCreature } from '../src/oracleIRExecutorPermanentUtils';

function createPermanent(overrides: Partial<BattlefieldPermanent> = {}): BattlefieldPermanent {
  return {
    id: 'perm-1',
    controller: 'p1' as any,
    owner: 'p1' as any,
    card: {
      id: 'card-1',
      name: 'Test Permanent',
      type_line: 'Artifact',
      oracle_text: '',
    } as KnownCardRef,
    ...overrides,
  } as BattlefieldPermanent;
}

describe('oracleIRExecutorPermanentUtils', () => {
  it('treats cardType-only creature fixtures as creatures', () => {
    const creatureWithoutTypeLine = createPermanent({
      cardType: 'Creature' as any,
      card: {
        id: 'card-1',
        name: 'Fixture Bear',
        type_line: '',
        oracle_text: '',
      } as KnownCardRef,
    });

    expect(isExecutorCreature(creatureWithoutTypeLine)).toBe(true);
    expect(hasExecutorClass(creatureWithoutTypeLine, 'creature')).toBe(true);
    expect(hasExecutorClass(creatureWithoutTypeLine, 'permanent')).toBe(true);
  });

  it('treats animated noncreatures as creatures', () => {
    const animatedArtifact = createPermanent({
      effectiveTypes: ['Artifact', 'Creature'] as any,
      card: {
        id: 'card-1',
        name: 'Animated Relic',
        type_line: 'Artifact',
        oracle_text: '',
      } as KnownCardRef,
    });

    expect(isExecutorCreature(animatedArtifact)).toBe(true);
    expect(hasExecutorClass(animatedArtifact, 'creature')).toBe(true);
    expect(hasExecutorClass(animatedArtifact, 'artifact')).toBe(true);
  });

  it('does not treat removed creature types as creatures', () => {
    const moonedCreature = createPermanent({
      effectiveTypes: ['Land'] as any,
      card: {
        id: 'card-1',
        name: 'Moon-Bound Bear',
        type_line: 'Creature — Bear',
        oracle_text: '',
      } as KnownCardRef,
    });

    expect(isExecutorCreature(moonedCreature)).toBe(false);
    expect(hasExecutorClass(moonedCreature, 'creature')).toBe(false);
    expect(hasExecutorClass(moonedCreature, 'land')).toBe(true);
  });

  it('still supports subtype-style executor checks', () => {
    const vehicle = createPermanent({
      card: {
        id: 'card-1',
        name: 'Test Vehicle',
        type_line: 'Artifact — Vehicle',
        oracle_text: '',
      } as KnownCardRef,
    });

    expect(hasExecutorClass(vehicle, 'vehicle')).toBe(true);
  });

  it('treats supertypes as part of merged executor type text', () => {
    const legendaryCreature = createPermanent({
      supertypes: ['Legendary'] as any,
      effectiveTypes: ['Creature'] as any,
      card: {
        id: 'card-1',
        name: 'Crowned Bear',
        type_line: '',
        oracle_text: '',
      } as KnownCardRef,
    });

    expect(hasExecutorClass(legendaryCreature, 'legendary')).toBe(true);
    expect(hasExecutorClass(legendaryCreature, 'creature')).toBe(true);
  });

  it('treats subtypes as part of merged executor type text', () => {
    const subtypeOnlyLand = createPermanent({
      effectiveTypes: ['Land'] as any,
      subtypes: ['Forest', 'Island'] as any,
      card: {
        id: 'card-1',
        name: 'Subtype Land',
        type_line: '',
        oracle_text: '',
      } as KnownCardRef,
    });

    expect(hasExecutorClass(subtypeOnlyLand, 'land')).toBe(true);
    expect(hasExecutorClass(subtypeOnlyLand, 'forest')).toBe(true);
    expect(hasExecutorClass(subtypeOnlyLand, 'island')).toBe(true);
  });
});