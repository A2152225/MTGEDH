import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('Gift cast choice flow', () => {
  const targetingGameId = 'test_gift_cast_choice_targeting';
  const stackGameId = 'test_gift_cast_choice_stack';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(targetingGameId);
    ResolutionQueueManager.removeQueue(stackGameId);
    games.delete(targetingGameId as any);
    games.delete(stackGameId as any);
  });

  it('widens target selection after promising a gift for Long River\'s Pull', async () => {
    createGameIfNotExists(targetingGameId, 'commander', 40);
    const game = ensureGame(targetingGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [
      {
        id: 'stack_creature',
        type: 'spell',
        controller: 'p2',
        card: { id: 'stack_creature_card', name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '' },
      },
      {
        id: 'stack_artifact',
        type: 'spell',
        controller: 'p2',
        card: { id: 'stack_artifact_card', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'long_river_pull_1',
            name: "Long River's Pull",
            mana_cost: '{U}{U}',
            type_line: 'Instant',
            oracle_text: 'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nCounter target creature spell. If the gift was promised, instead counter target spell.',
            image_uris: { small: 'https://example.com/long-river-pull.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, targetingGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: targetingGameId, cardId: 'long_river_pull_1' });

    const giftStep = ResolutionQueueManager.getQueue(targetingGameId).steps[0] as any;
    expect(giftStep.type).toBe('option_choice');
    expect(giftStep.giftCastChoice).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: targetingGameId,
      stepId: String(giftStep.id),
      selections: 'gift:p2',
    });

    const continueEvent = emitted.find((entry) => entry.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.restartCastRequest).toBe(true);

    await handlers['requestCastSpell']({
      gameId: targetingGameId,
      cardId: 'long_river_pull_1',
      fromZone: continueEvent?.payload?.fromZone,
      faceIndex: continueEvent?.payload?.faceIndex,
    });

    const targetStep = ResolutionQueueManager.getQueue(targetingGameId).steps.find((step: any) => step.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    const targetIds = (targetStep.validTargets || []).map((entry: any) => String(entry?.id || ''));
    expect(targetIds).toContain('stack_creature');
    expect(targetIds).toContain('stack_artifact');
  });

  it('persists promised gift metadata onto the spell stack item', async () => {
    createGameIfNotExists(stackGameId, 'commander', 40);
    const game = ensureGame(stackGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'archival_whorl_1',
            name: 'Archival Whorl',
            mana_cost: '{3}{U}{U}',
            type_line: 'Sorcery',
            oracle_text: 'Gift a Rhystic Study\nShuffle your hand and graveyard into your library, then draw seven cards. If the gift wasn\'t promised, each other player also shuffles their hand and graveyard into their library, then draws seven cards.',
            image_uris: { small: 'https://example.com/archival-whorl.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, stackGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: stackGameId, cardId: 'archival_whorl_1' });

    const giftStep = ResolutionQueueManager.getQueue(stackGameId).steps[0] as any;
    await handlers['submitResolutionResponse']({
      gameId: stackGameId,
      stepId: String(giftStep.id),
      selections: 'gift:p2',
    });

    const restartEvent = emitted.find((entry) => entry.event === 'castSpellFromHandContinue');
    await handlers['requestCastSpell']({ gameId: stackGameId, cardId: 'archival_whorl_1', fromZone: restartEvent?.payload?.fromZone });

    const paymentStep = ResolutionQueueManager.getQueue(stackGameId).steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId: stackGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:blue', mana: 'U', count: 2 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 3 },
        ],
      },
    });

    const completeEvent = emitted.find((entry) => entry.event === 'castSpellFromHandContinue');
    expect(completeEvent?.payload?.effectId).toBeDefined();

    emitted.length = 0;
    await handlers['completeCastSpell'](completeEvent?.payload);

    const castError = emitted.find((entry) => entry.event === 'error');
    expect(castError).toBeUndefined();

    const top = ((game.state as any).stack || [])[0] as any;
    expect(top?.card?.name).toBe('Archival Whorl');
    expect(top?.giftPromised).toBe(true);
    expect(top?.giftRecipient).toBe('p2');
    expect(top?.giftType).toBe('a Rhystic Study');
    expect(top?.card?.giftPromised).toBe(true);
  });
});