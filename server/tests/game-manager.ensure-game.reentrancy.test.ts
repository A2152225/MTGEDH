import { beforeEach, describe, expect, it, vi } from 'vitest';

const createInitialGameStateMock = vi.fn();
const getEventsMock = vi.fn();
const gameExistsInDbMock = vi.fn();

vi.mock('../src/state/index.js', () => ({
  createInitialGameState: createInitialGameStateMock,
}));

vi.mock('../src/db/index.js', () => ({
  createGameIfNotExists: vi.fn(),
  getEvents: getEventsMock,
  gameExistsInDb: gameExistsInDbMock,
}));

vi.mock('../src/rules-bridge.js', () => ({
  createRulesBridge: vi.fn(() => ({
    initialize: vi.fn(),
  })),
}));

describe('GameManager.ensureGame replay reentrancy', () => {
  beforeEach(() => {
    vi.resetModules();
    createInitialGameStateMock.mockReset();
    getEventsMock.mockReset();
    gameExistsInDbMock.mockReset();
    gameExistsInDbMock.mockReturnValue(true);
    getEventsMock.mockReturnValue([{ type: 'test_event' }]);
  });

  it('reuses the same in-memory game when replay re-enters ensureGame', async () => {
    let replayReentered = false;
    let importedGameManager: any;

    createInitialGameStateMock.mockImplementation((gameId: string) => ({
      gameId,
      state: {},
      seq: 0,
      replay: () => {
        if (!replayReentered) {
          replayReentered = true;
          importedGameManager.ensureGame(gameId);
        }
      },
    }));

    const { GameManager } = await import('../src/GameManager.js');
    importedGameManager = GameManager;
    GameManager.clearAllGames();

    const game = GameManager.ensureGame('game_reentrant_restore');

    expect(game).toBeDefined();
    expect(createInitialGameStateMock).toHaveBeenCalledTimes(1);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(GameManager.getGame('game_reentrant_restore')).toBe(game);
  });
});