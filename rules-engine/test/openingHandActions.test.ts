/**
 * Tests for Opening Hand Actions (Leyline and Chancellor effects)
 */
import { describe, it, expect } from 'vitest';
import {
  OpeningHandActionType,
  detectOpeningHandAction,
  createOpeningHandAction,
  findOpeningHandActions,
  processOpeningHandActions,
  applyOpeningHandPermanents,
  parseChancellorTrigger,
  isFirstUpkeep,
  processFirstUpkeepTriggers,
} from '../src/openingHandActions';

describe('Opening Hand Actions', () => {
  describe('detectOpeningHandAction', () => {
    it('detects Leyline-style cards', () => {
      const leylineCard = {
        id: 'leyline-1',
        name: 'Leyline of Sanctity',
        oracle_text: 'If Leyline of Sanctity is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof.',
      };
      
      expect(detectOpeningHandAction(leylineCard)).toBe(OpeningHandActionType.BEGIN_ON_BATTLEFIELD);
    });
    
    it('detects Chancellor-style cards', () => {
      const chancellorCard = {
        id: 'chancellor-1',
        name: 'Chancellor of the Forge',
        oracle_text: 'You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Phyrexian Goblin creature token with haste.',
      };
      
      expect(detectOpeningHandAction(chancellorCard)).toBe(OpeningHandActionType.REVEAL_FOR_TRIGGER);
    });
    
    it('returns null for regular cards', () => {
      const regularCard = {
        id: 'regular-1',
        name: 'Lightning Bolt',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      };
      
      expect(detectOpeningHandAction(regularCard)).toBe(null);
    });
  });
  
  describe('parseChancellorTrigger', () => {
    it('parses Chancellor of the Forge trigger', () => {
      const card = {
        id: 'chancellor-forge',
        name: 'Chancellor of the Forge',
        oracle_text: 'You may reveal this card from your opening hand.',
      };
      
      const trigger = parseChancellorTrigger(card);
      expect(trigger).not.toBe(null);
      expect(trigger?.effectType).toBe('create_token');
      expect(trigger?.tokenName).toBe('Phyrexian Goblin');
      expect(trigger?.tokenCount).toBe(1);
      expect(trigger?.tokenPower).toBe(1);
      expect(trigger?.tokenToughness).toBe(1);
      expect(trigger?.tokenAbilities).toContain('haste');
    });
    
    it('parses Chancellor of the Dross trigger', () => {
      const card = {
        id: 'chancellor-dross',
        name: 'Chancellor of the Dross',
        oracle_text: 'You may reveal this card from your opening hand.',
      };
      
      const trigger = parseChancellorTrigger(card);
      expect(trigger).not.toBe(null);
      expect(trigger?.effectType).toBe('deal_damage');
      expect(trigger?.amount).toBe(3);
      expect(trigger?.targetType).toBe('each_opponent');
    });
  });
  
  describe('createOpeningHandAction', () => {
    it('creates action for Leyline card', () => {
      const card = {
        id: 'leyline-void',
        name: 'Leyline of the Void',
        oracle_text: 'If Leyline of the Void is in your opening hand, you may begin the game with it on the battlefield.\nIf a card would be put into an opponent\'s graveyard from anywhere, exile it instead.',
      };
      
      const action = createOpeningHandAction(card, 'player1');
      expect(action).not.toBe(null);
      expect(action?.type).toBe(OpeningHandActionType.BEGIN_ON_BATTLEFIELD);
      expect(action?.cardId).toBe('leyline-void');
      expect(action?.controllerId).toBe('player1');
    });
    
    it('creates action for Chancellor card', () => {
      const card = {
        id: 'chancellor-forge',
        name: 'Chancellor of the Forge',
        oracle_text: 'You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Phyrexian Goblin creature token with haste.',
      };
      
      const action = createOpeningHandAction(card, 'player1');
      expect(action).not.toBe(null);
      expect(action?.type).toBe(OpeningHandActionType.REVEAL_FOR_TRIGGER);
      expect(action?.triggerData).not.toBe(undefined);
    });
  });
  
  describe('findOpeningHandActions', () => {
    it('finds all opening hand actions in a hand', () => {
      const hand = [
        { id: '1', name: 'Lightning Bolt', oracle_text: 'Deal 3 damage.' },
        { id: '2', name: 'Leyline of Sanctity', oracle_text: 'If Leyline of Sanctity is in your opening hand, you may begin the game with it on the battlefield.' },
        { id: '3', name: 'Mountain', oracle_text: '' },
        { id: '4', name: 'Chancellor of the Forge', oracle_text: 'You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Phyrexian Goblin creature token with haste.' },
      ];
      
      const actions = findOpeningHandActions(hand, 'player1');
      expect(actions.length).toBe(2);
      expect(actions.find(a => a.cardName === 'Leyline of Sanctity')).toBeDefined();
      expect(actions.find(a => a.cardName === 'Chancellor of the Forge')).toBeDefined();
    });
  });
  
  describe('processOpeningHandActions', () => {
    it('processes Leyline to add to battlefield', () => {
      const hand = [
        { id: 'leyline-1', name: 'Leyline of Sanctity', oracle_text: 'If Leyline of Sanctity is in your opening hand, you may begin the game with it on the battlefield.' },
      ];
      
      const actions = findOpeningHandActions(hand, 'player1');
      const result = processOpeningHandActions(actions, hand, 'player1');
      
      expect(result.permanentsToAdd.length).toBe(1);
      expect(result.permanentsToAdd[0].cardName).toBe('Leyline of Sanctity');
      expect(result.delayedTriggers.length).toBe(0);
    });
    
    it('processes Chancellor to create delayed trigger', () => {
      const hand = [
        { id: 'chancellor-1', name: 'Chancellor of the Forge', oracle_text: 'You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Phyrexian Goblin creature token with haste.' },
      ];
      
      const actions = findOpeningHandActions(hand, 'player1');
      const result = processOpeningHandActions(actions, hand, 'player1');
      
      expect(result.permanentsToAdd.length).toBe(0);
      expect(result.delayedTriggers.length).toBe(1);
      expect(result.delayedTriggers[0].triggersAt).toBe('first_upkeep');
      expect(result.cardsRevealed).toContain('chancellor-1');
    });
  });
  
  describe('applyOpeningHandPermanents', () => {
    it('moves cards from hand to battlefield', () => {
      const battlefield: any[] = [];
      const hand = [
        { id: 'leyline-1', name: 'Leyline of Sanctity', type_line: 'Enchantment' },
        { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant' },
      ];
      
      const permanents = [{
        cardId: 'leyline-1',
        cardName: 'Leyline of Sanctity',
        controllerId: 'player1',
        ownerId: 'player1',
        card: hand[0],
      }];
      
      const result = applyOpeningHandPermanents(battlefield, permanents, hand);
      
      expect(result.battlefield.length).toBe(1);
      expect(result.battlefield[0].id).toBe('leyline-1');
      expect(result.battlefield[0].tapped).toBe(false);
      expect(result.hand.length).toBe(1);
      expect(result.hand[0].id).toBe('bolt-1');
    });
  });
  
  describe('isFirstUpkeep', () => {
    it('returns true for turn 1 upkeep', () => {
      expect(isFirstUpkeep(1, 'upkeep')).toBe(true);
      expect(isFirstUpkeep(1, 'UPKEEP')).toBe(true);
    });
    
    it('returns false for other turns', () => {
      expect(isFirstUpkeep(2, 'upkeep')).toBe(false);
      expect(isFirstUpkeep(3, 'UPKEEP')).toBe(false);
    });
    
    it('returns false for other steps', () => {
      expect(isFirstUpkeep(1, 'draw')).toBe(false);
      expect(isFirstUpkeep(1, 'UNTAP')).toBe(false);
    });
  });
  
  describe('processFirstUpkeepTriggers', () => {
    it('processes token creation triggers', () => {
      const triggers = [{
        sourceCardId: 'chancellor-1',
        sourceCardName: 'Chancellor of the Forge',
        controllerId: 'player1',
        triggerData: {
          effectType: 'create_token' as const,
          tokenName: 'Phyrexian Goblin',
          tokenCount: 1,
          tokenPower: 1,
          tokenToughness: 1,
          tokenAbilities: ['haste'] as readonly string[],
        },
        triggersAt: 'first_upkeep' as const,
      }];
      
      const result = processFirstUpkeepTriggers(triggers);
      
      expect(result.effects.length).toBe(1);
      expect(result.effects[0].type).toBe('create_token');
      expect(result.effects[0].tokenName).toBe('Phyrexian Goblin');
      expect(result.log.length).toBeGreaterThan(0);
    });
  });
});
