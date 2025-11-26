import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';

describe('Gameplay fixes - land play, commander casting, priority, win conditions', () => {
  describe('Priority passing with passesInRow tracking', () => {
    it('should pass priority without errors when stack is empty', () => {
      const g = createInitialGameState('priority_empty_stack');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      
      // Set to main phase with p1 as active player
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      (g.state as any).priority = p1;
      
      // Pass priority - should not throw
      expect(() => {
        const result = g.passPriority(p1);
        expect(result.changed).toBe(true);
        expect(result.resolvedNow).toBe(false);
      }).not.toThrow();
      
      // Priority should now be with p2
      expect(g.state.priority).toBe(p2);
    });
    
    it('should track passes in a row when stack has items', () => {
      const g = createInitialGameState('priority_with_stack');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      
      // Set to main phase
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      (g.state as any).priority = p1;
      
      // Add a spell to the stack
      const spell: any = {
        id: 'spell_1',
        controller: p1,
        card: {
          id: 'card_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Deal 3 damage to any target',
        },
        targets: [],
      };
      
      g.state.stack = [spell];
      
      // Both players pass priority - should not throw
      expect(() => {
        g.passPriority(p1); // Pass 1
        g.passPriority(p2); // Pass 2 - should trigger resolution
      }).not.toThrow();
    });
  });
  
  describe('Land play fixes', () => {
    it('should play land by cardId without errors', () => {
      const g = createInitialGameState('land_play_by_id');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Import a land
      const lands: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: undefined },
      ];
      
      g.importDeckResolved(p1, lands);
      g.drawCards(p1, 1);
      
      // Set to main phase
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      expect(handCards.length).toBe(1);
      
      const landId = handCards[0].id;
      
      // Play land by ID - should not throw
      expect(() => {
        g.playLand(p1, landId);
      }).not.toThrow();
      
      // Verify land was moved to battlefield
      expect(g.state.zones?.[p1]?.handCount).toBe(0);
      expect(g.state.battlefield.length).toBe(1);
      expect(g.state.landsPlayedThisTurn?.[p1]).toBe(1);
    });
    
    it('should handle missing card gracefully without throwing', () => {
      const g = createInitialGameState('land_play_missing');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Set to main phase
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      
      // Try to play a non-existent land - should not throw
      expect(() => {
        g.playLand(p1, 'nonexistent_card_id');
      }).not.toThrow();
      
      // Game state should remain consistent
      expect(g.state.battlefield.length).toBe(0);
      // landsPlayedThisTurn is initialized to 0 for players on join
      expect(g.state.landsPlayedThisTurn?.[p1]).toBe(0);
    });
    
    it('should not increment landsPlayedThisTurn if card not found', () => {
      const g = createInitialGameState('land_play_not_found');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Set to main phase
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      
      const before = g.state.landsPlayedThisTurn?.[p1] || 0;
      
      // Try to play a non-existent land
      g.playLand(p1, 'missing_id');
      
      const after = g.state.landsPlayedThisTurn?.[p1] || 0;
      
      // Counter should not have incremented
      expect(after).toBe(before);
    });
  });
  
  describe('Commander casting from command zone', () => {
    it('should set commander and track commander tax', () => {
      const g = createInitialGameState('commander_casting');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      // Import a commander-legal deck
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { 
          id: 'cmd_1', 
          name: 'Atraxa, Praetors\' Voice', 
          type_line: 'Legendary Creature — Phyrexian Angel',
          oracle_text: 'Flying, vigilance, deathtouch, lifelink',
          image_uris: undefined
        },
        { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: undefined },
      ];
      
      g.importDeckResolved(p1, cards);
      
      // Set commander
      g.setCommander(p1, ['Atraxa, Praetors\' Voice'], ['cmd_1']);
      
      const cmdInfo = (g.state.commandZone as any)?.[p1];
      expect(cmdInfo).toBeDefined();
      expect(cmdInfo?.commanderIds).toContain('cmd_1');
      expect(cmdInfo?.tax).toBe(0);
      
      // Cast commander - should increment tax
      g.castCommander(p1, 'cmd_1');
      
      const cmdInfoAfter = (g.state.commandZone as any)?.[p1];
      expect(cmdInfoAfter?.tax).toBe(2); // First cast adds 2 generic mana
      expect(cmdInfoAfter?.taxById?.['cmd_1']).toBe(2);
      
      // Return commander to command zone (simulating it being moved back)
      g.moveCommanderToCZ(p1, 'cmd_1');
      
      // Cast again - tax should increase
      g.castCommander(p1, 'cmd_1');
      
      const cmdInfoSecond = (g.state.commandZone as any)?.[p1];
      expect(cmdInfoSecond?.tax).toBe(4); // Second cast adds another 2
      expect(cmdInfoSecond?.taxById?.['cmd_1']).toBe(4);
    });
    
    it('should remove commander from library when set', () => {
      const g = createInitialGameState('commander_library_removal');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { 
          id: 'cmd_1', 
          name: 'Zaxara, the Exemplary', 
          type_line: 'Legendary Creature — Nightmare Hydra',
          oracle_text: '{T}: Add two mana...',
          image_uris: undefined
        },
        { id: 'island_1', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', image_uris: undefined },
        { id: 'swamp_1', name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '', image_uris: undefined },
      ];
      
      g.importDeckResolved(p1, cards);
      
      const libraryCountBefore = g.state.zones?.[p1]?.libraryCount || 0;
      expect(libraryCountBefore).toBe(3);
      
      // Set commander
      g.setCommander(p1, ['Zaxara, the Exemplary'], ['cmd_1']);
      
      // Library should now have one fewer card
      const libraryCountAfter = g.state.zones?.[p1]?.libraryCount || 0;
      expect(libraryCountAfter).toBe(2);
    });
  });
  
  describe('Win condition messages - should not spam on routine actions', () => {
    it('should not trigger win events when playing a land', () => {
      const g = createInitialGameState('no_win_on_land');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const lands: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: undefined },
      ];
      
      g.importDeckResolved(p1, lands);
      g.drawCards(p1, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      const landId = handCards[0].id;
      
      // Play land - this should NOT trigger any win condition
      g.playLand(p1, landId);
      
      // Verify game state is normal (no winner declared)
      expect(g.state.status).not.toBe('ended');
      expect(g.state.battlefield.length).toBe(1);
    });
    
    it('should not trigger win events when reordering hand', () => {
      const g = createInitialGameState('no_win_on_reorder');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { id: 'card_1', name: 'Card 1', type_line: 'Artifact', oracle_text: '', image_uris: undefined },
        { id: 'card_2', name: 'Card 2', type_line: 'Artifact', oracle_text: '', image_uris: undefined },
      ];
      
      g.importDeckResolved(p1, cards);
      g.drawCards(p1, 2);
      
      // Reorder hand - this should NOT trigger any win condition
      expect(() => {
        g.reorderHand(p1, [1, 0]); // Reverse order
      }).not.toThrow();
      
      expect(g.state.status).not.toBe('ended');
    });
    
    it('should not trigger win events on nextStep progression', () => {
      const g = createInitialGameState('no_win_on_nextstep');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      (g.state as any).phase = GamePhase.BEGINNING;
      (g.state as any).step = GameStep.UNTAP;
      (g.state as any).turnPlayer = p1;
      
      // Advance through steps - should NOT trigger win
      expect(() => {
        g.applyEvent({ type: 'nextStep' }); // to UPKEEP
        g.applyEvent({ type: 'nextStep' }); // to DRAW
        g.applyEvent({ type: 'nextStep' }); // to MAIN1
      }).not.toThrow();
      
      expect(g.state.phase).toBe(GamePhase.PRECOMBAT_MAIN);
      expect(g.state.status).not.toBe('ended');
    });
  });
  
  describe('Land ETB replacement effects (basic support)', () => {
    it('should place basic land untapped on battlefield', () => {
      const g = createInitialGameState('land_etb_basic');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const lands: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { id: 'mountain_1', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '', image_uris: undefined },
      ];
      
      g.importDeckResolved(p1, lands);
      g.drawCards(p1, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      g.playLand(p1, handCards[0].id);
      
      // Basic lands should enter untapped by default
      const perm = g.state.battlefield[0];
      expect(perm.tapped).toBe(false);
      expect((perm.card as any).name).toBe('Mountain');
    });
    
    // Note: Full ETB replacement implementation (e.g., "enters tapped unless you pay 2 life")
    // would require rules engine integration. This test validates the basic flow.
    it('should support land permanents on battlefield', () => {
      const g = createInitialGameState('land_etb_permanent');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const lands: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
        { 
          id: 'shockland_1', 
          name: 'Steam Vents', 
          type_line: 'Land — Island Mountain',
          oracle_text: 'As Steam Vents enters, you may pay 2 life. If you don\'t, it enters tapped.',
          image_uris: undefined
        },
      ];
      
      g.importDeckResolved(p1, lands);
      g.drawCards(p1, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      g.playLand(p1, handCards[0].id);
      
      // Land should be on battlefield (ETB choice handling would be in rules engine)
      expect(g.state.battlefield.length).toBe(1);
      const perm = g.state.battlefield[0];
      expect((perm.card as any).name).toBe('Steam Vents');
      expect(perm.controller).toBe(p1);
    });
  });
  
  describe('Spell casting from hand (double-click)', () => {
    it('should cast a 0-mana artifact from hand', () => {
      const g = createInitialGameState('cast_0mana_artifact');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
        { 
          id: 'artifact_1', 
          name: 'Ornithopter', 
          type_line: 'Artifact Creature — Thopter',
          oracle_text: 'Flying',
          mana_cost: '{0}',
          image_uris: undefined
        },
      ];
      
      g.importDeckResolved(p1, cards as any);
      g.drawCards(p1, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      (g.state as any).priority = p1;
      
      const handBefore = g.state.zones?.[p1]?.handCount || 0;
      expect(handBefore).toBe(1);
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      const cardId = handCards[0].id;
      
      // Cast the spell by adding it to the stack
      const stackItem = {
        id: `stack_test_${cardId}`,
        controller: p1,
        card: { ...handCards[0], zone: 'stack' },
        targets: [],
      };
      
      // Remove from hand
      handCards.splice(0, 1);
      g.state.zones![p1]!.handCount = 0;
      
      // Add to stack
      g.pushStack(stackItem);
      
      // Verify card moved to stack
      expect(g.state.zones?.[p1]?.handCount).toBe(0);
      expect(g.state.stack.length).toBe(1);
      expect((g.state.stack[0] as any).card.name).toBe('Ornithopter');
      expect((g.state.stack[0] as any).controller).toBe(p1);
    });
    
    it('should cast an instant from hand', () => {
      const g = createInitialGameState('cast_instant');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
        { 
          id: 'instant_1', 
          name: 'Lightning Bolt', 
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          mana_cost: '{R}',
          image_uris: undefined
        },
      ];
      
      g.importDeckResolved(p1, cards as any);
      g.drawCards(p1, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      (g.state as any).priority = p1;
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      const cardId = handCards[0].id;
      
      // Cast the spell
      const stackItem = {
        id: `stack_test_${cardId}`,
        controller: p1,
        card: { ...handCards[0], zone: 'stack' },
        targets: ['target_player'],
      };
      
      handCards.splice(0, 1);
      g.state.zones![p1]!.handCount = 0;
      g.pushStack(stackItem);
      
      // Verify spell is on stack with targets
      expect(g.state.stack.length).toBe(1);
      expect((g.state.stack[0] as any).card.name).toBe('Lightning Bolt');
      expect((g.state.stack[0] as any).targets).toEqual(['target_player']);
    });
    
    it('should cast a sorcery during main phase', () => {
      const g = createInitialGameState('cast_sorcery');
      
      const p1 = 'p1' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
        { 
          id: 'sorcery_1', 
          name: 'Rampant Growth', 
          type_line: 'Sorcery',
          oracle_text: 'Search your library for a basic land card...',
          mana_cost: '{1}{G}',
          image_uris: undefined
        },
      ];
      
      g.importDeckResolved(p1, cards as any);
      g.drawCards(p1, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      (g.state as any).priority = p1;
      
      const handCards = g.state.zones?.[p1]?.hand as any[];
      const cardId = handCards[0].id;
      
      // Cast the sorcery
      const stackItem = {
        id: `stack_test_${cardId}`,
        controller: p1,
        card: { ...handCards[0], zone: 'stack' },
        targets: [],
      };
      
      handCards.splice(0, 1);
      g.state.zones![p1]!.handCount = 0;
      g.pushStack(stackItem);
      
      // Verify sorcery is on stack
      expect(g.state.stack.length).toBe(1);
      expect((g.state.stack[0] as any).card.name).toBe('Rampant Growth');
      expect((g.state.stack[0] as any).card.type_line).toBe('Sorcery');
    });
    
    it('should handle multiple spells on stack', () => {
      const g = createInitialGameState('multiple_spells');
      
      const p1 = 'p1' as PlayerID;
      const p2 = 'p2' as PlayerID;
      
      g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
      g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
      
      const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
        { 
          id: 'spell_1', 
          name: 'Giant Growth', 
          type_line: 'Instant',
          oracle_text: 'Target creature gets +3/+3 until end of turn.',
          mana_cost: '{G}',
          image_uris: undefined
        },
        { 
          id: 'spell_2', 
          name: 'Counterspell', 
          type_line: 'Instant',
          oracle_text: 'Counter target spell.',
          mana_cost: '{U}{U}',
          image_uris: undefined
        },
      ];
      
      g.importDeckResolved(p1, [cards[0]] as any);
      g.importDeckResolved(p2, [cards[1]] as any);
      
      g.drawCards(p1, 1);
      g.drawCards(p2, 1);
      
      (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
      (g.state as any).turnPlayer = p1;
      (g.state as any).priority = p1;
      
      // P1 casts Giant Growth
      const p1Hand = g.state.zones?.[p1]?.hand as any[];
      g.pushStack({
        id: 'stack_1',
        controller: p1,
        card: { ...p1Hand[0], zone: 'stack' },
        targets: ['target_creature'],
      });
      
      // P2 responds with Counterspell
      const p2Hand = g.state.zones?.[p2]?.hand as any[];
      g.pushStack({
        id: 'stack_2',
        controller: p2,
        card: { ...p2Hand[0], zone: 'stack' },
        targets: ['stack_1'],
      });
      
      // Stack should have 2 items (most recent on top)
      expect(g.state.stack.length).toBe(2);
      expect((g.state.stack[1] as any).card.name).toBe('Counterspell'); // Top of stack
      expect((g.state.stack[0] as any).card.name).toBe('Giant Growth');
    });
  });
});
