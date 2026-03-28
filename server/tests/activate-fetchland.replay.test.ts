import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('activateFetchland replay semantics', () => {
  it('replays a life-cost fetchland by moving it to graveyard and rebuilding the unresolved stack item', () => {
    const game = createInitialGameState('t_activate_fetchland_polluted_delta_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'delta_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'delta_card',
          name: 'Polluted Delta',
          type_line: 'Land',
          oracle_text: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateFetchland',
      playerId: p1,
      permanentId: 'delta_1',
      abilityId: 'delta_1-ability-0',
      cardName: 'Polluted Delta',
      stackId: 'stack_fetch_delta_1',
      activatedAbilityText: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
      lifePaidForCost: 1,
      searchParams: {
        filter: { types: ['land'], subtypes: ['Island', 'Swamp'] },
        searchDescription: 'Search for a Island or Swamp card',
        isTrueFetch: true,
        maxSelections: 1,
        entersTapped: false,
      },
    } as any);

    expect((game.state as any).life[p1]).toBe(39);
    expect((game.state as any).players.find((player: any) => player.id === p1)?.life).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
    expect((game.state as any).permanentLeftBattlefieldThisTurn?.[p1]).toBe(true);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p1].graveyard[0].name).toBe('Polluted Delta');

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.id || '')).toBe('stack_fetch_delta_1');
    expect(String(stack[0]?.abilityType || '')).toBe('fetch-land');
    expect(String(stack[0]?.description || '')).toContain('Island or Swamp');
    expect(Number(stack[0]?.searchParams?.maxSelections || 0)).toBe(1);
    expect(Boolean(stack[0]?.searchParams?.entersTapped || false)).toBe(false);
  });

  it('replays a mana-cost fetchland by consuming mana and preserving the multi-search stack payload', () => {
    const game = createInitialGameState('t_activate_fetchland_myriad_landscape_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 2,
      },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'myriad_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'myriad_card',
          name: 'Myriad Landscape',
          type_line: 'Land',
          oracle_text: '{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateFetchland',
      playerId: p1,
      permanentId: 'myriad_1',
      abilityId: 'myriad_1-ability-0',
      cardName: 'Myriad Landscape',
      stackId: 'stack_fetch_myriad_1',
      activatedAbilityText: '{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.',
      manaCost: '{2}',
      searchParams: {
        filter: { types: ['land', 'basic'] },
        searchDescription: 'Search your library for up to 2 land cards',
        isTrueFetch: false,
        maxSelections: 2,
        entersTapped: true,
      },
    } as any);

    expect((game.state as any).manaPool[p1].colorless).toBe(0);
    expect((game.state as any).permanentLeftBattlefieldThisTurn?.[p1]).toBe(true);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p1].graveyard[0].name).toBe('Myriad Landscape');

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.id || '')).toBe('stack_fetch_myriad_1');
    expect(String(stack[0]?.abilityType || '')).toBe('fetch-land');
    expect(Number(stack[0]?.searchParams?.maxSelections || 0)).toBe(2);
    expect(Boolean(stack[0]?.searchParams?.entersTapped || false)).toBe(true);
    expect(String(stack[0]?.description || '')).toContain('up to 2');
  });
});