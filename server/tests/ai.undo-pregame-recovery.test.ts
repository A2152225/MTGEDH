import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchCardsByExactNamesBatch } = vi.hoisted(() => ({
  fetchCardsByExactNamesBatch: vi.fn(),
}));

vi.mock('../src/services/scryfall.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/scryfall.js')>('../src/services/scryfall.js');
  return {
    ...actual,
    fetchCardsByExactNamesBatch,
  };
});

import { cleanupGameAI, handleAIGameFlow } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/gameState.js';

function createMockIo() {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map(),
    },
  } as any;
}

describe('AI pre-game undo recovery', () => {
  const gameId = 'ai_undo_pregame_recovery';

  afterEach(() => {
    cleanupGameAI(gameId);
    games.delete(gameId);
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('re-imports a persisted AI deck and re-selects commander when pre-game restarts with an empty library', async () => {
    vi.useFakeTimers();

    fetchCardsByExactNamesBatch.mockResolvedValue(new Map([
      ['morophon, the boundless', {
        id: 'morophon-card',
        name: 'Morophon, the Boundless',
        type_line: 'Legendary Creature — Shapeshifter',
        oracle_text: 'Changeling\nAs Morophon, the Boundless enters, choose a creature type.',
        mana_cost: '{7}',
        color_identity: ['W', 'U', 'B', 'R', 'G'],
      }],
      ['island', {
        id: 'island-card',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '{T}: Add {U}.',
        mana_cost: '',
        color_identity: ['U'],
      }],
      ['opt', {
        id: 'opt-card',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1, then draw a card.',
        mana_cost: '{U}',
        color_identity: ['U'],
      }],
    ]));

    const game = createInitialGameState(gameId);
    games.set(gameId, game as any);

    game.applyEvent({
      type: 'join',
      playerId: 'ai_1',
      name: 'AI Opponent',
      spectator: false,
      seatToken: 'seat_ai_1',
      isAI: true,
      strategy: 'control',
      difficulty: 0.5,
    } as any);

    Object.assign((game.state as any), {
      phase: 'pre_game',
      step: undefined,
      turnPlayer: 'ai_1',
      activePlayer: 'ai_1',
      priority: 'ai_1',
      stack: [],
      zones: {
        ai_1: {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        },
      },
      commandZone: {},
    });
    (game as any).libraries?.set?.('ai_1', []);

    const playerInState = (game.state.players || []).find((player: any) => player?.id === 'ai_1') as any;
    playerInState.deckName = 'Undo Recovery Deck';
    playerInState.deckText = [
      '1 Morophon, the Boundless',
      '2 Island',
      '5 Opt',
    ].join('\n');

    const io = createMockIo();

    await handleAIGameFlow(io, gameId, 'ai_1' as any);

    expect(fetchCardsByExactNamesBatch).toHaveBeenCalledTimes(1);
    expect((game as any).searchLibrary?.('ai_1', '', 1000) || []).toHaveLength(8);

    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    const commandZone = (game.state.commandZone || {}).ai_1 as any;
    expect(commandZone?.commanderIds?.length).toBe(1);
    expect(commandZone?.commanderNames).toContain('Morophon, the Boundless');
    expect((game.state.zones || {}).ai_1?.handCount).toBeGreaterThan(0);
  });
});