import { describe, expect, it } from 'vitest';
import {
  addGoad,
  calculateDoubledStat,
  calculateTripledStat,
  canFight,
  createDoubleResult,
  createExchangeResult,
  createFightResult,
  createGoadResult,
  createInvestigateResult,
  createMillSummary,
  createTripleResult,
  doubleDamage,
  doubleLifeTotal,
  doublePowerToughness,
  exchangeControl,
  exchangeZones,
  fightCreatures,
  fightSelf,
  FIGHT_DAMAGE_IS_NOT_COMBAT,
  getDoubledValue,
  getGoadRestrictionCount,
  getInvestigateCount,
  getTripledValue,
  goadCreature,
  investigate,
  isDamageDoubling,
  isSelfFight,
  isZoneExchange,
  millCards,
  parseMillFromOracleText,
  triplePowerToughness,
  willMillEntireLibrary,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 13 (part-2 focused action summaries)', () => {
  describe('Rule 701.10: Double', () => {
    it('should summarize doubled totals and distinguish damage replacement effects', () => {
      expect(getDoubledValue(4)).toBe(8);
      expect(calculateDoubledStat(-3)).toBe(-3);
      expect(isDamageDoubling(doubleDamage('source-1'))).toBe(true);
      expect(createDoubleResult(doubleLifeTotal('p1'), 12)).toEqual({
        targetId: 'p1',
        targetType: 'life',
        originalValue: 12,
        resultingValue: 24,
        delta: 12,
        usesReplacementEffect: false,
      });
    });
  });

  describe('Rule 701.11: Triple', () => {
    it('should summarize tripled totals for ordinary and negative values', () => {
      expect(getTripledValue(5)).toBe(15);
      expect(calculateTripledStat(-3)).toBe(-6);
      expect(createTripleResult(triplePowerToughness('creature-1', 'power'), 5)).toEqual({
        targetId: 'creature-1',
        targetType: 'power',
        originalValue: 5,
        resultingValue: 15,
        delta: 10,
      });
    });
  });

  describe('Rule 701.12: Exchange', () => {
    it('should summarize completed exchanges and identify zone-based exchanges', () => {
      expect(isZoneExchange(exchangeZones('hand', 'exile'))).toBe(true);
      expect(createExchangeResult(exchangeControl('perm-1', 'perm-2'), { id: 'perm-1' }, { id: 'perm-2' })).toEqual({
        exchangeType: 'control',
        targetA: 'perm-1',
        targetB: 'perm-2',
        completed: true,
        allOrNothing: true,
      });
    });
  });

  describe('Rule 701.14: Fight', () => {
    it('should summarize legal fights and self-fights as noncombat damage', () => {
      expect(canFight({ onBattlefield: true, isCreature: true }, { onBattlefield: true, isCreature: true })).toBe(true);
      expect(isSelfFight(fightSelf('creature-1'))).toBe(true);
      expect(createFightResult(fightCreatures('creature-1', 'creature-2'), true)).toEqual({
        creatureA: 'creature-1',
        creatureB: 'creature-2',
        legal: true,
        selfFight: false,
        isCombatDamage: false,
      });
      expect(FIGHT_DAMAGE_IS_NOT_COMBAT).toBe(true);
    });
  });

  describe('Rule 701.15: Goad', () => {
    it('should summarize attack requirements and repeated-source goad state', () => {
      const state = addGoad({
        creatureId: 'creature-1',
        goadedBy: new Set(['p2']),
        expiresOnTurnOf: new Map([['p2', 5]]),
      }, 'p3', 7);

      expect(getGoadRestrictionCount(state)).toBe(2);
      expect(createGoadResult(goadCreature('creature-1', 'p2'), state)).toEqual({
        creatureId: 'creature-1',
        goaderId: 'p2',
        goaderCount: 2,
        mustAttack: true,
        canAttackGoader: false,
        alreadyGoadedBySource: true,
      });
    });
  });

  describe('Rule 701.16: Investigate', () => {
    it('should summarize the number of Clue tokens investigated into existence', () => {
      const action = investigate('p1', 3);

      expect(getInvestigateCount(action)).toBe(3);
      expect(createInvestigateResult(action)).toEqual({
        playerId: 'p1',
        clueCount: 3,
        tokenName: 'Clue',
        tokenSubtype: 'Clue',
        hasSacrificeDrawAbility: true,
      });
    });
  });

  describe('Rule 701.17: Mill', () => {
    it('should summarize actual mill counts and whether the milled cards remain findable', () => {
      expect(willMillEntireLibrary(5, 7)).toBe(true);
      expect(createMillSummary(millCards('p1', 7), 5)).toEqual({
        playerId: 'p1',
        requestedCount: 7,
        actualCount: 5,
        destinationZone: 'graveyard',
        canFindMilledCards: true,
      });
    });

    it('should still parse target-player mill text into a concrete mill effect', () => {
      expect(parseMillFromOracleText('Target player mills three cards.')).toEqual({
        type: 'mill',
        count: 3,
        targetType: 'player',
        requiresTarget: true,
      });
    });
  });
});