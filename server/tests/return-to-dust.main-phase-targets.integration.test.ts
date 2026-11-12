import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import {
  buildSpellTargetSelectionClauses,
  getOwnMainPhaseExtraTargetAugmentation,
} from '../src/socket/game-actions-handlers/gameActionsSpellTargetSelection.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const RETURN_TO_DUST_ORACLE =
  'Exile target artifact or enchantment. If you cast this spell during your main phase, you may exile up to one other target artifact or enchantment.';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[]) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id || socket.data.playerId, socket])) },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId: string,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedReturnToDustBoard(game: any, playerId: string, opponentId: string, timing: {
  phase: string;
  step: string;
  activePlayer: string;
}) {
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = timing.phase;
  (game.state as any).step = timing.step;
  (game.state as any).activePlayer = timing.activePlayer;
  (game.state as any).turnPlayer = timing.activePlayer;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 4, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).battlefield = [
    {
      id: 'aura_shards',
      controller: opponentId,
      owner: opponentId,
      tapped: false,
      card: {
        name: 'Aura Shards',
        type_line: 'Enchantment',
        oracle_text: 'Whenever a creature you control enters, you may destroy target artifact or enchantment.',
      },
    },
    {
      id: 'sol_ring',
      controller: opponentId,
      owner: opponentId,
      tapped: false,
      card: {
        name: 'Sol Ring',
        type_line: 'Artifact',
        oracle_text: '{T}: Add {C}{C}.',
      },
    },
  ];
  (game.state as any).zones = {
    [playerId]: {
      hand: [
        {
          id: 'return_to_dust_1',
          name: 'Return to Dust',
          mana_cost: '{2}{W}{W}',
          manaCost: '{2}{W}{W}',
          type_line: 'Instant',
          oracle_text: RETURN_TO_DUST_ORACLE,
        },
      ],
      handCount: 1,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
    [opponentId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
}

describe('Return to Dust main-phase extra target', () => {
  const gameId = 'test_return_to_dust_main_phase_targets';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('does not split the main-phase bonus into a second target clause', () => {
    const game = {
      state: {
        phase: 'precombatMain',
        step: 'MAIN1',
        activePlayer: playerId,
        battlefield: [],
        players: [{ id: playerId }, { id: opponentId }],
        stack: [],
      },
    };
    expect(buildSpellTargetSelectionClauses(game, playerId, 'Return to Dust', RETURN_TO_DUST_ORACLE)).toEqual([]);
  });

  it('augments cast-time selection to min 1 / max 2 on the caster main phase only', () => {
    const mainPhaseGame = {
      state: {
        phase: 'precombatMain',
        step: 'MAIN1',
        activePlayer: playerId,
      },
    };
    expect(getOwnMainPhaseExtraTargetAugmentation(mainPhaseGame, playerId, RETURN_TO_DUST_ORACLE, 'Return to Dust')).toEqual({
      minTargets: 1,
      maxTargets: 2,
      targetDescription: expect.stringMatching(/artifact or enchantment/i),
    });

    const combatGame = {
      state: {
        phase: 'combat',
        step: 'DECLARE_ATTACKERS',
        activePlayer: playerId,
      },
    };
    expect(getOwnMainPhaseExtraTargetAugmentation(combatGame, playerId, RETURN_TO_DUST_ORACLE, 'Return to Dust')).toBeNull();
  });

  it('queues a single TARGET_SELECTION step with maxTargets 2 during own main phase', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedReturnToDustBoard(game, playerId, opponentId, {
      phase: 'precombatMain',
      step: 'MAIN1',
      activePlayer: playerId,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'return_to_dust_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetSteps).toHaveLength(1);

    const targetStep = targetSteps[0] as any;
    expect(targetStep.minTargets).toBe(1);
    expect(targetStep.maxTargets).toBe(2);
    expect((targetStep.validTargets || []).map((target: any) => target.id).sort()).toEqual(['aura_shards', 'sol_ring']);
  });

  it('keeps a single TARGET_SELECTION step with maxTargets 1 outside main phase', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedReturnToDustBoard(game, playerId, opponentId, {
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      activePlayer: playerId,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'return_to_dust_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetSteps).toHaveLength(1);

    const targetStep = targetSteps[0] as any;
    expect(targetStep.minTargets).toBe(1);
    expect(targetStep.maxTargets).toBe(1);
  });
});
