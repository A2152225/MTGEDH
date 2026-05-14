import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { buildPendingCastCostMetadata, registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
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
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

function seedHand(gameId: string, playerId: string, deck: any[]) {
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).active = true;
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };

  let seq = 0;
  const seedEvents = [
    { type: 'deckImportResolved', payload: { playerId, cards: deck } },
    { type: 'drawCards', payload: { playerId, count: 1 } },
  ];

  for (const event of seedEvents) {
    appendEvent(gameId, seq++, event.type, event.payload);
    game.applyEvent({ type: event.type, ...event.payload } as any);
  }

  return game;
}

function queueDiscardStep(gameId: string, playerId: string, hand: any[]) {
  return ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DISCARD_SELECTION,
    playerId: playerId as any,
    description: 'Discard a card.',
    sourceName: 'Oskar Test',
    sourceId: 'oskar_test_source',
    mandatory: true,
    discardCount: 1,
    hand: hand.map((card: any) => ({ ...card })),
    destination: 'graveyard',
  } as any);
}

const OSKAR_CARD = {
  id: 'oskar_card',
  name: 'Oskar, Rubbish Reclaimer',
  mana_cost: '{3}{U}{B}',
  manaCost: '{3}{U}{B}',
  type_line: 'Legendary Creature — Human Wizard',
  oracle_text: "This spell costs {1} less to cast for each different mana value among cards in your graveyard.\nWhenever you discard a nonland card, you may cast it from your graveyard.",
  power: '3',
  toughness: '3',
};

describe('Oskar, Rubbish Reclaimer', () => {
  const baseGameId = 'test_oskar_rubbish_reclaimer';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(`${baseGameId}_cast`);
    await resetGame(`${baseGameId}_land`);
    await resetGame(`${baseGameId}_replay`);
  });

  afterEach(async () => {
    await resetGame(`${baseGameId}_cast`);
    await resetGame(`${baseGameId}_land`);
    await resetGame(`${baseGameId}_replay`);
  });

  it('applies Oskar cost reduction from the command zone', () => {
    const metadata = buildPendingCastCostMetadata(
      {
        state: {
          zones: {
            p1: {
              graveyard: [
                { id: 'land_1', name: 'Island', type_line: 'Basic Land — Island' },
                { id: 'spell_1', name: 'Opt', mana_cost: '{U}', type_line: 'Instant' },
                { id: 'spell_2', name: 'Counterspell', mana_cost: '{U}{U}', type_line: 'Instant' },
                { id: 'spell_3', name: 'Cancel', mana_cost: '{1}{U}{U}', type_line: 'Instant' },
              ],
            },
          },
        },
      },
      'p1',
      { ...OSKAR_CARD },
      'command',
    );

    expect(metadata.costReduction.generic).toBe(4);
    expect(metadata.costReduction.messages).toContain('Oskar, Rubbish Reclaimer: -{4} (4 different mana values in graveyard)');
  });

  it('triggers on nonland discard and lets you cast the discarded card from your graveyard immediately', async () => {
    const gameId = `${baseGameId}_cast`;
    const playerId = 'p1';
    const opponentId = 'p2';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const memnite = {
      id: 'memnite_1',
      name: 'Memnite',
      mana_cost: '{0}',
      manaCost: '{0}',
      type_line: 'Artifact Creature — Construct',
      oracle_text: '',
      power: '1',
      toughness: '1',
      zone: 'library',
    };
    const game = seedHand(gameId, playerId, [memnite]);
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_ATTACKERS';
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = opponentId;
    (game.state as any).battlefield = [
      {
        id: 'oskar_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { ...OSKAR_CARD },
      },
    ];
    (game.state as any).stack = [];

    const hand = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => ({ ...card }));
    queueDiscardStep(gameId, playerId, hand);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['memnite_1'],
    });

    const triggerItem = ((game.state as any).stack || []).find((item: any) => item?.effectData?.discardTriggeredCastFromGraveyard === true) as any;
    expect(triggerItem).toBeDefined();
    expect(triggerItem.effectData.discardedCardId).toBe('memnite_1');

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const castPrompt = (queue.steps || []).find((step: any) => String((step as any)?.castFromGraveyardCardId || '') === 'memnite_1') as any;
    expect(castPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castPrompt.id),
      selections: 'cast',
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = (queue.steps || []).find((step: any) => step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'memnite_1') as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const errors = emitted.filter((event) => event.event === 'error').map((event) => event.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');
    expect(errors).not.toContain('INSUFFICIENT_MANA');

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    expect(graveyardIds).not.toContain('memnite_1');
    const stackItem = (((game.state as any).stack || []) as any[]).find((item: any) => String(item?.card?.id || '') === 'memnite_1');
    expect(stackItem?.castFromGraveyard).toBe(true);
    expect(stackItem?.castSourceZone).toBe('graveyard');

    const persistedEvents = getEvents(gameId);
    const resolveEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'castFromGraveyardPromptResolve') as any;
    expect(resolveEvent?.payload?.choice).toBe('cast');
  });

  it('does not trigger on land discard', async () => {
    const gameId = `${baseGameId}_land`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const land = {
      id: 'island_1',
      name: 'Island',
      type_line: 'Basic Land — Island',
      oracle_text: '',
      zone: 'library',
    };
    const game = seedHand(gameId, playerId, [land]);
    (game.state as any).battlefield = [
      {
        id: 'oskar_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { ...OSKAR_CARD },
      },
    ];
    (game.state as any).stack = [];

    const hand = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => ({ ...card }));
    queueDiscardStep(gameId, playerId, hand);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['island_1'],
    });

    expect((((game.state as any).stack || []) as any[]).some((item: any) => item?.effectData?.discardTriggeredCastFromGraveyard === true)).toBe(false);
  });

  it('replays the accepted graveyard cast prompt deterministically', async () => {
    const gameId = `${baseGameId}_replay`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const memnite = {
      id: 'memnite_2',
      name: 'Memnite',
      mana_cost: '{0}',
      manaCost: '{0}',
      type_line: 'Artifact Creature — Construct',
      oracle_text: '',
      power: '1',
      toughness: '1',
      zone: 'library',
    };
    const game = seedHand(gameId, playerId, [memnite]);
    (game.state as any).battlefield = [
      {
        id: 'oskar_perm_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { ...OSKAR_CARD },
      },
    ];
    (game.state as any).stack = [];

    const hand = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => ({ ...card }));
    queueDiscardStep(gameId, playerId, hand);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['memnite_2'],
    });

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const castPrompt = (queue.steps || []).find((step: any) => String((step as any)?.castFromGraveyardCardId || '') === 'memnite_2') as any;
    expect(castPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castPrompt.id),
      selections: 'cast',
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = (queue.steps || []).find((step: any) => step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'memnite_2') as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    const persistedEvents = getEvents(gameId);
    const triggerEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.effectData?.discardTriggeredCastFromGraveyard === true) as any;
    const promptEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'resolveTopOfStackPrompt' && event.payload?.queuedResolutionStep?.castFromGraveyardCardId === 'memnite_2') as any;
    const resolveEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'castFromGraveyardPromptResolve') as any;
    expect(triggerEvent).toBeDefined();
    expect(promptEvent).toBeDefined();
    expect(resolveEvent?.payload?.choice).toBe('cast');

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    queue = ResolutionQueueManager.getQueue(gameId);
    expect((queue.steps || []).some((step: any) => String((step as any)?.castFromGraveyardCardId || '') === 'memnite_2')).toBe(false);

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    expect(graveyardIds).not.toContain('memnite_2');
    const replayedStack = (((game.state as any).stack || []) as any[]).find((item: any) => String(item?.card?.id || '') === 'memnite_2');
    expect(replayedStack?.castFromGraveyard).toBe(true);
    expect(replayedStack?.castSourceZone).toBe('graveyard');
  });
});