import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

describe('Knight of the White Orchid - conditional land search trigger', () => {
  it('should NOT trigger library search when both players have same number of lands', () => {
    const g = createInitialGameState('knight_same_lands');
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
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
    
    // Cast the Knight (it should enter battlefield and trigger ETB)
    const cardRef: KnownCardRef = knight;
    
    // Put knight on stack
    g.state.stack = g.state.stack || [];
    g.state.stack.push({
      id: 'spell_knight',
      controller: p1,
      card: knight,
      targets: [],
    } as any);
    
    // Both players pass priority to resolve
    g.passPriority(p1);
    g.passPriority(p2);
    
    // Check that NO library search was set up (since both have 2 lands)
    expect((g.state as any).pendingLibrarySearch).toBeUndefined();
    
    // Verify knight is on battlefield
    const knightOnField = g.state.battlefield?.find(p => p.card?.name === 'Knight of the White Orchid');
    expect(knightOnField).toBeDefined();
  });
  
  it('should NOT trigger library search when controller has MORE lands than opponents', () => {
    const g = createInitialGameState('knight_more_lands');
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
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
      controller: p1,
      card: knight,
      targets: [],
    } as any);
    
    // Both players pass priority to resolve
    g.passPriority(p1);
    g.passPriority(p2);
    
    // Check that NO library search was set up (since p1 has MORE lands)
    expect((g.state as any).pendingLibrarySearch).toBeUndefined();
  });
  
  it('should trigger library search when opponent has MORE lands than controller', () => {
    const g = createInitialGameState('knight_opponent_more_lands');
    
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
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
    
    // Add Plains to library so player can find one
    (g.state.zones[p1] as any).library = [{
      id: 'plains_lib',
      name: 'Plains',
      type_line: 'Basic Land — Plains',
      oracle_text: '',
    }];
    
    // Put knight on stack
    g.state.stack = g.state.stack || [];
    g.state.stack.push({
      id: 'spell_knight',
      controller: p1,
      card: knight,
      targets: [],
    } as any);
    
    // Both players pass priority to resolve
    g.passPriority(p1);
    g.passPriority(p2);
    
    // Check that library search WAS set up (since opponent has MORE lands)
    expect((g.state as any).pendingLibrarySearch).toBeDefined();
    expect((g.state as any).pendingLibrarySearch[p1]).toBeDefined();
    expect((g.state as any).pendingLibrarySearch[p1]?.filter?.subtypes).toContain('Plains');
    expect((g.state as any).pendingLibrarySearch[p1]?.destination).toBe('battlefield');
  });
});
