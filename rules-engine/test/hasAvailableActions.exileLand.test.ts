import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { hasAvailableActions } from '../src/AutomationService';

type AnyState = GameState & any;

function makeState(overrides: Partial<AnyState> = {}): AnyState {
  const base: AnyState = {
    id: 'has-actions-test',
    format: 'standard' as any,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        battlefield: [],
        exile: [],
        commandZone: [],
        counters: {},
        hasLost: false,
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      } as any,
    ],
    turnOrder: ['p1'],
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turn: 5,
    turnNumber: 5,
    phase: 'precombatMain' as any,
    step: 'main' as any,
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    startingLife: 20,
    allowUndos: false,
    turnTimerEnabled: false,
    turnTimerSeconds: 0,
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    spectators: [],
    status: 'inProgress' as any,
    landsPlayedThisTurn: { p1: 0 },
  };

  return { ...base, ...overrides } as any;
}

describe('hasAvailableActions - playable land from exile', () => {
  it('returns true when an effect grants land-play permission from exile', () => {
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest', canBePlayedBy: 'p1', playableUntilTurn: 5 }],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      playableFromExile: { p1: { land1: 5 } },
      landsPlayedThisTurn: { p1: 0 },
    } as any);

    expect(hasAvailableActions(state, 'p1')).toBe(true);
  });

  it('returns false when permission is non-numeric', () => {
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest', canBePlayedBy: 'p1' }],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      // Bad data should not enable actions
      playableFromExile: { p1: { land1: true } },
      landsPlayedThisTurn: { p1: 0 },
    } as any);

    expect(hasAvailableActions(state, 'p1')).toBe(false);
  });

  it('returns false when land plays are already used up', () => {
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest', canBePlayedBy: 'p1', playableUntilTurn: 5 }],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      playableFromExile: { p1: { land1: 5 } },
      landsPlayedThisTurn: { p1: 1 },
    } as any);

    expect(hasAvailableActions(state, 'p1')).toBe(false);
  });

  it('returns false when permission window has expired', () => {
    const state = makeState({
      turnNumber: 6,
      turn: 6,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 20,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest', canBePlayedBy: 'p1', playableUntilTurn: 5 }],
          commandZone: [],
          counters: {},
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        } as any,
      ],
      playableFromExile: { p1: { land1: 5 } },
      landsPlayedThisTurn: { p1: 0 },
    } as any);

    expect(hasAvailableActions(state, 'p1')).toBe(false);
  });
});
