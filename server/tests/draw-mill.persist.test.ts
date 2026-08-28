import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { drawCards } from '../src/state/modules/zones.js';
import { millCardsFromLibrary } from '../src/state/modules/triggerLibraryMillUtils.js';
import { millPlayerCardsFromTrigger } from '../src/state/modules/triggerMillFromEffectUtils.js';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function seedLibrary(game: any, playerId: string, cards: Array<{ id: string; name: string }>) {
  const libraries = (game as any).libraries as Map<string, any[]>;
  libraries.set(playerId, cards.map((c) => ({ ...c })));
  game.state.zones = game.state.zones || {};
  game.state.zones[playerId] = {
    ...(game.state.zones[playerId] || {}),
    hand: [],
    handCount: 0,
    libraryCount: cards.length,
    graveyard: [],
    graveyardCount: 0,
  };
}

describe('undo/replay Medium #7: silent drawCards / mill persistence', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('drawCards appends drawCards with drawnCardIds on live draws', () => {
    const gameId = 't_draw_cards_persist_live';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    seedLibrary(game, p1, [
      { id: 'c1', name: 'Card One' },
      { id: 'c2', name: 'Card Two' },
      { id: 'c3', name: 'Card Three' },
    ]);

    vi.mocked(appendEvent).mockClear();
    const drawn = game.drawCards(p1, 2);
    expect(Array.isArray(drawn) ? drawn.length : 0).toBe(2);

    const drawAppends = vi.mocked(appendEvent).mock.calls.filter((call) => String(call[2] || '') === 'drawCards');
    expect(drawAppends.length).toBe(1);
    expect(drawAppends[0]?.[0]).toBe(gameId);
    expect(drawAppends[0]?.[3]).toEqual(
      expect.objectContaining({
        playerId: p1,
        count: 2,
        drawnCardIds: ['c1', 'c2'],
      }),
    );
  });

  it('drawCards skips append while replaying or skipEventPersistence', () => {
    const game = createInitialGameState('t_draw_cards_persist_skip');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    seedLibrary(game, p1, [
      { id: 'c1', name: 'Card One' },
      { id: 'c2', name: 'Card Two' },
    ]);

    (game as any).isReplaying = true;
    vi.mocked(appendEvent).mockClear();
    game.drawCards(p1, 1);
    expect(vi.mocked(appendEvent).mock.calls.filter((c) => c[2] === 'drawCards')).toHaveLength(0);

    (game as any).isReplaying = false;
    seedLibrary(game, p1, [
      { id: 'c3', name: 'Card Three' },
      { id: 'c4', name: 'Card Four' },
    ]);
    vi.mocked(appendEvent).mockClear();
    drawCards(game as any, p1, 1, { skipEventPersistence: true });
    expect(vi.mocked(appendEvent).mock.calls.filter((c) => c[2] === 'drawCards')).toHaveLength(0);
  });

  it('applyEvent(drawCards) restores by drawnCardIds without re-appending', () => {
    const gameId = 't_draw_cards_replay_ids';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    seedLibrary(game, p1, [
      { id: 'mid', name: 'Mid' },
      { id: 'top', name: 'Top' },
      { id: 'bottom', name: 'Bottom' },
    ]);

    vi.mocked(appendEvent).mockClear();
    game.applyEvent({
      type: 'drawCards',
      playerId: p1,
      count: 2,
      drawnCardIds: ['top', 'bottom'],
    } as any);

    const handIds = (game.state.zones?.[p1]?.hand || []).map((c: any) => String(c.id));
    expect(handIds).toEqual(['top', 'bottom']);
    const remaining = ((game as any).libraries.get(p1) || []).map((c: any) => String(c.id));
    expect(remaining).toEqual(['mid']);
    expect(vi.mocked(appendEvent).mock.calls.filter((c) => c[2] === 'drawCards')).toHaveLength(0);
  });

  it('millCardsFromLibrary appends mill on live mills and skips when gated', () => {
    const game = createInitialGameState('t_mill_library_persist');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    seedLibrary(game, p1, [
      { id: 'm1', name: 'Mill One' },
      { id: 'm2', name: 'Mill Two' },
    ]);

    vi.mocked(appendEvent).mockClear();
    const milled = millCardsFromLibrary(game.state as any, p1, 2, game as any);
    expect(milled).toBe(2);
    const millAppends = vi.mocked(appendEvent).mock.calls.filter((c) => c[2] === 'mill');
    expect(millAppends.length).toBe(1);
    expect(millAppends[0]?.[3]).toEqual(expect.objectContaining({ playerId: p1, count: 2 }));

    seedLibrary(game, p1, [{ id: 'm3', name: 'Mill Three' }]);
    vi.mocked(appendEvent).mockClear();
    millCardsFromLibrary(game.state as any, p1, 1, game as any, { skipEventPersistence: true });
    expect(vi.mocked(appendEvent).mock.calls.filter((c) => c[2] === 'mill')).toHaveLength(0);
  });

  it('millPlayerCardsFromTrigger appends mill on live trigger mills', () => {
    const game = createInitialGameState('t_mill_trigger_persist');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    seedLibrary(game, p1, [
      { id: 't1', name: 'Trigger Mill' },
      { id: 't2', name: 'Trigger Mill 2' },
    ]);

    vi.mocked(appendEvent).mockClear();
    millPlayerCardsFromTrigger(game as any, p1, p1, 1, 'Test Source');
    const millAppends = vi.mocked(appendEvent).mock.calls.filter((c) => c[2] === 'mill');
    expect(millAppends.length).toBe(1);
    expect(millAppends[0]?.[3]).toEqual(
      expect.objectContaining({
        playerId: p1,
        count: 1,
        sourceName: 'Test Source',
      }),
    );
  });

  it('drawCards skips a library ghost whose id is already in hand and draws the next card', () => {
    const game = createInitialGameState('t_draw_skip_hand_ghost');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    seedLibrary(game, p1, [
      { id: 'windfall_1', name: 'Windfall' },
      { id: 'island_1', name: 'Island' },
    ]);
    game.state.zones[p1].hand = [{ id: 'windfall_1', name: 'Windfall' }];
    game.state.zones[p1].handCount = 1;

    const drawn = drawCards(game as any, p1, 1, { skipEventPersistence: true });
    expect(drawn.map((card) => card.id)).toEqual(['island_1']);
    expect((game.state.zones[p1].hand || []).map((card: any) => card.id)).toEqual(['windfall_1', 'island_1']);
    expect(game.state.zones[p1].handCount).toBe(2);
  });
});
