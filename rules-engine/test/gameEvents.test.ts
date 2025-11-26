/**
 * Tests for game events and draw triggers (Rule 603)
 */
import { describe, it, expect } from 'vitest';
import {
  GameEventType,
  createGameEvent,
  createCardDrawnEvent,
  createStepStartedEvent,
  matchesTriggerCondition,
  findTriggeredAbilitiesForEvent,
  createPendingTriggersFromEvent,
  sortTriggersByAPNAP,
  detectDrawTriggers,
  KNOWN_DRAW_TRIGGERS,
  type GameEvent,
  type TriggerCondition,
  type EventTriggeredAbility,
  type PendingTrigger,
} from '../src/gameEvents';

describe('Game Events System', () => {
  describe('createGameEvent', () => {
    it('creates event with all fields', () => {
      const event = createGameEvent(
        GameEventType.CARD_DRAWN,
        { playerId: 'player1', cardId: 'card1' },
        'source1',
        'controller1'
      );

      expect(event.type).toBe(GameEventType.CARD_DRAWN);
      expect(event.sourceId).toBe('source1');
      expect(event.sourceControllerId).toBe('controller1');
      expect(event.data.playerId).toBe('player1');
      expect(event.timestamp).toBeDefined();
    });
  });

  describe('createCardDrawnEvent', () => {
    it('creates card drawn event with all fields', () => {
      const event = createCardDrawnEvent('player1', 'card1', 'Lightning Bolt', true);

      expect(event.type).toBe(GameEventType.CARD_DRAWN);
      expect(event.data.playerId).toBe('player1');
      expect(event.data.drawingPlayer).toBe('player1');
      expect(event.data.cardId).toBe('card1');
      expect(event.data.cardName).toBe('Lightning Bolt');
      expect(event.data.isFirstDrawOfTurn).toBe(true);
    });
  });

  describe('createStepStartedEvent', () => {
    it('creates step started event', () => {
      const event = createStepStartedEvent('DRAW', 'player1');

      expect(event.type).toBe(GameEventType.STEP_STARTED);
      expect(event.data.stepName).toBe('DRAW');
      expect(event.data.playerId).toBe('player1');
    });
  });

  describe('matchesTriggerCondition', () => {
    it('matches event type', () => {
      const event = createCardDrawnEvent('player1', 'card1');
      const condition: TriggerCondition = {
        eventType: GameEventType.CARD_DRAWN,
        mandatory: true,
      };

      expect(matchesTriggerCondition(event, condition, 'player2', 'player1')).toBe(true);
    });

    it('rejects non-matching event type', () => {
      const event = createCardDrawnEvent('player1', 'card1');
      const condition: TriggerCondition = {
        eventType: GameEventType.SPELL_CAST,
        mandatory: true,
      };

      expect(matchesTriggerCondition(event, condition, 'player2', 'player1')).toBe(false);
    });

    it('filters by source controller (opponent)', () => {
      const event = createGameEvent(
        GameEventType.CARD_DRAWN,
        { playerId: 'player1' },
        'source1',
        'player1'
      );
      const condition: TriggerCondition = {
        eventType: GameEventType.CARD_DRAWN,
        filter: { sourceController: 'opponent' },
        mandatory: true,
      };

      // Controller is player2, source controller is player1 (opponent)
      expect(matchesTriggerCondition(event, condition, 'player2', 'player1')).toBe(true);
      // Controller is player1, source controller is player1 (self)
      expect(matchesTriggerCondition(event, condition, 'player1', 'player1')).toBe(false);
    });

    it('filters by source controller (you)', () => {
      const event = createGameEvent(
        GameEventType.CARD_DRAWN,
        { playerId: 'player1' },
        'source1',
        'player1'
      );
      const condition: TriggerCondition = {
        eventType: GameEventType.CARD_DRAWN,
        filter: { sourceController: 'you' },
        mandatory: true,
      };

      // Controller is player1, source controller is player1 (self)
      expect(matchesTriggerCondition(event, condition, 'player1', 'player1')).toBe(true);
      // Controller is player2, source controller is player1 (opponent)
      expect(matchesTriggerCondition(event, condition, 'player2', 'player1')).toBe(false);
    });

    it('filters by player filter (active)', () => {
      const event = createCardDrawnEvent('player1', 'card1');
      const condition: TriggerCondition = {
        eventType: GameEventType.CARD_DRAWN,
        filter: { playerFilter: 'active' },
        mandatory: true,
      };

      // player1 is active player
      expect(matchesTriggerCondition(event, condition, 'player2', 'player1')).toBe(true);
      // player2 is active player, but player1 drew
      expect(matchesTriggerCondition(event, condition, 'player2', 'player2')).toBe(false);
    });

    it('filters by first of turn', () => {
      const firstDraw = createCardDrawnEvent('player1', 'card1', 'Card', true);
      const secondDraw = createCardDrawnEvent('player1', 'card2', 'Card', false);
      const condition: TriggerCondition = {
        eventType: GameEventType.CARD_DRAWN,
        filter: { isFirstOfTurn: true },
        mandatory: true,
      };

      expect(matchesTriggerCondition(firstDraw, condition, 'player1', 'player1')).toBe(true);
      expect(matchesTriggerCondition(secondDraw, condition, 'player1', 'player1')).toBe(false);
    });

    it('supports custom filter function', () => {
      const event = createCardDrawnEvent('player1', 'card1', 'Lightning Bolt');
      const condition: TriggerCondition = {
        eventType: GameEventType.CARD_DRAWN,
        filter: {
          custom: (e) => e.data.cardName === 'Lightning Bolt',
        },
        mandatory: true,
      };

      expect(matchesTriggerCondition(event, condition, 'player1', 'player1')).toBe(true);
    });
  });

  describe('findTriggeredAbilitiesForEvent', () => {
    it('finds matching abilities', () => {
      const event = createCardDrawnEvent('player2', 'card1');
      const abilities: EventTriggeredAbility[] = [
        {
          id: 'ability1',
          sourceId: 'perm1',
          sourceName: 'Smothering Tithe',
          controllerId: 'player1',
          condition: {
            eventType: GameEventType.CARD_DRAWN,
            filter: { sourceController: 'opponent' },
            mandatory: true,
          },
          effect: 'Create Treasure',
        },
        {
          id: 'ability2',
          sourceId: 'perm2',
          sourceName: 'Random Card',
          controllerId: 'player1',
          condition: {
            eventType: GameEventType.SPELL_CAST,
            mandatory: true,
          },
          effect: 'Something',
        },
      ];

      // player2 drew (opponent of player1 who controls Smothering Tithe)
      const result = findTriggeredAbilitiesForEvent(event, abilities, 'player2');
      expect(result.length).toBe(1);
      expect(result[0].sourceName).toBe('Smothering Tithe');
    });
  });

  describe('createPendingTriggersFromEvent', () => {
    it('creates pending triggers from abilities', () => {
      const event = createCardDrawnEvent('player1', 'card1');
      const abilities: EventTriggeredAbility[] = [
        {
          id: 'ability1',
          sourceId: 'perm1',
          sourceName: 'Test Card',
          controllerId: 'player1',
          condition: { eventType: GameEventType.CARD_DRAWN, mandatory: true },
          effect: 'Draw a card',
        },
      ];

      const triggers = createPendingTriggersFromEvent(event, abilities);
      
      expect(triggers.length).toBe(1);
      expect(triggers[0].ability.sourceName).toBe('Test Card');
      expect(triggers[0].event).toBe(event);
      expect(triggers[0].onStack).toBe(false);
    });
  });

  describe('sortTriggersByAPNAP', () => {
    it('sorts active player triggers first', () => {
      const triggers: PendingTrigger[] = [
        {
          id: 't1',
          ability: { controllerId: 'player2' } as any,
          event: {} as any,
          timestamp: 1,
          onStack: false,
        },
        {
          id: 't2',
          ability: { controllerId: 'player1' } as any,
          event: {} as any,
          timestamp: 2,
          onStack: false,
        },
      ];

      const sorted = sortTriggersByAPNAP(triggers, 'player1', ['player1', 'player2', 'player3']);
      expect(sorted[0].ability.controllerId).toBe('player1');
      expect(sorted[1].ability.controllerId).toBe('player2');
    });

    it('maintains turn order for non-active players', () => {
      const triggers: PendingTrigger[] = [
        { id: 't1', ability: { controllerId: 'player4' } as any, event: {} as any, timestamp: 1, onStack: false },
        { id: 't2', ability: { controllerId: 'player2' } as any, event: {} as any, timestamp: 2, onStack: false },
        { id: 't3', ability: { controllerId: 'player3' } as any, event: {} as any, timestamp: 3, onStack: false },
      ];

      const sorted = sortTriggersByAPNAP(triggers, 'player1', ['player1', 'player2', 'player3', 'player4']);
      expect(sorted[0].ability.controllerId).toBe('player2');
      expect(sorted[1].ability.controllerId).toBe('player3');
      expect(sorted[2].ability.controllerId).toBe('player4');
    });
  });

  describe('detectDrawTriggers', () => {
    it('detects Smothering Tithe', () => {
      const card = {
        name: 'Smothering Tithe',
        oracle_text: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
      };

      const abilities = detectDrawTriggers(card, 'perm1', 'player1');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].condition.eventType).toBe(GameEventType.CARD_DRAWN);
    });

    it('detects Consecrated Sphinx', () => {
      const card = {
        name: 'Consecrated Sphinx',
        oracle_text: 'Flying\nWhenever an opponent draws a card, you may draw two cards.',
      };

      const abilities = detectDrawTriggers(card, 'perm1', 'player1');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].condition.filter?.sourceController).toBe('opponent');
    });

    it('detects self draw triggers', () => {
      const card = {
        name: 'Thought Reflection',
        oracle_text: 'If you would draw a card, draw two cards instead.', // This is actually replacement
      };

      // Note: This won't match because it's a replacement effect, not a trigger
      // But if it had "Whenever you draw a card"...
      const card2 = {
        name: 'Test Card',
        oracle_text: 'Whenever you draw a card, gain 1 life.',
      };

      const abilities = detectDrawTriggers(card2, 'perm1', 'player1');
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].condition.filter?.sourceController).toBe('you');
    });

    it('detects generic opponent draw triggers', () => {
      const card = {
        name: 'Custom Draw Punisher',
        oracle_text: 'Whenever an opponent draws a card, they lose 1 life.',
      };

      const abilities = detectDrawTriggers(card, 'perm1', 'player1');
      
      expect(abilities.length).toBeGreaterThan(0);
    });
  });

  describe('KNOWN_DRAW_TRIGGERS', () => {
    it('includes Smothering Tithe', () => {
      expect(KNOWN_DRAW_TRIGGERS['smothering tithe']).toBeDefined();
      expect(KNOWN_DRAW_TRIGGERS['smothering tithe'].mandatory).toBe(true);
    });

    it('includes Rhystic Study', () => {
      expect(KNOWN_DRAW_TRIGGERS['rhystic study']).toBeDefined();
      expect(KNOWN_DRAW_TRIGGERS['rhystic study'].mandatory).toBe(false); // "you may draw"
    });

    it('includes Consecrated Sphinx', () => {
      expect(KNOWN_DRAW_TRIGGERS['consecrated sphinx']).toBeDefined();
    });
  });
});
