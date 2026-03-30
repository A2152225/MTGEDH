import { describe, expect, it } from 'vitest';
import {
  createEndureResult,
  createForageResult,
  createHarnessResult,
  createSuspectResult,
  endureWithToken,
  forageBySacrificing,
  harness,
  suspect,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 19 (remaining Part 8 result summaries)', () => {
  describe('Rule 701.60: Suspect', () => {
    it('should summarize the suspected designation and its blocking restrictions', () => {
      expect(createSuspectResult(suspect('creature-1', 'p1'), false)).toEqual({
        creatureId: 'creature-1',
        playerId: 'p1',
        becameSuspected: true,
        grantsMenace: true,
        cantBlock: true,
      });
    });
  });

  describe('Rule 701.61: Forage', () => {
    it('should summarize which forage branch paid the cost', () => {
      expect(createForageResult(forageBySacrificing('p1', 'food-1'))).toEqual({
        playerId: 'p1',
        method: 'sacrifice',
        paidCost: true,
        exiledCardCount: 0,
        sacrificedFood: 'food-1',
      });
    });
  });

  describe('Rule 701.63: Endure', () => {
    it('should summarize whether endure creates a Spirit token or adds counters', () => {
      expect(createEndureResult(endureWithToken('perm-1', 'p1', 4, 'spirit-1'))).toEqual({
        permanentId: 'perm-1',
        controllerId: 'p1',
        value: 4,
        addsCounters: false,
        createsSpiritToken: true,
        tokenId: 'spirit-1',
      });
    });
  });

  describe('Rule 701.64: Harness', () => {
    it('should summarize whether the permanent newly became harnessed', () => {
      expect(createHarnessResult(harness('artifact-1'), false)).toEqual({
        permanentId: 'artifact-1',
        becameHarnessed: true,
        alreadyHarnessed: false,
      });
    });
  });
});