import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: { playerId: string; spectator?: boolean; gameId?: string },
  emitted: Array<{ room?: string; event: string; payload: any }>
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('game-actions in-room authorization (integration)', () => {
  const gameId = 'test_game_actions_inroom_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('blocks concede when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await handlers['concede']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const player = (game.state as any).players[0];
    expect(player?.conceded).toBeUndefined();
  });

  it('blocks phaseOutPermanents when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        phasedOut: false,
        card: { name: 'Test Permanent', type_line: 'Artifact' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    await handlers['phaseOutPermanents']({ gameId, permanentIds: ['perm_1'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const perm = (game.state as any).battlefield[0];
    expect(perm?.phasedOut).toBe(false);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const p1 = 'p1';
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    expect(() => handlers['resolveAllTriggers'](undefined as any)).not.toThrow();
    expect(() => handlers['claimMyTurn'](undefined as any)).not.toThrow();
    expect(() => handlers['randomizeStartingPlayer'](undefined as any)).not.toThrow();
    expect(() => handlers['shuffleHand'](undefined as any)).not.toThrow();
    await expect(Promise.resolve().then(() => handlers['castSpellFromHand'](undefined as any))).resolves.toBeUndefined();
    expect(() => handlers['reorderHand'](undefined as any)).not.toThrow();
    expect(() => handlers['setTurnDirection'](undefined as any)).not.toThrow();
    expect(() => handlers['playLand'](undefined as any)).not.toThrow();
    expect(() => handlers['restartGame'](undefined as any)).not.toThrow();
    expect(() => handlers['restartGameClear'](undefined as any)).not.toThrow();
    expect(() => handlers['keepHand'](undefined as any)).not.toThrow();
    expect(() => handlers['mulligan'](undefined as any)).not.toThrow();
    expect(() => handlers['concede'](undefined as any)).not.toThrow();
    await expect(Promise.resolve().then(() => handlers['requestCastSpell'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['completeCastSpell'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['passPriority'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['nextTurn'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['nextStep'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['skipToPhase'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['adjustLife'](undefined as any))).resolves.toBeUndefined();
    expect(() => handlers['setLife'](undefined as any)).not.toThrow();
    expect(() => handlers['mill'](undefined as any)).not.toThrow();
    expect(() => handlers['setHouseRules'](undefined as any)).not.toThrow();
    expect(() => handlers['equipAbility'](undefined as any)).not.toThrow();
    expect(() => handlers['foretellCard'](undefined as any)).not.toThrow();
    expect(() => handlers['castForetold'](undefined as any)).not.toThrow();
    expect(() => handlers['targetSelectionCancel'](undefined as any)).not.toThrow();
    expect(() => handlers['requestGraveyardTargets'](undefined as any)).not.toThrow();
    expect(() => handlers['requestOpponentSelection'](undefined as any)).not.toThrow();
    await expect(Promise.resolve().then(() => handlers['requestSacrificeSelection'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['getCostReductions'](undefined as any))).resolves.toBeUndefined();
    expect(() => handlers['phaseOutPermanents'](undefined as any)).not.toThrow();
    expect(() => handlers['changePermanentControl'](undefined as any)).not.toThrow();
    await expect(Promise.resolve().then(() => handlers['setTriggerShortcut'](undefined as any))).resolves.toBeUndefined();
    expect(() => handlers['getTriggerShortcut'](undefined as any)).not.toThrow();
  });
});
