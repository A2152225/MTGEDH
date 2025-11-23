import { describe, it, expect } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import {
  pushSpell,
  pushAbility,
  popStack,
  peekStack,
  isStackEmpty,
  counterStackObject,
  clearStack
} from '../src/stack';
import type { StackedSpell, StackedAbility } from '../src/types/stack';
import type { ActivatedAbility } from '../src/types/abilities';

function createTestState(): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      { id: 'p1' as PlayerID, name: 'Player 1', seat: 0 },
      { id: 'p2' as PlayerID, name: 'Player 2', seat: 1 }
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1' as PlayerID,
    priority: 'p1' as PlayerID,
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: GamePhase.FIRSTMAIN,
    active: true
  };
}

describe('Stack Implementation (Rule 405)', () => {
  it('should push spell onto stack as topmost object', () => {
    const state = createTestState();
    const spell: StackedSpell = {
      id: 'spell-1',
      type: 'spell',
      controller: 'p1' as PlayerID,
      cardId: 'card-1',
      manaCost: { generic: 2 },
      targets: [],
      ability: {
        id: 'ability-1',
        type: 'spell',
        sourceId: 'card-1',
        text: 'Draw two cards',
        effect: { type: 'draw', player: 'you', count: 2 }
      },
      resolving: false,
      timestamp: Date.now()
    };

    const result = pushSpell(state, spell);
    
    expect(result.next.stack).toHaveLength(1);
    expect(result.next.stack[0].id).toBe('spell-1');
    expect(result.next.stack[0].type).toBe('spell');
    expect(result.log).toBeDefined();
  });

  it('should push ability onto stack', () => {
    const state = createTestState();
    const ability: ActivatedAbility = {
      id: 'ability-1',
      type: 'activated',
      sourceId: 'permanent-1',
      text: '{T}: Draw a card',
      cost: { type: 'tap', sourceId: 'permanent-1' },
      effect: { type: 'draw', player: 'you', count: 1 }
    };

    const stackedAbility: StackedAbility = {
      id: 'stacked-1',
      type: 'ability',
      controller: 'p1' as PlayerID,
      sourceId: 'permanent-1',
      ability,
      targets: [],
      resolving: false,
      timestamp: Date.now()
    };

    const result = pushAbility(state, stackedAbility);
    
    expect(result.next.stack).toHaveLength(1);
    expect(result.next.stack[0].type).toBe('ability');
  });

  it('should maintain LIFO order (last in, first out)', () => {
    let state = createTestState();
    
    // Push spell 1
    const spell1: StackedSpell = {
      id: 'spell-1',
      type: 'spell',
      controller: 'p1' as PlayerID,
      cardId: 'card-1',
      manaCost: {},
      targets: [],
      ability: {
        id: 'ability-1',
        type: 'spell',
        sourceId: 'card-1',
        text: 'Effect 1',
        effect: { type: 'custom', description: 'Effect 1' }
      },
      resolving: false,
      timestamp: Date.now()
    };
    state = pushSpell(state, spell1).next;

    // Push spell 2
    const spell2: StackedSpell = {
      ...spell1,
      id: 'spell-2',
      cardId: 'card-2'
    };
    state = pushSpell(state, spell2).next;

    // Stack should have spell-2 on top
    const top = peekStack(state);
    expect(top?.id).toBe('spell-2');
    expect(state.stack).toHaveLength(2);
  });

  it('should pop top object from stack', () => {
    let state = createTestState();
    const spell: StackedSpell = {
      id: 'spell-1',
      type: 'spell',
      controller: 'p1' as PlayerID,
      cardId: 'card-1',
      manaCost: {},
      targets: [],
      ability: {
        id: 'ability-1',
        type: 'spell',
        sourceId: 'card-1',
        text: 'Test',
        effect: { type: 'custom', description: 'Test' }
      },
      resolving: false,
      timestamp: Date.now()
    };

    state = pushSpell(state, spell).next;
    expect(state.stack).toHaveLength(1);

    state = popStack(state).next;
    expect(state.stack).toHaveLength(0);
  });

  it('should check if stack is empty', () => {
    const state = createTestState();
    expect(isStackEmpty(state)).toBe(true);

    const spell: StackedSpell = {
      id: 'spell-1',
      type: 'spell',
      controller: 'p1' as PlayerID,
      cardId: 'card-1',
      manaCost: {},
      targets: [],
      ability: {
        id: 'ability-1',
        type: 'spell',
        sourceId: 'card-1',
        text: 'Test',
        effect: { type: 'custom', description: 'Test' }
      },
      resolving: false,
      timestamp: Date.now()
    };

    const nextState = pushSpell(state, spell).next;
    expect(isStackEmpty(nextState)).toBe(false);
  });

  it('should counter a spell on the stack', () => {
    let state = createTestState();
    const spell: StackedSpell = {
      id: 'spell-1',
      type: 'spell',
      controller: 'p1' as PlayerID,
      cardId: 'card-1',
      manaCost: {},
      targets: [],
      ability: {
        id: 'ability-1',
        type: 'spell',
        sourceId: 'card-1',
        text: 'Test',
        effect: { type: 'custom', description: 'Test' }
      },
      resolving: false,
      timestamp: Date.now()
    };

    state = pushSpell(state, spell).next;
    expect(state.stack).toHaveLength(1);

    state = counterStackObject(state, 'spell-1').next;
    expect(state.stack).toHaveLength(0);
  });

  it('should clear all objects from stack', () => {
    let state = createTestState();
    
    // Push multiple spells
    for (let i = 1; i <= 3; i++) {
      const spell: StackedSpell = {
        id: `spell-${i}`,
        type: 'spell',
        controller: 'p1' as PlayerID,
        cardId: `card-${i}`,
        manaCost: {},
        targets: [],
        ability: {
          id: `ability-${i}`,
          type: 'spell',
          sourceId: `card-${i}`,
          text: 'Test',
          effect: { type: 'custom', description: 'Test' }
        },
        resolving: false,
        timestamp: Date.now()
      };
      state = pushSpell(state, spell).next;
    }

    expect(state.stack).toHaveLength(3);

    state = clearStack(state).next;
    expect(state.stack).toHaveLength(0);
  });

  it('should handle empty stack operations gracefully', () => {
    const state = createTestState();
    
    const popResult = popStack(state);
    expect(popResult.next.stack).toHaveLength(0);

    const peekResult = peekStack(state);
    expect(peekResult).toBeUndefined();

    const clearResult = clearStack(state);
    expect(clearResult.next.stack).toHaveLength(0);
  });
});
