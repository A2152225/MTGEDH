import { beforeEach, describe, expect, it, vi } from 'vitest';

const createInitialGameStateMock = vi.fn();
const getEventsMock = vi.fn();
const gameExistsInDbMock = vi.fn();
const bridgeInitializeMock = vi.fn();
const createRulesBridgeMock = vi.fn(() => ({
  initialize: bridgeInitializeMock,
}));

vi.mock('../src/state/index.js', () => ({
  createInitialGameState: createInitialGameStateMock,
}));

vi.mock('../src/db/index.js', () => ({
  createGameIfNotExists: vi.fn(),
  getEvents: getEventsMock,
  gameExistsInDb: gameExistsInDbMock,
}));

vi.mock('../src/rules-bridge.js', () => ({
  createRulesBridge: createRulesBridgeMock,
}));

describe('GameManager.ensureGame replay reentrancy', () => {
  beforeEach(() => {
    vi.resetModules();
    createInitialGameStateMock.mockReset();
    getEventsMock.mockReset();
    gameExistsInDbMock.mockReset();
    bridgeInitializeMock.mockReset();
    createRulesBridgeMock.mockClear();
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

  it('reinitializes an existing RulesBridge with the latest authoritative state', async () => {
    createInitialGameStateMock.mockImplementation((gameId: string) => ({
      gameId,
      state: { priority: 'p1', turnPlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }] },
      seq: 0,
      replay: () => {},
    }));

    const { GameManager } = await import('../src/GameManager.js');
    GameManager.clearAllGames();
    GameManager.setIOServer({} as any);

    const game = GameManager.ensureGame('game_rules_bridge_sync');
    expect(game).toBeDefined();
    expect(createRulesBridgeMock).toHaveBeenCalledTimes(1);
    expect(bridgeInitializeMock).toHaveBeenCalledTimes(1);
    expect(bridgeInitializeMock).toHaveBeenLastCalledWith((game as any).state);

    const updatedState = { ...(game as any).state, priority: 'p2', turnPlayer: 'p2' };
    const bridge = GameManager.syncRulesBridge('game_rules_bridge_sync', updatedState);

    expect(bridge).toBeDefined();
    expect(createRulesBridgeMock).toHaveBeenCalledTimes(1);
    expect(bridgeInitializeMock).toHaveBeenCalledTimes(2);
    expect(bridgeInitializeMock).toHaveBeenLastCalledWith(updatedState);
  });
});