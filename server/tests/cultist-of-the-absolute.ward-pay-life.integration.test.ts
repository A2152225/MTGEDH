import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';
import { getPermanentWardCost } from '../src/state/modules/faceDownWardKeyword.js';
import { extractWardCostText } from '../src/state/modules/grantedWardCostFromBattlefield.js';

const CULTIST = 'Commander creatures you own get +3/+3 and have flying, deathtouch, "Ward—Pay 3 life," and "At the beginning of your upkeep, sacrifice a creature."';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}


describe('Cultist of the Absolute granted Ward—Pay 3 life', () => {
  const gameId = 'test_cultist_of_the_absolute_ward_pay_life';
  const casterId = 'p1';
  const defenderId = 'p2';

  beforeAll(async () => {
    await initDb();
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('extracts the quoted ward—pay 3 life grant and surfaces it on a commander you own', () => {
    expect(extractWardCostText(CULTIST)).toBe('Pay 3 life');
    const commander = {
      id: 'cmdr_1',
      controller: defenderId,
      owner: defenderId,
      isCommander: true,
      card: { name: 'Command Tower', type_line: 'Creature — Human Advisor', oracle_text: 'Vigilance' },
    };
    const state = {
      battlefield: [
        commander,
        {
          id: 'cultist_1',
          controller: defenderId,
          owner: defenderId,
          card: { name: 'Cultist of the Absolute', type_line: 'Legendary Enchantment — Background', oracle_text: CULTIST },
        },
      ],
    };
    expect(getPermanentWardCost(commander, state)).toBe('Pay 3 life');
  });

  it('queues a payable life ward prompt for the opponent and deducts 3 life when paid', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, casterId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: casterId, name: 'Caster', spectator: false, life: 40 },
      { id: defenderId, name: 'Defender', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [casterId]: 40, [defenderId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = casterId;
    (game.state as any).priority = casterId;
    (game.state as any).manaPool = {
      [casterId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      [defenderId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'cmdr_1',
        controller: defenderId,
        owner: defenderId,
        isCommander: true,
        card: {
          name: 'Arahbo, Roar of the World',
          type_line: 'Legendary Creature — Cat Avatar',
          oracle_text: 'Vigilance',
        },
      },
      {
        id: 'cultist_1',
        controller: defenderId,
        owner: defenderId,
        card: {
          name: 'Cultist of the Absolute',
          type_line: 'Legendary Enchantment — Background',
          oracle_text: CULTIST,
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [{
          id: 'bolt_1',
          name: 'Lightning Bolt',
          mana_cost: '{R}',
          manaCost: '{R}',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'bolt_1' });
    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['cmdr_1'],
    });

    const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) =>
      entry.wardPayment === true && String(entry.wardPaymentType || '') === 'life'
    ) as any;
    expect(wardStep).toBeDefined();
    expect(Number(wardStep.wardLifeAmount)).toBe(3);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(wardStep.id),
      playerId: casterId,
      selections: ['pay_ward_cost'],
    });

    expect(Number((game.state as any).life[casterId])).toBe(37);
    const triggeredBy = String(wardStep.wardTriggeredBy || wardStep.sourceId || '');
    const onStack = ((game.state as any).stack || []).some((item: any) => String(item?.id || '') === triggeredBy);
    const pending = Boolean((game.state as any).pendingSpellCasts?.[triggeredBy]);
    expect(onStack || pending).toBe(true);
    const paidChat = emitted.find((event) => event.event === 'chat' && /paid ward/i.test(String(event.payload?.message || '')));
    expect(paidChat).toBeTruthy();
  });
});
