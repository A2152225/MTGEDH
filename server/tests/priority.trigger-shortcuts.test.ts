import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import type { GameContext } from '../src/state/context';
import { passPriority } from '../src/state/modules/priority.js';

function createPriorityTestContext(state: any): GameContext {
  return {
    gameId: 'priority_trigger_shortcuts',
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

function createMana(red: number) {
  return { white: 0, blue: 0, black: 0, red, green: 0, colorless: 0 };
}

function createTriggeredAbilityState(overrides: Record<string, unknown> = {}) {
  return {
    players: [
      { id: 'p1', seat: 1 },
      { id: 'p2', seat: 2 },
    ],
    turnDirection: 1,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [
      {
        id: 'trigger_1',
        type: 'triggered_ability',
        controller: 'p2',
        source: 'soul_warden_1',
        sourceName: 'Soul Warden',
        description: 'Whenever another creature enters the battlefield, you gain 1 life.',
        mandatory: true,
      },
    ],
    zones: {
      p1: { hand: [], graveyard: [], library: [] },
      p2: {
        hand: [
          {
            id: 'bolt_1',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        ],
        graveyard: [],
        library: [],
      },
    },
    battlefield: [],
    manaPool: {
      p1: createMana(0),
      p2: createMana(1),
    },
    autoPassPlayers: new Set(['p2']),
    ...overrides,
  };
}

describe('priority trigger shortcuts', () => {
  it('auto-passes a responding player with a legal instant when the top trigger source is yielded', () => {
    const state = createTriggeredAbilityState({
      yieldToTriggerSourcesForAutoPass: {
        p2: {
          soul_warden_1: {
            sourceId: 'soul_warden_1',
            sourceName: 'Soul Warden',
            enabled: true,
          },
        },
      },
    });
    const ctx = createPriorityTestContext(state);

    const result = passPriority(ctx, 'p1' as PlayerID, true);

    expect(result.changed).toBe(true);
    expect(result.resolvedNow).toBe(true);
    expect(state.priority).toBe('p1');
  });

  it('auto-passes a responding player with a legal instant when always_resolve matches the top trigger source', () => {
    const state = createTriggeredAbilityState({
      triggerShortcuts: {
        p2: [
          {
            cardName: 'Soul Warden',
            playerId: 'p2',
            preference: 'always_resolve',
          },
        ],
      },
    });
    const ctx = createPriorityTestContext(state);

    const result = passPriority(ctx, 'p1' as PlayerID, true);

    expect(result.changed).toBe(true);
    expect(result.resolvedNow).toBe(true);
    expect(state.priority).toBe('p1');
  });
});