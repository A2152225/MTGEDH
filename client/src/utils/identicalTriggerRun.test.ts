import { describe, expect, it } from 'vitest';
import { countIdenticalTopTriggerRun } from './identicalTriggerRun';

const crusade = { type: 'triggered_ability', controller: 'p1', source: 'c', sourceName: "Cathars' Crusade", mandatory: true, description: 'put a +1/+1 counter on each creature you control.' };

describe('countIdenticalTopTriggerRun', () => {
  it('counts the identical run on top only', () => {
    const other = { ...crusade, source: 'w', sourceName: 'Soul Warden', description: 'you gain 1 life.' };
    expect(countIdenticalTopTriggerRun([crusade, other, crusade, crusade, crusade])).toBe(3);
    expect(countIdenticalTopTriggerRun([crusade, other])).toBe(1);
    expect(countIdenticalTopTriggerRun([])).toBe(0);
  });
  it('excludes targeted and optional triggers', () => {
    expect(countIdenticalTopTriggerRun([{ ...crusade, targets: ['x'] }, { ...crusade, targets: ['x'] }])).toBe(0);
    expect(countIdenticalTopTriggerRun([{ ...crusade, description: 'you may draw a card.' }])).toBe(0);
  });
});
