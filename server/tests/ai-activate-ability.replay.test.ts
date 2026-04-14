import { beforeAll, describe, expect, it } from 'vitest';

import { initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('AI activated ability replay semantics', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('replays shared AI Humble Defector activations deterministically', () => {
    const gameId = 't_ai_humble_defector_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
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
      type: 'activateBattlefieldAbility',
      playerId: p1,
      permanentId: 'humble_1',
      abilityId: 'humble_1-ability-0',
      cardName: 'Humble Defector',
      abilityText: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
      activatedAbilityText: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
      tappedPermanents: ['humble_1'],
      queuedResolutionStep: {
        id: 'queued_humble_1',
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: p1,
        description: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
        mandatory: true,
        sourceId: 'humble_1',
        sourceName: 'Humble Defector',
        permanentId: 'humble_1',
        opponentOnly: true,
        isOptional: false,
        effectData: {
          type: 'control_change',
          permanentId: 'humble_1',
          drawCards: 2,
        },
        players: [
          {
            id: p2,
            name: 'P2',
            life: 40,
            libraryCount: 0,
            isOpponent: true,
            isSelf: false,
          },
        ],
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]?.type).toBe(ResolutionStepType.PLAYER_CHOICE);
    expect(String((queue.steps[0] as any)?.sourceId || '')).toBe('humble_1');

    let humbleDefector = (game.state as any).battlefield.find((entry: any) => entry.id === 'humble_1');
    expect(humbleDefector?.tapped).toBe(true);
    expect(humbleDefector?.controller).toBe(p1);

    game.applyEvent({
      type: 'playerSelection',
      choosingPlayerId: p1,
      selectedPlayerId: p2,
      cardName: 'Humble Defector',
      permanentId: 'humble_1',
      effectType: 'control_change',
      effectData: {
        type: 'control_change',
        permanentId: 'humble_1',
        drawCards: 2,
      },
    } as any);

    expect((game.state as any).zones[p1].hand).toHaveLength(2);

    humbleDefector = (game.state as any).battlefield.find((entry: any) => entry.id === 'humble_1');
    expect(humbleDefector?.tapped).toBe(true);
    expect(humbleDefector?.controller).toBe(p2);
    expect(humbleDefector?.summoningSickness).toBe(true);
  });

  it('replays shared AI fetch-land activations by paying costs and rebuilding the unresolved stack item', () => {
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
      type: 'activateFetchland',
      playerId: p1,
      permanentId: 'delta_1',
      abilityId: 'delta_1-ability-0',
      cardName: 'Polluted Delta',
      stackId: 'stack_fetch_delta_1',
      activatedAbilityText: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
      searchParams: {
        filter: { types: ['land'], subtypes: ['Island', 'Swamp'] },
        searchDescription: 'an Island or Swamp card',
        isTrueFetch: true,
        maxSelections: 1,
        entersTapped: false,
      },
      lifePaidForCost: 1,
    } as any);

    expect((game.state as any).life[p1]).toBe(39);
    expect((game.state as any).players.find((player: any) => player.id === p1)?.life).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p1].graveyard[0].name).toBe('Polluted Delta');

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.id || '')).toBe('stack_fetch_delta_1');
    expect(String(stack[0]?.abilityType || '')).toBe('fetch-land');
    expect(String(stack[0]?.description || '')).toContain('an Island or Swamp card');
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