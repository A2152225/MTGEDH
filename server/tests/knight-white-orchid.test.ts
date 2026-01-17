import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

describe('Knight of the White Orchid - conditional land search trigger', () => {
  beforeEach(() => {
    // Ensure queues from previous runs don't leak into this suite
    ResolutionQueueManager.removeQueue('knight_same_lands');
    ResolutionQueueManager.removeQueue('knight_more_lands');
    ResolutionQueueManager.removeQueue('knight_opponent_more_lands');
    ResolutionQueueManager.removeQueue('knight_condition_changes');
  });

  it('should NOT trigger library search when both players have same number of lands', () => {
    const gameId = 'knight_same_lands';
    const g = createInitialGameState(gameId);
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    // Provide a library (Resolution Queue search reads from ctx.libraries via importDeckResolved)
    const deck: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
      { id: 'plains_lib', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: undefined },
    ];
    g.importDeckResolved(p1, deck);
    
    // Give each player 2 lands on battlefield (same count)
    const plains1: any = {
      id: 'plains_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_1',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const plains2: any = {
      id: 'plains_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_2',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const mountain1: any = {
      id: 'mountain_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_1',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    const mountain2: any = {
      id: 'mountain_2',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_2',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    g.state.battlefield = [plains1, plains2, mountain1, mountain2];
    
    // Create Knight of the White Orchid
    const knight: any = {
      id: 'knight_1',
      name: 'Knight of the White Orchid',
      type_line: 'Creature — Human Knight',
      oracle_text: 'When Knight of the White Orchid enters the battlefield, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.',
    };
    
    // Add Knight to hand
    g.state.zones = g.state.zones || {};
    g.state.zones[p1] = g.state.zones[p1] || { hand: [], library: [], graveyard: [], exile: [] };
    (g.state.zones[p1] as any).hand = [knight];
    
    // Put knight on stack
    g.state.stack = g.state.stack || [];
    g.state.stack.push({
      id: 'spell_knight',
      type: 'spell',
      controller: p1,
      card: knight,
      targets: [],
    } as any);

    // Resolve the creature spell
    g.resolveTopOfStack();

    // Intervening-if: should NOT even put the trigger on the stack
    expect(g.state.stack.length).toBe(0);

    // Check that NO library search step was created (since both have 2 lands)
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.length).toBe(0);
    
    // Verify knight is on battlefield
    const knightOnField = g.state.battlefield?.find(p => p.card?.name === 'Knight of the White Orchid');
    expect(knightOnField).toBeDefined();
  });
  
  it('should NOT trigger library search when controller has MORE lands than opponents', () => {
    const gameId = 'knight_more_lands';
    const g = createInitialGameState(gameId);
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    // Provide a library
    const deck: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
      { id: 'plains_lib', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: undefined },
    ];
    g.importDeckResolved(p1, deck);
    
    // Give p1 3 lands, p2 only 2 lands
    const plains1: any = {
      id: 'plains_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_1',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const plains2: any = {
      id: 'plains_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_2',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const plains3: any = {
      id: 'plains_3',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_3',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const mountain1: any = {
      id: 'mountain_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_1',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    const mountain2: any = {
      id: 'mountain_2',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_2',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    g.state.battlefield = [plains1, plains2, plains3, mountain1, mountain2];
    
    // Create Knight of the White Orchid
    const knight: any = {
      id: 'knight_1',
      name: 'Knight of the White Orchid',
      type_line: 'Creature — Human Knight',
      oracle_text: 'When Knight of the White Orchid enters the battlefield, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.',
    };
    
    // Add Knight to hand
    g.state.zones = g.state.zones || {};
    g.state.zones[p1] = g.state.zones[p1] || { hand: [], library: [], graveyard: [], exile: [] };
    (g.state.zones[p1] as any).hand = [knight];
    
    // Put knight on stack
    g.state.stack = g.state.stack || [];
    g.state.stack.push({
      id: 'spell_knight',
      type: 'spell',
      controller: p1,
      card: knight,
      targets: [],
    } as any);

    // Resolve the creature spell
    g.resolveTopOfStack();

    // Intervening-if: should NOT even put the trigger on the stack
    expect(g.state.stack.length).toBe(0);

    // Check that NO library search step was created (since p1 has MORE lands)
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.length).toBe(0);
  });
  
  it('should trigger library search when opponent has MORE lands than controller', () => {
    const gameId = 'knight_opponent_more_lands';
    const g = createInitialGameState(gameId);
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Provide a library with a Plains so the search step has candidates.
    // NOTE: importDeckResolved clears this player's battlefield permanents,
    // so do it BEFORE seeding battlefield.
    const deck: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
      { id: 'plains_lib', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: undefined },
    ];
    g.importDeckResolved(p1, deck);

    // Give p1 2 lands, p2 3 lands (opponent has more)
    const plains1: any = {
      id: 'plains_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_1',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const plains2: any = {
      id: 'plains_2',
      controller: p1,
      owner: p1,
      card: {
        id: 'plains_2',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      },
    };
    
    const mountain1: any = {
      id: 'mountain_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_1',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    const mountain2: any = {
      id: 'mountain_2',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_2',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    const mountain3: any = {
      id: 'mountain_3',
      controller: p2,
      owner: p2,
      card: {
        id: 'mountain_3',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
    };
    
    g.state.battlefield = [plains1, plains2, mountain1, mountain2, mountain3];
    
    // Create Knight of the White Orchid
    const knight: any = {
      id: 'knight_1',
      name: 'Knight of the White Orchid',
      type_line: 'Creature — Human Knight',
      oracle_text: 'When Knight of the White Orchid enters the battlefield, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.',
    };
    
    // Add Knight to hand
    g.state.zones = g.state.zones || {};
    g.state.zones[p1] = g.state.zones[p1] || { hand: [], library: [], graveyard: [], exile: [] };
    (g.state.zones[p1] as any).hand = [knight];
    
    // Put knight on stack
    g.state.stack = g.state.stack || [];
    g.state.stack.push({
      id: 'spell_knight',
      type: 'spell',
      controller: p1,
      card: knight,
      targets: [],
    } as any);

    // Resolve the creature spell (should create the intervening-if ETB trigger)
    g.resolveTopOfStack();

    // Trigger should be on the stack now
    expect(g.state.stack.length).toBe(1);
    expect(g.state.stack[0]?.type).toBe('triggered_ability');

    // Resolve the ETB trigger (should enqueue a library search step)
    g.resolveTopOfStack();

    // Check that library search WAS set up (since opponent has MORE lands)
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.length).toBeGreaterThan(0);
    const step = steps.find(s => s.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(step).toBeDefined();
    expect((step as any).destination).toBe('battlefield');
    expect((step as any).mandatory).toBe(false); // "you may" search
    expect((step as any).availableCards?.some((c: any) => c.name === 'Plains')).toBe(true);
  });

  it('should NOT resolve the trigger if the intervening-if condition becomes false before resolution', () => {
    const gameId = 'knight_condition_changes';
    const g = createInitialGameState(gameId);

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    // Provide a library with a Plains (should NOT matter if the trigger fizzles).
    // NOTE: importDeckResolved clears this player's battlefield permanents,
    // so do it BEFORE seeding battlefield.
    const deck: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
      { id: 'plains_lib', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: undefined },
    ];
    g.importDeckResolved(p1, deck);

    // Give p1 2 lands, p2 3 lands so the trigger is created at ETB.
    const plains1: any = { id: 'plains_1', controller: p1, owner: p1, card: { id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' } };
    const plains2: any = { id: 'plains_2', controller: p1, owner: p1, card: { id: 'plains_2', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' } };
    const mountain1: any = { id: 'mountain_1', controller: p2, owner: p2, card: { id: 'mountain_1', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' } };
    const mountain2: any = { id: 'mountain_2', controller: p2, owner: p2, card: { id: 'mountain_2', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' } };
    const mountain3: any = { id: 'mountain_3', controller: p2, owner: p2, card: { id: 'mountain_3', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' } };

    g.state.battlefield = [plains1, plains2, mountain1, mountain2, mountain3];

    const knight: any = {
      id: 'knight_1',
      name: 'Knight of the White Orchid',
      type_line: 'Creature — Human Knight',
      oracle_text: 'When Knight of the White Orchid enters the battlefield, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.',
    };

    g.state.zones = g.state.zones || {};
    g.state.zones[p1] = g.state.zones[p1] || { hand: [], library: [], graveyard: [], exile: [] };
    (g.state.zones[p1] as any).hand = [knight];

    g.state.stack = g.state.stack || [];
    g.state.stack.push({
      id: 'spell_knight',
      type: 'spell',
      controller: p1,
      card: knight,
      targets: [],
    } as any);

    // Resolve creature spell; ETB trigger should be created.
    g.resolveTopOfStack();
    expect(g.state.stack.length).toBe(1);
    expect(g.state.stack[0]?.type).toBe('triggered_ability');

    const triggerDesc = String((g.state.stack[0] as any)?.description || '');
    expect(triggerDesc).toMatch(/if\s+an\s+opponent\s+(?:controls|has)\s+more\s+lands\s+than\s+you/i);

    // Change board state BEFORE resolving the trigger: remove one opponent land so the condition is now false.
    g.state.battlefield = (g.state.battlefield as any[]).filter((p: any) => p?.id !== 'mountain_3');

    const landCount = (pid: PlayerID) =>
      (g.state.battlefield as any[]).filter(
        (p: any) => p?.controller === pid && String(p?.card?.type_line || '').toLowerCase().includes('land')
      ).length;
    expect(landCount(p1)).toBe(2);
    expect(landCount(p2)).toBe(2);

    // Sanity-check that the intervening-if clause is now false in the current state.
    expect(isInterveningIfSatisfied(g as any, String(p1), triggerDesc)).toBe(false);

    // Resolve the ETB trigger; it should fizzle and NOT enqueue a library search.
    g.resolveTopOfStack();

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const searchSteps = steps.filter((s: any) => s?.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchSteps).toHaveLength(0);
  });
});
