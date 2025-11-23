/**
 * Tests for Rule 701: Keyword Actions (Part 2)
 * 
 * Tests keyword actions from Rule 701.10 through 701.17:
 * - Double, Triple, Exchange, Exile, Fight, Goad, Investigate, Mill
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 701.10: Double
  doublePowerToughness,
  doubleLifeTotal,
  doubleCounters,
  doubleMana,
  doubleDamage,
  calculateDoubledStat,
  
  // Rule 701.11: Triple
  triplePowerToughness,
  calculateTripledStat,
  
  // Rule 701.12: Exchange
  exchangeControl,
  exchangeLifeTotals,
  exchangeZones,
  exchangeNumericalValues,
  exchangeTextBoxes,
  canCompleteExchange,
  
  // Rule 701.13: Exile
  exileObject,
  
  // Rule 701.14: Fight
  fightCreatures,
  fightSelf,
  canFight,
  FIGHT_DAMAGE_IS_NOT_COMBAT,
  
  // Rule 701.15: Goad
  goadCreature,
  mustAttackIfGoaded,
  canAttackGoader,
  addGoad,
  isAlreadyGoadedBy,
  GoadedState,
  
  // Rule 701.16: Investigate
  investigate,
  CLUE_TOKEN_CHARACTERISTICS,
  
  // Rule 701.17: Mill
  millCards,
  canMillCount,
  getActualMillCount,
  canFindMilledCard,
  createMillResult,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 2', () => {
  describe('Rule 701.10: Double', () => {
    it('should double power and/or toughness', () => {
      const doublePower = doublePowerToughness('creature1', 'power');
      const doubleToughness = doublePowerToughness('creature2', 'toughness');
      const doubleBoth = doublePowerToughness('creature3', 'power-toughness');
      
      expect(doublePower.type).toBe('double');
      expect(doublePower.targetType).toBe('power');
      expect(doubleToughness.targetType).toBe('toughness');
      expect(doubleBoth.targetType).toBe('power-toughness');
    });
    
    it('should handle negative values when doubling (Rule 701.10c)', () => {
      expect(calculateDoubledStat(5)).toBe(5);
      expect(calculateDoubledStat(-3)).toBe(-3);
      expect(calculateDoubledStat(0)).toBe(0);
    });
    
    it('should double life total (Rule 701.10d)', () => {
      const action = doubleLifeTotal('player1');
      
      expect(action.type).toBe('double');
      expect(action.targetType).toBe('life');
    });
    
    it('should double counters (Rule 701.10e)', () => {
      const action = doubleCounters('permanent1', '+1/+1');
      
      expect(action.type).toBe('double');
      expect(action.targetType).toBe('counters');
      expect(action.counterType).toBe('+1/+1');
    });
    
    it('should double mana (Rule 701.10f)', () => {
      const action = doubleMana('player1', 'red');
      
      expect(action.type).toBe('double');
      expect(action.targetType).toBe('mana');
      expect(action.manaType).toBe('red');
    });
    
    it('should double damage (Rule 701.10g - replacement effect)', () => {
      const action = doubleDamage('source1');
      
      expect(action.type).toBe('double');
      expect(action.targetType).toBe('damage');
    });
  });
  
  describe('Rule 701.11: Triple', () => {
    it('should triple power and/or toughness', () => {
      const triplePower = triplePowerToughness('creature1', 'power');
      const tripleToughness = triplePowerToughness('creature2', 'toughness');
      const tripleBoth = triplePowerToughness('creature3', 'power-toughness');
      
      expect(triplePower.type).toBe('triple');
      expect(triplePower.targetType).toBe('power');
      expect(tripleToughness.targetType).toBe('toughness');
      expect(tripleBoth.targetType).toBe('power-toughness');
    });
    
    it('should calculate tripled stat correctly (Rule 701.11b)', () => {
      expect(calculateTripledStat(5)).toBe(10); // Gets +10/+0 for total of 15
      expect(calculateTripledStat(3)).toBe(6);  // Gets +6/+0 for total of 9
    });
    
    it('should handle negative values when tripling (Rule 701.11c)', () => {
      expect(calculateTripledStat(-3)).toBe(-6); // Gets -6/-0
    });
  });
  
  describe('Rule 701.12: Exchange', () => {
    it('should exchange control of permanents (Rule 701.12b)', () => {
      const action = exchangeControl('permanent1', 'permanent2');
      
      expect(action.type).toBe('exchange');
      expect(action.exchangeType).toBe('control');
    });
    
    it('should exchange life totals (Rule 701.12c)', () => {
      const action = exchangeLifeTotals('player1', 'player2');
      
      expect(action.type).toBe('exchange');
      expect(action.exchangeType).toBe('life');
    });
    
    it('should exchange zones (Rule 701.12d)', () => {
      const action = exchangeZones('exile', 'hand');
      
      expect(action.type).toBe('exchange');
      expect(action.exchangeType).toBe('zones');
    });
    
    it('should exchange numerical values (Rule 701.12g)', () => {
      const action = exchangeNumericalValues('creature1-power', 'creature2-toughness');
      
      expect(action.type).toBe('exchange');
      expect(action.exchangeType).toBe('numerical-values');
    });
    
    it('should exchange text boxes (Rule 701.12h)', () => {
      const action = exchangeTextBoxes('creature1', 'creature2');
      
      expect(action.type).toBe('exchange');
      expect(action.exchangeType).toBe('text-boxes');
    });
    
    it('should be all-or-nothing (Rule 701.12a)', () => {
      expect(canCompleteExchange('target1', 'target2')).toBe(true);
      expect(canCompleteExchange(null, 'target2')).toBe(false);
      expect(canCompleteExchange('target1', null)).toBe(false);
    });
  });
  
  describe('Rule 701.13: Exile', () => {
    it('should exile an object', () => {
      const action = exileObject('card1', 'hand');
      
      expect(action.type).toBe('exile');
      expect(action.objectId).toBe('card1');
      expect(action.fromZone).toBe('hand');
    });
    
    it('should support face-down exile', () => {
      const action = exileObject('card1', 'battlefield', { faceDown: true });
      
      expect(action.faceDown).toBe(true);
    });
    
    it('should support exile zones', () => {
      const action = exileObject('card1', 'battlefield', {
        exileZoneId: 'exiled-with-card-x',
      });
      
      expect(action.exileZoneId).toBe('exiled-with-card-x');
    });
  });
  
  describe('Rule 701.14: Fight', () => {
    it('should create fight action', () => {
      const action = fightCreatures('creature1', 'creature2');
      
      expect(action.type).toBe('fight');
      expect(action.creatureA).toBe('creature1');
      expect(action.creatureB).toBe('creature2');
    });
    
    it('should handle creature fighting itself (Rule 701.14c)', () => {
      const action = fightSelf('creature1');
      
      expect(action.creatureA).toBe('creature1');
      expect(action.creatureB).toBe('creature1');
    });
    
    it('should validate fight requirements (Rule 701.14b)', () => {
      const validCreature = { onBattlefield: true, isCreature: true };
      const notCreature = { onBattlefield: true, isCreature: false };
      const notOnBattlefield = { onBattlefield: false, isCreature: true };
      
      expect(canFight(validCreature, validCreature)).toBe(true);
      expect(canFight(validCreature, notCreature)).toBe(false);
      expect(canFight(validCreature, notOnBattlefield)).toBe(false);
      expect(canFight(null, validCreature)).toBe(false);
    });
    
    it('should not be combat damage (Rule 701.14d)', () => {
      expect(FIGHT_DAMAGE_IS_NOT_COMBAT).toBe(true);
    });
  });
  
  describe('Rule 701.15: Goad', () => {
    it('should goad a creature', () => {
      const action = goadCreature('creature1', 'player2');
      
      expect(action.type).toBe('goad');
      expect(action.creatureId).toBe('creature1');
      expect(action.goaderId).toBe('player2');
    });
    
    it('should require goaded creature to attack (Rule 701.15b)', () => {
      const goaded: GoadedState = {
        creatureId: 'creature1',
        goadedBy: new Set(['player2']),
        expiresOnTurnOf: new Map([['player2', 5]]),
      };
      
      const notGoaded: GoadedState = {
        creatureId: 'creature2',
        goadedBy: new Set(),
        expiresOnTurnOf: new Map(),
      };
      
      expect(mustAttackIfGoaded(goaded)).toBe(true);
      expect(mustAttackIfGoaded(notGoaded)).toBe(false);
    });
    
    it('should prevent attacking goader (Rule 701.15b)', () => {
      const goaded: GoadedState = {
        creatureId: 'creature1',
        goadedBy: new Set(['player2']),
        expiresOnTurnOf: new Map([['player2', 5]]),
      };
      
      expect(canAttackGoader(goaded, 'player2')).toBe(false);
      expect(canAttackGoader(goaded, 'player3')).toBe(true);
    });
    
    it('should handle multiple goad effects (Rule 701.15c)', () => {
      const initial: GoadedState = {
        creatureId: 'creature1',
        goadedBy: new Set(['player2']),
        expiresOnTurnOf: new Map([['player2', 5]]),
      };
      
      const afterSecondGoad = addGoad(initial, 'player3', 7);
      
      expect(afterSecondGoad.goadedBy.has('player2')).toBe(true);
      expect(afterSecondGoad.goadedBy.has('player3')).toBe(true);
    });
    
    it('should not create duplicate goad (Rule 701.15d)', () => {
      const goaded: GoadedState = {
        creatureId: 'creature1',
        goadedBy: new Set(['player2']),
        expiresOnTurnOf: new Map([['player2', 5]]),
      };
      
      expect(isAlreadyGoadedBy(goaded, 'player2')).toBe(true);
      expect(isAlreadyGoadedBy(goaded, 'player3')).toBe(false);
    });
  });
  
  describe('Rule 701.16: Investigate', () => {
    it('should create Clue tokens (Rule 701.16a)', () => {
      const action = investigate('player1');
      
      expect(action.type).toBe('investigate');
      expect(action.playerId).toBe('player1');
      expect(action.count).toBe(1);
    });
    
    it('should create multiple Clue tokens', () => {
      const action = investigate('player1', 3);
      
      expect(action.count).toBe(3);
    });
    
    it('should have correct Clue token characteristics', () => {
      expect(CLUE_TOKEN_CHARACTERISTICS.type).toBe('Artifact');
      expect(CLUE_TOKEN_CHARACTERISTICS.subtype).toBe('Clue');
      expect(CLUE_TOKEN_CHARACTERISTICS.colors).toEqual([]);
    });
  });
  
  describe('Rule 701.17: Mill', () => {
    it('should mill cards from library', () => {
      const action = millCards('player1', 3);
      
      expect(action.type).toBe('mill');
      expect(action.playerId).toBe('player1');
      expect(action.count).toBe(3);
    });
    
    it('should not mill more than library size (Rule 701.17b)', () => {
      expect(canMillCount(10, 5)).toBe(true);
      expect(canMillCount(10, 15)).toBe(false);
      
      expect(getActualMillCount(10, 5)).toBe(5);
      expect(getActualMillCount(10, 15)).toBe(10);
    });
    
    it('should find milled cards in public zones (Rule 701.17c)', () => {
      expect(canFindMilledCard('graveyard')).toBe(true);
      expect(canFindMilledCard('exile')).toBe(true);
      expect(canFindMilledCard('hand')).toBe(false);
      expect(canFindMilledCard('library')).toBe(false);
    });
    
    it('should create mill result (Rule 701.17d)', () => {
      const result = createMillResult('player1', ['card1', 'card2', 'card3']);
      
      expect(result.playerId).toBe('player1');
      expect(result.milledCards).toHaveLength(3);
      expect(result.destinationZone).toBe('graveyard');
    });
  });
});
