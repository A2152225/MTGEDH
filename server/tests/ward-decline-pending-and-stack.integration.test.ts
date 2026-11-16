import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

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
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

type WardKind = 'life' | 'discard' | 'sacrifice';

const WARD_ORACLE: Record<WardKind, { cost: string; oracle: string; amount?: number }> = {
  life: { cost: 'Pay 3 life', oracle: 'Ward—Pay 3 life', amount: 3 },
  discard: { cost: 'Discard a card', oracle: 'Ward—Discard a card' },
  sacrifice: { cost: 'Sacrifice a permanent', oracle: 'Ward—Sacrifice a permanent' },
};

function creature(kind: WardKind) {
  return {
    id: 'ward_creature',
    controller: 'p2',
    tapped: false,
    card: {
      name: 'Warded Bear',
      type_line: 'Creature — Bear',
      oracle_text: WARD_ORACLE[kind].oracle,
    },
  };
}

describe('life/discard/sacrifice ward decline on pending casts and on the stack', () => {
  const gameId = 'test_ward_decline_pending_and_stack';
  const casterId = 'p1';
  const defenderId = 'p2';

  async function resetGame() {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { await resetGame(); });
  afterEach(async () => { await resetGame(); });

  function setupPendingCastBoard(kind: WardKind) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, casterId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [
      { id: casterId, name: 'Caster', spectator: false, life: 40 },
      { id: defenderId, name: 'Defender', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [casterId]: 40, [defenderId]: 40 };
    (game.state as any).stack = [];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = casterId;
    (game.state as any).priority = casterId;
    (game.state as any).manaPool = {
      [casterId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [defenderId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      creature(kind),
      ...(kind === 'sacrifice' ? [{
        id: 'food_1',
        controller: casterId,
        card: { name: 'Food Token', type_line: 'Artifact Token — Food', oracle_text: '' },
      }] : []),
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'bolt_1',
            name: 'Lightning Bolt',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
          ...(kind === 'discard' ? [{
            id: 'spare_1',
            name: 'Island',
            mana_cost: '',
            type_line: 'Basic Land — Island',
            oracle_text: '',
          }] : []),
        ],
        handCount: kind === 'discard' ? 2 : 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    return game;
  }

  for (const kind of ['life', 'discard', 'sacrifice'] as WardKind[]) {
    it(`declining a pending ${kind} ward counters the pending spell and leaves the ward creature`, async () => {
      const game = setupPendingCastBoard(kind);
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
        selections: ['ward_creature'],
      });

      const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) =>
        entry.wardPayment === true && String(entry.wardPaymentType || '') === kind
      ) as any;
      expect(wardStep).toBeDefined();
      expect(String(wardStep.wardCost || '')).toMatch(new RegExp(WARD_ORACLE[kind].cost, 'i'));

      const pendingKey = String(wardStep.wardTriggeredBy || targetStep.sourceId || '');
      expect((game.state as any).pendingSpellCasts?.[pendingKey]).toBeDefined();

      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(wardStep.id),
        playerId: casterId,
        selections: ['decline_ward_cost'],
      });

      expect((game.state as any).pendingSpellCasts?.[pendingKey]).toBeUndefined();
      expect((game.state as any).battlefield.some((entry: any) => entry.id === 'ward_creature')).toBe(true);
      expect(((game.state as any).stack || []).some((item: any) => String(item?.id || '') === pendingKey)).toBe(false);
      const spellPaymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) =>
        entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true
      );
      expect(spellPaymentStep).toBeUndefined();
      const declineChat = emitted.find((event) => event.event === 'chat' && /declined to pay ward/i.test(String(event.payload?.message || '')));
      expect(declineChat).toBeTruthy();
      expect(String(declineChat?.payload?.message || '')).toMatch(/countered/i);
      if (kind === 'life') {
        expect(Number((game.state as any).life[casterId])).toBe(40);
      }
    });

    it(`declining an on-stack ${kind} ward counters the stack item and leaves the ward creature`, async () => {
      const game = setupPendingCastBoard(kind);
      const emitted: Array<{ room?: string; event: string; payload: any }> = [];
      const { socket, handlers } = createMockSocket(casterId, emitted, gameId);
      const io = createMockIo(emitted, [socket]);
      registerResolutionHandlers(io as any, socket as any);

      const stackId = `spell_ward_${kind}_1`;
      (game.state as any).stack = [{
        id: stackId,
        type: 'spell',
        controller: casterId,
        card: { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
        canBeCountered: true,
        targets: ['ward_creature'],
      }];

      const spec = WARD_ORACLE[kind];
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: casterId as any,
        sourceId: stackId,
        sourceName: 'Lightning Bolt',
        description: `Warded Bear has ward—${spec.cost}. Pay ${spec.cost} or the spell/ability will be countered.`,
        mandatory: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'pay_ward_cost', label: `Pay ${spec.cost}` },
          { id: 'decline_ward_cost', label: 'Decline (counter)' },
        ],
        wardPayment: true,
        wardPaymentType: kind,
        wardCost: spec.cost,
        ...(kind === 'life' ? { wardLifeAmount: spec.amount } : {}),
        ...(kind === 'discard' ? { wardDiscardCount: 1 } : {}),
        ...(kind === 'sacrifice' ? { wardSacrificeCount: 1, wardSacrificeKind: 'permanent' } : {}),
        wardPermanentId: 'ward_creature',
        wardPermanentName: 'Warded Bear',
        wardPermanentController: defenderId,
        wardTriggeredBy: stackId,
      } as any);

      const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) =>
        entry.wardPayment === true && String(entry.wardPaymentType || '') === kind
      ) as any;
      expect(wardStep).toBeDefined();

      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(wardStep.id),
        playerId: casterId,
        selections: ['decline_ward_cost'],
      });

      expect(((game.state as any).stack || []).some((item: any) => String(item?.id || '') === stackId)).toBe(false);
      expect((game.state as any).battlefield.some((entry: any) => entry.id === 'ward_creature')).toBe(true);
      const declineChat = emitted.find((event) => event.event === 'chat' && /declined to pay ward/i.test(String(event.payload?.message || '')));
      expect(declineChat).toBeTruthy();
      expect(String(declineChat?.payload?.message || '')).toMatch(/countered/i);
    });
  }
});
