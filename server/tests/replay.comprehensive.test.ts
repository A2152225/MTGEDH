/**
 * Test suite for enhanced replay system
 * Tests comprehensive action tracking and replay consistency
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { transformDbEventsForReplay } from '../src/socket/util';
import type { KnownCardRef, PlayerID } from '../../shared/src';

const DEBUG_TESTS = process.env.DEBUG_TESTS === '1' || process.env.DEBUG_TESTS === 'true';
const debug = (...args: any[]) => {
  if (DEBUG_TESTS) console.log(...args);
};

function mkCards(n: number, prefix = 'Card'): Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    name: `${prefix} ${i + 1}`,
    type_line: 'Test',
    oracle_text: ''
  }));
}

function mkEquipment(id: string, name: string, equipCost: string): Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'> {
  return {
    id,
    name,
    type_line: 'Artifact - Equipment',
    oracle_text: `Equip ${equipCost}`
  };
}

function mkCreature(id: string, name: string): Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'> {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: ''
  };
}

function mkForetellCard(id: string, name: string): Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'> {
  return {
    id,
    name,
    type_line: 'Sorcery',
    oracle_text: 'Foretell {1}{U}'
  };
}

describe('Enhanced Replay System', () => {
  describe('Equipment events replay', () => {
    it('should correctly replay equipment attachment', () => {
      const gameId = 'equipment_replay_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 111111111;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Simulate battlefield with a creature and equipment
      const creature = {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: mkCreature('creature_1', 'Test Creature'),
      };
      
      const equipment = {
        id: 'equipment_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: mkEquipment('equipment_1', 'Test Sword', '{2}'),
        attachedTo: null,
      };
      
      (game.state as any).battlefield = [creature, equipment];
      
      // Apply equipment event
      game.applyEvent({ 
        type: 'equipPermanent', 
        playerId: p1, 
        equipmentId: 'equipment_1', 
        targetCreatureId: 'creature_1' 
      });
      
      // Verify equipment is attached
      const eqAfter = (game.state.battlefield as any[]).find(p => p.id === 'equipment_1');
      expect(eqAfter.attachedTo).toBe('creature_1');
      
      const crAfter = (game.state.battlefield as any[]).find(p => p.id === 'creature_1');
      expect(crAfter.attachedEquipment).toContain('equipment_1');
      
      // Now test replay consistency
      const game2 = createInitialGameState(gameId + '_replay');
      game2.applyEvent({ type: 'rngSeed', seed });
      (game2.state as any).battlefield = [
        { ...creature, attachedEquipment: undefined },
        { ...equipment, attachedTo: null },
      ];
      
      game2.applyEvent({ 
        type: 'equipPermanent', 
        playerId: p1, 
        equipmentId: 'equipment_1', 
        targetCreatureId: 'creature_1' 
      });
      
      const eq2After = (game2.state.battlefield as any[]).find(p => p.id === 'equipment_1');
      expect(eq2After.attachedTo).toBe(eqAfter.attachedTo);
    });
  });

  describe('Foretell events replay', () => {
    it('should correctly replay foretell action', () => {
      const gameId = 'foretell_replay_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 222222222;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up hand with a foretell card
      const foretellCard = {
        ...mkForetellCard('foretell_1', 'Behold the Multiverse'),
        zone: 'hand',
      };
      
      (game.state as any).zones = {
        [p1]: {
          hand: [foretellCard],
          handCount: 1,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        }
      };
      
      // Apply foretell event
      const foretoldCardData = {
        ...foretellCard,
        zone: 'exile',
        foretold: true,
        foretellCost: '{1}{U}',
        foretoldBy: p1,
        faceDown: true,
      };
      
      game.applyEvent({
        type: 'foretellCard',
        playerId: p1,
        cardId: 'foretell_1',
        card: foretoldCardData,
      });
      
      // Verify card moved to exile
      const zones = (game.state as any).zones[p1];
      expect(zones.hand.length).toBe(0);
      expect(zones.handCount).toBe(0);
      expect(zones.exile.length).toBe(1);
      expect(zones.exile[0].foretold).toBe(true);
      
      debug('Foretell card in exile:', zones.exile[0].name);
    });
  });

  describe('Phase out events replay', () => {
    it('should correctly replay phase out action', () => {
      const gameId = 'phaseout_replay_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 333333333;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up battlefield with permanents
      const perm1 = {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        phasedOut: false,
        card: mkCreature('perm_1', 'Test Creature 1'),
      };
      
      const perm2 = {
        id: 'perm_2',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        phasedOut: false,
        card: mkCreature('perm_2', 'Test Creature 2'),
      };
      
      (game.state as any).battlefield = [perm1, perm2];
      
      // Apply phase out event
      game.applyEvent({
        type: 'phaseOutPermanents',
        playerId: p1,
        permanentIds: ['perm_1', 'perm_2'],
      });
      
      // Verify permanents are phased out
      const bf = game.state.battlefield as any[];
      expect(bf.find(p => p.id === 'perm_1').phasedOut).toBe(true);
      expect(bf.find(p => p.id === 'perm_2').phasedOut).toBe(true);
      
      debug('Permanents phased out successfully');
    });
  });

  describe('Concede events replay', () => {
    it('should correctly replay concede action', () => {
      const gameId = 'concede_replay_test';
      const p1 = 'p_test1' as PlayerID;
      const p2 = 'p_test2' as PlayerID;
      const seed = 444444444;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up players
      (game.state as any).players = [
        { id: p1, name: 'Player 1', conceded: false },
        { id: p2, name: 'Player 2', conceded: false },
      ];
      
      // Apply concede event
      game.applyEvent({
        type: 'concede',
        playerId: p1,
        playerName: 'Player 1',
      });
      
      // Verify player is marked as conceded
      const player1 = (game.state.players as any[]).find(p => p.id === p1);
      expect(player1.conceded).toBe(true);
      
      debug('Player conceded successfully');
    });
  });

  describe('Full replay consistency', () => {
    it('should maintain full state consistency through replay', () => {
      const gameId = 'full_replay_test';
      const p1 = 'p_human' as PlayerID;
      const p2 = 'p_ai' as PlayerID;
      const deck = mkCards(30);
      const seed = 555555555;

      // Session 1: Full game with various actions
      const game1 = createInitialGameState(gameId);
      
      const events = [
        { type: 'rngSeed', seed },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 },
        { type: 'reorderHand', playerId: p1, order: [6, 5, 4, 3, 2, 1, 0] },
        { type: 'shuffleHand', playerId: p1 },
      ];
      
      for (const e of events) {
        game1.applyEvent(e);
      }
      
      const hand1 = ((game1.state.zones as any)?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib1 = game1.peekTopN!(p1, 10).map((c: any) => c.name);
      
      debug('Session 1 - Hand after all actions:', hand1);
      debug('Session 1 - Library (top 10):', lib1);
      
      // Session 2: Replay from scratch
      const game2 = createInitialGameState(gameId + '_replay');
      
      for (const e of events) {
        game2.applyEvent(e);
      }
      
      const hand2 = ((game2.state.zones as any)?.[p1]?.hand ?? []).map((c: any) => c.name);
      const lib2 = game2.peekTopN!(p1, 10).map((c: any) => c.name);
      
      debug('Session 2 - Hand after replay:', hand2);
      debug('Session 2 - Library (top 10):', lib2);
      
      // Verify consistency
      expect(hand2).toEqual(hand1);
      expect(lib2).toEqual(lib1);
    });

    it('should replay all events in sequence without errors', () => {
      const gameId = 'event_sequence_test';
      const p1 = 'p_test' as PlayerID;
      const deck = mkCards(60);
      const seed = 666666666;

      const game = createInitialGameState(gameId);
      
      // Comprehensive event sequence
      const events = [
        { type: 'rngSeed', seed },
        { type: 'join', playerId: p1, name: 'Test Player' },
        { type: 'deckImportResolved', playerId: p1, cards: deck },
        { type: 'setCommander', playerId: p1, commanderNames: ['Card 1'], commanderIds: ['Card_1'] },
        { type: 'shuffleLibrary', playerId: p1 },
        { type: 'drawCards', playerId: p1, count: 7 },
        { type: 'keepHand', playerId: p1 },
        { type: 'adjustLife', playerId: p1, delta: -5 },
        { type: 'setLife', playerId: p1, life: 35 },
        { type: 'passPriority', by: p1 },
        { type: 'nextStep' },
      ];
      
      // Apply events using replay function
      game.replay!(events);
      
      // Verify state is consistent
      expect((game.state.zones as any)?.[p1]?.handCount).toBe(7);
      expect(game.state.life[p1]).toBe(35);
      
      debug('Full event sequence replayed successfully');
    });
  });

  describe('DB event transformation', () => {
    it('should correctly transform new event types from DB format', () => {
      const dbEvents = [
        { type: 'rngSeed', payload: { seed: 12345 } },
        { type: 'equipPermanent', payload: { playerId: 'p1', equipmentId: 'eq1', targetCreatureId: 'c1' } },
        { type: 'foretellCard', payload: { playerId: 'p1', cardId: 'f1', card: { name: 'Test' } } },
        { type: 'phaseOutPermanents', payload: { playerId: 'p1', permanentIds: ['p1', 'p2'] } },
        { type: 'concede', payload: { playerId: 'p1', playerName: 'Player 1' } },
      ];
      
      const replayEvents = transformDbEventsForReplay(dbEvents);
      
      expect(replayEvents[0]).toEqual({ type: 'rngSeed', seed: 12345 });
      expect(replayEvents[1]).toEqual({ type: 'equipPermanent', playerId: 'p1', equipmentId: 'eq1', targetCreatureId: 'c1' });
      expect(replayEvents[2]).toEqual({ type: 'foretellCard', playerId: 'p1', cardId: 'f1', card: { name: 'Test' } });
      expect(replayEvents[3]).toEqual({ type: 'phaseOutPermanents', playerId: 'p1', permanentIds: ['p1', 'p2'] });
      expect(replayEvents[4]).toEqual({ type: 'concede', playerId: 'p1', playerName: 'Player 1' });
    });
    
    it('should correctly transform additional cost events', () => {
      const dbEvents = [
        { type: 'additionalCostConfirm', payload: { playerId: 'p1', costType: 'discard', selectedCards: ['card1', 'card2'] } },
        { type: 'confirmGraveyardTargets', payload: { playerId: 'p1', selectedCardIds: ['c1'], destination: 'hand' } },
      ];
      
      const replayEvents = transformDbEventsForReplay(dbEvents);
      
      expect(replayEvents[0]).toEqual({ type: 'additionalCostConfirm', playerId: 'p1', costType: 'discard', selectedCards: ['card1', 'card2'] });
      expect(replayEvents[1]).toEqual({ type: 'confirmGraveyardTargets', playerId: 'p1', selectedCardIds: ['c1'], destination: 'hand' });
    });
  });

  describe('Additional cost events replay', () => {
    it('should correctly replay discard additional cost', () => {
      const gameId = 'discard_cost_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 777777777;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up hand with cards
      const cards = mkCards(7);
      (game.state as any).zones = {
        [p1]: {
          hand: cards.map(c => ({ ...c, zone: 'hand' })),
          handCount: 7,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
        }
      };
      
      // Apply discard cost event
      game.applyEvent({
        type: 'additionalCostConfirm',
        playerId: p1,
        costType: 'discard',
        selectedCards: ['Card_1', 'Card_2'],
      });
      
      // Verify cards moved to graveyard
      const zones = (game.state as any).zones[p1];
      expect(zones.handCount).toBe(5);
      expect(zones.graveyardCount).toBe(2);
      expect(zones.hand.length).toBe(5);
      expect(zones.graveyard.length).toBe(2);
      
      debug('Discard cost event replayed successfully');
    });
    
    it('should correctly replay sacrifice additional cost', () => {
      const gameId = 'sacrifice_cost_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 888888888;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up battlefield with permanents
      const perm1 = {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: mkCreature('perm_1', 'Test Creature 1'),
      };
      
      const perm2 = {
        id: 'perm_2',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: mkCreature('perm_2', 'Test Creature 2'),
      };
      
      (game.state as any).battlefield = [perm1, perm2];
      (game.state as any).zones = {
        [p1]: {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
        }
      };
      
      // Apply sacrifice cost event
      game.applyEvent({
        type: 'additionalCostConfirm',
        playerId: p1,
        costType: 'sacrifice',
        selectedCards: ['perm_1'],
      });
      
      // Verify permanent moved to graveyard
      const battlefield = game.state.battlefield as any[];
      const zones = (game.state as any).zones[p1];
      
      expect(battlefield.length).toBe(1);
      expect(battlefield[0].id).toBe('perm_2');
      expect(zones.graveyardCount).toBe(1);
      
      debug('Sacrifice cost event replayed successfully');
    });
  });

  describe('Graveyard target events replay', () => {
    it('should correctly replay graveyard to hand movement', () => {
      const gameId = 'gy_to_hand_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 999999999;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up zones with cards in graveyard
      const gyCard = { ...mkCreature('gy_card_1', 'Dead Creature'), zone: 'graveyard' };
      (game.state as any).zones = {
        [p1]: {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [gyCard],
          graveyardCount: 1,
        }
      };
      
      // Apply graveyard target event
      game.applyEvent({
        type: 'confirmGraveyardTargets',
        playerId: p1,
        selectedCardIds: ['gy_card_1'],
        destination: 'hand',
      });
      
      // Verify card moved to hand
      const zones = (game.state as any).zones[p1];
      expect(zones.handCount).toBe(1);
      expect(zones.graveyardCount).toBe(0);
      expect(zones.hand[0].name).toBe('Dead Creature');
      expect(zones.hand[0].zone).toBe('hand');
      
      debug('Graveyard to hand event replayed successfully');
    });
    
    it('should correctly replay graveyard to battlefield movement', () => {
      const gameId = 'gy_to_bf_test';
      const p1 = 'p_test' as PlayerID;
      const seed = 101010101;

      const game = createInitialGameState(gameId);
      game.applyEvent({ type: 'rngSeed', seed });
      
      // Set up zones with cards in graveyard
      const gyCard = { 
        ...mkCreature('gy_card_1', 'Reanimate Target'), 
        zone: 'graveyard',
        power: '5',
        toughness: '5',
      };
      (game.state as any).zones = {
        [p1]: {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [gyCard],
          graveyardCount: 1,
        }
      };
      (game.state as any).battlefield = [];
      
      // Apply graveyard target event
      game.applyEvent({
        type: 'confirmGraveyardTargets',
        playerId: p1,
        selectedCardIds: ['gy_card_1'],
        destination: 'battlefield',
      });
      
      // Verify card moved to battlefield
      const zones = (game.state as any).zones[p1];
      const battlefield = game.state.battlefield as any[];
      
      expect(zones.graveyardCount).toBe(0);
      expect(battlefield.length).toBe(1);
      expect(battlefield[0].card.name).toBe('Reanimate Target');
      expect(battlefield[0].controller).toBe(p1);
      expect(battlefield[0].summoningSickness).toBe(true);
      
      debug('Graveyard to battlefield event replayed successfully');
    });
  });
});
