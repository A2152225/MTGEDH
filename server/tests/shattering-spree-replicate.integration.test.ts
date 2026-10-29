import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

const SHATTERING_SPREE_ORACLE = 'Replicate {R} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)\nDestroy target artifact.';

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
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
  };
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function mountain(id: string, playerId: string) {
  return {
    id,
    controller: playerId,
    owner: playerId,
    tapped: false,
    card: {
      name: 'Mountain',
      type_line: 'Basic Land — Mountain',
      oracle_text: '{T}: Add {R}.',
    },
  };
}

function artifact(id: string, name: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      name,
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
    },
  };
}

describe('Shattering Spree replicate', () => {
  const gameId = 'test_shattering_spree_replicate';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  function setup(mountainCount: number) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      ...Array.from({ length: mountainCount }, (_, index) => mountain(`mountain_${index + 1}`, playerId)),
      artifact('lantern', 'Chromatic Lantern', opponentId),
      artifact('sol_ring', 'Sol Ring', opponentId),
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{
          id: 'spree_1',
          name: 'Shattering Spree',
          mana_cost: '{R}',
          manaCost: '{R}',
          type_line: 'Sorcery',
          oracle_text: SHATTERING_SPREE_ORACLE,
        }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const opponent = createMockSocket(opponentId, emitted, gameId);
    const io = createMockIo(emitted, [socket, opponent.socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, opponent.socket as any);
    registerGameActions(io as any, socket as any);
    registerGameActions(io as any, opponent.socket as any);
    return { game, handlers, opponentHandlers: opponent.handlers, emitted };
  }

  it('asks how many times to pay replicate based on available mana', async () => {
    const { handlers } = setup(3);
    await handlers.requestCastSpell({ gameId, cardId: 'spree_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const replicateStep = queue.steps.find((entry: any) => entry.spellCastReplicateSelection === true) as any;
    expect(replicateStep).toBeDefined();
    expect(replicateStep.type).toBe('x_value_selection');
    expect(replicateStep.minValue).toBe(0);
    expect(replicateStep.maxValue).toBe(2);
    expect(replicateStep.costPerX).toBe('{R}');
    expect(String(replicateStep.description)).toMatch(/Replicate \{R\}/);
  });

  it('pays replicate, copies the spell once per payment, and offers a new target for each copy', async () => {
    const { game, handlers, opponentHandlers, emitted } = setup(3);
    await handlers.requestCastSpell({ gameId, cardId: 'spree_1' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const replicateStep = queue.steps.find((entry: any) => entry.spellCastReplicateSelection === true) as any;
    expect(replicateStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(replicateStep.id),
      selections: { xValue: 2 },
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    expect(String(targetStep.spellCastContext?.manaCost || targetStep.manaCost || '')).toContain('{R}{R}{R}');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['lantern'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((entry: any) => entry.type === 'mana_payment_choice') as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.manaCost).toBe('{R}{R}{R}');

    emitted.length = 0;
    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'mountain_1', mana: 'R', count: 1 },
          { permanentId: 'mountain_2', mana: 'R', count: 1 },
          { permanentId: 'mountain_3', mana: 'R', count: 1 },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const castError = emitted.find((event) => event.event === 'error');
    expect(castError).toBeUndefined();

    const stack = ((game.state as any).stack || []) as any[];
    const spell = stack.find((entry) => entry?.card?.name === 'Shattering Spree' && entry?.type !== 'triggered_ability');
    expect(spell).toBeDefined();
    expect(Number(spell.replicateCount || spell.card?.replicateCount)).toBe(2);
    expect([...(spell.targets || [])]).toEqual(['lantern']);

    const pass = async (playerHandlers: Record<string, Function>, id: string) => {
      if (typeof playerHandlers.passPriority === 'function') {
        await playerHandlers.passPriority({ gameId });
        return;
      }
      if (typeof (game as any).passPriority === 'function') {
        (game as any).passPriority(id);
      }
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const holder = String((game.state as any).priority || '');
      if (holder === opponentId) await pass(opponentHandlers, opponentId);
      else await pass(handlers, playerId);
      queue = ResolutionQueueManager.getQueue(gameId);
      if (queue.steps.some((entry: any) => entry.retargetSpellCopy === true)) break;
    }

    queue = ResolutionQueueManager.getQueue(gameId);
    const retargets = queue.steps.filter((entry: any) => entry.retargetSpellCopy === true);
    expect(retargets.length).toBe(2);
    for (const step of retargets) {
      const ids = ((step as any).retargetSpellCopyValidTargets || []).map((target: any) => target.id);
      expect(ids).toEqual(expect.arrayContaining(['lantern', 'sol_ring']));
    }

    const copies = ((game.state as any).stack || []).filter((entry: any) =>
      entry?.isCopy === true && String(entry?.card?.name || entry?.name || '') === 'Shattering Spree',
    );
    expect(copies.length).toBe(2);
    expect((game.state as any).battlefield.find((permanent: any) => permanent.id === 'lantern')).toBeDefined();
    expect((game.state as any).battlefield.find((permanent: any) => permanent.id === 'sol_ring')).toBeDefined();
  });
});
