import { beforeAll, describe, expect, it } from 'vitest';

import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('AI activated ability replay semantics', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('replays persisted AI Humble Defector activations deterministically', () => {
    const game = createInitialGameState('t_ai_humble_defector_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.importDeckResolved(p1, [
      { id: 'drawn_1', name: 'Card One', type_line: 'Instant', oracle_text: 'Draw a card.' },
      { id: 'drawn_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: 'Scry 1.' },
    ] as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 2,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'humble_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'humble_card',
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateAbility',
      playerId: p1,
      permanentId: 'humble_1',
      cardName: 'Humble Defector',
      abilityType: 'humble-defector',
      abilityText: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
      activatedAbilityText: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
      tappedPermanents: ['humble_1'],
      targetOpponentId: p2,
      usesStack: false,
      isAI: true,
    } as any);

    expect((game.state as any).zones[p1].hand).toHaveLength(2);

    const humbleDefector = (game.state as any).battlefield.find((entry: any) => entry.id === 'humble_1');
    expect(humbleDefector?.tapped).toBe(true);
    expect(humbleDefector?.controller).toBe(p2);
    expect(humbleDefector?.summoningSickness).toBe(true);
  });

  it('replays persisted AI fetch-land activations by paying costs and rebuilding the unresolved stack item', () => {
    const game = createInitialGameState('t_ai_fetchland_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'delta_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
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
      type: 'activateAbility',
      playerId: p1,
      permanentId: 'delta_1',
      cardName: 'Polluted Delta',
      abilityType: 'fetch-land',
      abilityText: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
      activatedAbilityText: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
      tappedPermanents: ['delta_1'],
      sacrificedPermanents: ['delta_1'],
      lifePaidForCost: 1,
      usesStack: true,
      searchParams: {
        searchDescription: 'an Island or Swamp card',
        filter: { types: ['land'], subtypes: ['Island', 'Swamp'] },
        maxSelections: 1,
      },
      isAI: true,
    } as any);

    expect((game.state as any).life[p1]).toBe(39);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p1].graveyard[0].name).toBe('Polluted Delta');

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.abilityType || '')).toBe('fetch-land');
    expect(String(stack[0]?.description || '')).toContain('Search your library for an Island or Swamp card');
    expect(String(stack[0]?.searchParams?.searchDescription || '')).toBe('an Island or Swamp card');
  });

  it('replays persisted generic AI non-mana activations by rebuilding the unresolved stack item', () => {
    const game = createInitialGameState('t_ai_generic_ability_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'tome_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'tome_card',
          name: 'Arcane Encyclopedia',
          type_line: 'Artifact',
          oracle_text: '{3}, {T}: Draw a card.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'activateAbility',
      playerId: p1,
      permanentId: 'tome_1',
      cardName: 'Arcane Encyclopedia',
      abilityType: 'generic',
      abilityText: '{3}, {T}: Draw a card.',
      activatedAbilityText: '{3}, {T}: Draw a card.',
      tappedPermanents: ['tome_1'],
      usesStack: true,
      isAI: true,
    } as any);

    expect((game.state as any).battlefield[0].tapped).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.type || '')).toBe('ability');
    expect(String(stack[0]?.source || '')).toBe('tome_1');
    expect(String(stack[0]?.description || '')).toBe('{3}, {T}: Draw a card.');
    expect(String(stack[0]?.activatedAbilityText || '')).toBe('{3}, {T}: Draw a card.');
  });
});