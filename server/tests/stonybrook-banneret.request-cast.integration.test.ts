import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function setupBanneretCastScenario(options: {
  gameId: string;
  banneretCard: any;
  spellCard: any;
}) {
  const p1 = 'p1';

  ResolutionQueueManager.removeQueue(options.gameId);
  games.delete(options.gameId as any);
  createGameIfNotExists(options.gameId, 'commander', 40, undefined, p1);
  const game = ensureGame(options.gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [p1]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).priority = p1;
  (game.state as any).battlefield = [
    {
      id: 'banneret',
      controller: p1,
      owner: p1,
      tapped: false,
      card: options.banneretCard,
    },
  ];
  (game.state as any).zones = {
    [p1]: {
      hand: [options.spellCard],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };

  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket({ playerId: p1, gameId: options.gameId }, emitted);
  socket.rooms.add(options.gameId);
  const io = createNoopIo();
  (io as any).emit = (event: string, payload: any) => emitted.push({ event, payload });
  (io as any).to = (room: string) => ({
    emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
  });

  registerGameActions(io as any, socket as any);

  return { handlers };
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
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

describe('Banneret request-cast flow (integration)', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue('test_stonybrook_banneret_request_cast');
    ResolutionQueueManager.removeQueue('test_ballyrush_banneret_request_cast');
    games.delete('test_stonybrook_banneret_request_cast' as any);
    games.delete('test_ballyrush_banneret_request_cast' as any);
  });

  it('reduces Merfolk/Wizard spell payment by {1} in the queued mana payment step', async () => {
    const gameId = 'test_stonybrook_banneret_request_cast';
    const { handlers } = setupBanneretCastScenario({
      gameId,
      banneretCard: {
        name: 'Stonybrook Banneret',
        type_line: 'Creature — Merfolk Wizard',
        oracle_text: 'Islandwalk Merfolk spells and Wizard spells you cast cost {1} less to cast.',
        image_uris: { small: 'https://example.com/banneret.jpg' },
      },
      spellCard: {
        id: 'judge-card',
        name: 'Judge of Currents',
        mana_cost: '{1}{W}',
        manaCost: '{1}{W}',
        type_line: 'Creature — Merfolk Wizard',
        oracle_text: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
        image_uris: { small: 'https://example.com/judge.jpg' },
      },
    });

    await handlers['requestCastSpell']({ gameId, cardId: 'judge-card' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);

    const paymentStep = queue.steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.cardName).toBe('Judge of Currents');
    expect(paymentStep.manaCost).toBe('{W}');
    expect(paymentStep.costReduction).toMatchObject({
      generic: 1,
    });
    expect(paymentStep.costReduction?.messages).toContain('Stonybrook Banneret: -{1}');
  });

  it('reduces other Banneret subtype pairs without hardcoded Stonybrook logic', async () => {
    const gameId = 'test_ballyrush_banneret_request_cast';
    const { handlers } = setupBanneretCastScenario({
      gameId,
      banneretCard: {
        name: 'Ballyrush Banneret',
        type_line: 'Creature — Kithkin Soldier',
        oracle_text: 'Kithkin spells and Soldier spells you cast cost {1} less to cast.',
        image_uris: { small: 'https://example.com/ballyrush.jpg' },
      },
      spellCard: {
        id: 'cenns-heir-card',
        name: "Cenn's Heir",
        mana_cost: '{1}{W}',
        manaCost: '{1}{W}',
        type_line: 'Creature — Kithkin Soldier',
        oracle_text: "Whenever Cenn's Heir attacks, it gets +1/+1 until end of turn for each other attacking Kithkin.",
        image_uris: { small: 'https://example.com/cenns-heir.jpg' },
      },
    });

    await handlers['requestCastSpell']({ gameId, cardId: 'cenns-heir-card' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);

    const paymentStep = queue.steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.cardName).toBe("Cenn's Heir");
    expect(paymentStep.manaCost).toBe('{W}');
    expect(paymentStep.costReduction).toMatchObject({
      generic: 1,
    });
    expect(paymentStep.costReduction?.messages).toContain('Ballyrush Banneret: -{1}');
  });
});