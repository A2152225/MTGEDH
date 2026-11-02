import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

type Emitted = Array<{ room?: string; event: string; payload: any }>;

function createMockIo(emitted: Emitted, sockets: any[]) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => { emitted.push({ room, event, payload }); } }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Emitted, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: playerId + '_socket',
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    to: (room: string) => ({ emit: (event: string, payload: any) => { emitted.push({ room, event, payload }); } }),
  } as any;
  return { socket, handlers };
}

const gameId = 'test_cancel_player_initiated_x_steps';
const playerId = 'p1';
const opponentId = 'p2';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function land(id: string, name: string, color: string) {
  return {
    id, controller: playerId, owner: playerId, tapped: false,
    card: { name, type_line: 'Basic Land - ' + name, oracle_text: '{T}: Add {' + color + '}.' },
  };
}

function setup(hand: any[], extraBattlefield: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const s = game.state as any;
  s.players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  s.startingLife = 40;
  s.life = { [playerId]: 40, [opponentId]: 40 };
  s.phase = 'precombatMain';
  s.step = 'MAIN1';
  s.turnPlayer = playerId;
  s.activePlayer = playerId;
  s.priority = playerId;
  s.stack = [];
  s.manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  s.battlefield = [
    land('mountain_1', 'Mountain', 'R'),
    land('mountain_2', 'Mountain', 'R'),
    land('mountain_3', 'Mountain', 'R'),
    {
      id: 'opp_artifact', controller: opponentId, owner: opponentId, tapped: false,
      card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
    },
    ...extraBattlefield,
  ];
  s.zones = {
    [playerId]: { hand, handCount: hand.length, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };
  const emitted: Emitted = [];
  const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
  const io = createMockIo(emitted, [socket]);
  registerResolutionHandlers(io as any, socket as any);
  registerGameActions(io as any, socket as any);
  registerInteractionHandlers(io as any, socket as any);
  return { game, s, emitted, handlers };
}

function expectNothingCommitted(s: any, cardId: string | null) {
  if (cardId) {
    expect((s.zones[playerId].hand || []).map((c: any) => c.id)).toContain(cardId);
    expect((s.zones[playerId].graveyard || []).length).toBe(0);
  }
  expect(s.stack || []).toHaveLength(0);
  expect(s.battlefield.filter((p: any) => p.controller === playerId && p.tapped)).toHaveLength(0);
  const pool = s.manaPool?.[playerId] || {};
  expect(Object.values(pool).reduce((a: number, b: any) => a + Number(b || 0), 0)).toBe(0);
  expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  expect(s.priority).toBe(playerId);
}

const FIREBALL = {
  id: 'blaze_1', name: 'Blaze', mana_cost: '{X}{R}', manaCost: '{X}{R}', type_line: 'Sorcery',
  oracle_text: 'Blaze deals X damage to any target.',
};
const SPREE = {
  id: 'spree_1', name: 'Shattering Spree', mana_cost: '{R}', manaCost: '{R}', type_line: 'Sorcery',
  oracle_text: 'Replicate {R} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)\nDestroy target artifact.',
};

describe('cancelling player-initiated required X steps (integration)', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame();
  });
  afterEach(async () => { await resetGame(); });

  it('cast-time Choose X can be cancelled via cancelResolutionStep and submitResolutionResponse', async () => {
    for (const path of ['cancelResolutionStep', 'submitResolutionResponse'] as const) {
      await resetGame();
      const { s, emitted, handlers } = setup([{ ...FIREBALL }]);
      await handlers['requestCastSpell']({ gameId, cardId: 'blaze_1' });
      const xStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st.spellCastXSelection === true) as any;
      expect(xStep).toBeDefined();
      expect(xStep.mandatory).toBe(true);
      if (path === 'cancelResolutionStep') {
        await handlers['cancelResolutionStep']({ gameId, stepId: String(xStep.id) });
      } else {
        await handlers['submitResolutionResponse']({ gameId, stepId: String(xStep.id), selections: [], cancelled: true });
      }
      expect(emitted.find((e) => e.event === 'error' && e.payload?.code === 'STEP_MANDATORY')).toBeUndefined();
      expect(emitted.some((e) => e.event === 'resolutionStepCancelled')).toBe(true);
      expectNothingCommitted(s, 'blaze_1');

      // The card can be cast again afterwards.
      await handlers['requestCastSpell']({ gameId, cardId: 'blaze_1' });
      expect(ResolutionQueueManager.getQueue(gameId).steps.some((st: any) => st.spellCastXSelection === true)).toBe(true);
    }
  });

  it('Replicate count can be cancelled via cancelResolutionStep and submitResolutionResponse', async () => {
    for (const path of ['cancelResolutionStep', 'submitResolutionResponse'] as const) {
      await resetGame();
      const { s, emitted, handlers } = setup([{ ...SPREE }]);
      await handlers['requestCastSpell']({ gameId, cardId: 'spree_1' });
      const rStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st.spellCastReplicateSelection === true) as any;
      expect(rStep).toBeDefined();
      if (path === 'cancelResolutionStep') {
        await handlers['cancelResolutionStep']({ gameId, stepId: String(rStep.id) });
      } else {
        await handlers['submitResolutionResponse']({ gameId, stepId: String(rStep.id), selections: 0, cancelled: true });
      }
      expect(emitted.find((e) => e.event === 'error' && e.payload?.code === 'STEP_MANDATORY')).toBeUndefined();
      expectNothingCommitted(s, 'spree_1');
    }
  });

  it('planeswalker +X/-X can be cancelled before loyalty is paid', async () => {
    for (const path of ['cancelResolutionStep', 'submitResolutionResponse'] as const) {
      await resetGame();
      const pw = {
        id: 'pw_1', controller: playerId, owner: playerId, tapped: false,
        counters: { loyalty: 5 }, loyalty: 5,
        card: {
          name: 'Test Walker', type_line: 'Legendary Planeswalker - Test', loyalty: '5',
          oracle_text: '\u2212X: Test Walker deals X damage to each opponent.\n+1: You gain 1 life.',
        },
      };
      const { s, emitted, handlers } = setup([], [pw]);
      await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'pw_1', abilityId: 'pw-ability-0' });
      expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload)).toEqual([]);
      const xStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st.planeswalkerLoyaltyX === true) as any;
      expect(xStep).toBeDefined();
      if (path === 'cancelResolutionStep') {
        await handlers['cancelResolutionStep']({ gameId, stepId: String(xStep.id) });
      } else {
        await handlers['submitResolutionResponse']({ gameId, stepId: String(xStep.id), selections: [], cancelled: true });
      }
      expect(emitted.find((e) => e.event === 'error' && e.payload?.code === 'STEP_MANDATORY')).toBeUndefined();
      const after = s.battlefield.find((p: any) => p.id === 'pw_1');
      expect(after.counters.loyalty).toBe(5);
      expect(after.loyaltyActivationsThisTurn || 0).toBe(0);
      expect(s.life[opponentId]).toBe(40);
      expectNothingCommitted(s, null);
    }
  });
});
