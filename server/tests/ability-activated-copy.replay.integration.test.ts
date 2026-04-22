import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
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

function toReplayEvents(gameId: string, startIndex = 0) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
}

function seedTradeRelayCopyBoard(game: any, playerId: string, opponentId: string) {
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).manaPool = {
    [playerId]: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 4,
    },
    [opponentId]: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'rings_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'rings_card_1',
        name: 'Rings of Brighthearth',
        oracle_text: 'Whenever you activate an ability, if it is not a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
        type_line: 'Legendary Artifact',
      },
    },
    {
      id: 'trade_relay_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'trade_relay_card_1',
        name: 'Trade Relay',
        oracle_text: '{2}, {T}: Exchange control of two target permanents that share a card type.',
        type_line: 'Artifact',
      },
    },
    {
      id: 'player_relic_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'player_relic_card_1',
        name: 'Player Relic',
        type_line: 'Artifact',
      },
    },
    {
      id: 'opponent_relic_1',
      controller: opponentId,
      owner: opponentId,
      tapped: false,
      card: {
        id: 'opponent_relic_card_1',
        name: 'Opponent Relic',
        type_line: 'Artifact',
      },
    },
    {
      id: 'player_bear_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      card: {
        id: 'player_bear_card_1',
        name: 'Player Bear',
        type_line: 'Creature — Bear',
      },
    },
    {
      id: 'opponent_bear_1',
      controller: opponentId,
      owner: opponentId,
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      card: {
        id: 'opponent_bear_card_1',
        name: 'Opponent Bear',
        type_line: 'Creature — Bear',
      },
    },
  ];
  (game.state as any).stack = [];
}

function seedDirectCopyRetargetBoard(game: any, playerId: string) {
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: 'player_2', name: 'P2', spectator: false, life: 40 },
    { id: 'player_3', name: 'P3', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, player_2: 40, player_3: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).manaPool = {
    [playerId]: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'artifact_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'artifact_card_1',
        name: 'Chromatic Sphere',
        type_line: 'Artifact',
      },
    },
    {
      id: 'bracers_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      attachedTo: 'artifact_1',
      card: {
        id: 'bracers_card_1',
        name: "Illusionist's Bracers",
        type_line: 'Artifact — Equipment',
      },
    },
  ];
  (game.state as any).stack = [
    {
      id: 'ability_1',
      type: 'ability',
      controller: playerId,
      source: 'artifact_1',
      sourceName: 'Chromatic Sphere',
      description: 'Deal 1 damage to any target.',
      abilityType: 'test_ability',
      targets: ['player_2'],
      copyRetargetValidTargets: [
        { id: 'player_2', name: 'P2', type: 'player', life: 40, isOpponent: true },
        { id: 'player_3', name: 'P3', type: 'player', life: 40, isOpponent: true },
      ],
      copyRetargetTargetTypes: ['player'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: 'target player',
    },
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'bracers_1',
      sourceName: "Illusionist's Bracers",
      description: 'Copy that ability. You may choose new targets for the copy.',
      effect: 'Whenever an ability of equipped creature is activated, if it is not a mana ability, copy that ability. You may choose new targets for the copy.',
      triggerType: 'ability_activated',
      mandatory: false,
      triggeringStackItemId: 'ability_1',
      activatedAbilityIsManaAbility: false,
    },
  ];
}

describe('ability-activated copy replay integration', () => {
  const gameId = 'test_ability_activated_copy_replay_integration';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('replays copied multi-target shared-type exchange activations with a retargeted copy', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTradeRelayCopyBoard(game, playerId, opponentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'trade_relay_1',
      abilityId: 'trade_relay_1-ability-0',
    });

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true && String((queuedStep as any).permanentId || queuedStep.sourceId) === 'trade_relay_1');
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['player_relic_1', 'opponent_relic_1'],
      cancelled: false,
    });

    game.resolveTopOfStack();

    const payStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).optionalPaymentPrompt === true);
    expect(payStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((payStep as any).id),
      selections: ['pay'],
      cancelled: false,
    });

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).retargetAbilityCopy === true);
    expect(retargetChoiceStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetChoiceStep as any).id),
      selections: ['retarget'],
      cancelled: false,
    });

    const retargetTargetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).retargetAbilityCopyTargetSelection === true);
    expect(retargetTargetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetTargetStep as any).id),
      selections: ['player_bear_1', 'opponent_bear_1'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['activateBattlefieldAbility', 'pushTriggeredAbility', 'copyTriggeredAbilityResolve', 'retargetAbilityCopyResolve']),
    );

    const replayGame = createInitialGameState(`${gameId}_replay`);
    seedTradeRelayCopyBoard(replayGame, playerId, opponentId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    if (typeof replayGame.resolveTopOfStack !== 'function') {
      throw new Error('replayGame.resolveTopOfStack is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);

    const replayOriginalAbility = ((replayGame.state as any).stack || []).find((item: any) => !item.copiedFromStackItemId);
    const replayCopiedAbility = ((replayGame.state as any).stack || []).find((item: any) => item.copiedFromStackItemId);
    expect(replayOriginalAbility).toBeDefined();
    expect(replayCopiedAbility).toBeDefined();
    expect(replayOriginalAbility?.targets).toEqual(['player_relic_1', 'opponent_relic_1']);
    expect(replayCopiedAbility?.targets).toEqual(['player_bear_1', 'opponent_bear_1']);
    expect(replayCopiedAbility?.copiedFromStackItemId).toBe(replayOriginalAbility?.id);
    expect(Number((replayGame.state as any).manaPool[playerId]?.colorless || 0)).toBe(0);
    expect(ResolutionQueueManager.getQueue(`${gameId}_replay`).steps).toEqual([]);

    replayGame.resolveTopOfStack();

    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'player_bear_1')?.controller).toBe(opponentId);
    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'opponent_bear_1')?.controller).toBe(playerId);

    replayGame.resolveTopOfStack();

    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'player_relic_1')?.controller).toBe(opponentId);
    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'opponent_relic_1')?.controller).toBe(playerId);
  });

  it('replays declining the optional copy payment without leaving the trigger on the stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTradeRelayCopyBoard(game, playerId, opponentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'trade_relay_1',
      abilityId: 'trade_relay_1-ability-0',
    });

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true && String((queuedStep as any).permanentId || queuedStep.sourceId) === 'trade_relay_1');
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['player_relic_1', 'opponent_relic_1'],
      cancelled: false,
    });

    game.resolveTopOfStack();

    const payStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).optionalPaymentPrompt === true);
    expect(payStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((payStep as any).id),
      selections: ['decline'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(1);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['activateBattlefieldAbility', 'pushTriggeredAbility', 'copyTriggeredAbilityResolve']),
    );
    expect(replayEvents.map((event: any) => event.type)).not.toContain('retargetAbilityCopyResolve');
    expect(replayEvents.find((event: any) => event.type === 'copyTriggeredAbilityResolve')?.paid).toBe(false);

    const replayGame = createInitialGameState(`${gameId}_replay_decline`);
    seedTradeRelayCopyBoard(replayGame, playerId, opponentId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    if (typeof replayGame.resolveTopOfStack !== 'function') {
      throw new Error('replayGame.resolveTopOfStack is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(1);
    expect(((replayGame.state as any).stack || [])[0]?.targets).toEqual(['player_relic_1', 'opponent_relic_1']);
    expect(Number((replayGame.state as any).manaPool[playerId]?.colorless || 0)).toBe(2);
    expect(ResolutionQueueManager.getQueue(`${gameId}_replay_decline`).steps).toEqual([]);

    replayGame.resolveTopOfStack();

    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'player_relic_1')?.controller).toBe(opponentId);
    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'opponent_relic_1')?.controller).toBe(playerId);
  });

  it('replays keeping current targets without leaving the copy-retarget prompt queued', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTradeRelayCopyBoard(game, playerId, opponentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'trade_relay_1',
      abilityId: 'trade_relay_1-ability-0',
    });

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true && String((queuedStep as any).permanentId || queuedStep.sourceId) === 'trade_relay_1');
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['player_relic_1', 'opponent_relic_1'],
      cancelled: false,
    });

    game.resolveTopOfStack();

    const payStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).optionalPaymentPrompt === true);
    expect(payStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((payStep as any).id),
      selections: ['pay'],
      cancelled: false,
    });

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).retargetAbilityCopy === true);
    expect(retargetChoiceStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetChoiceStep as any).id),
      selections: ['keep'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    expect(((game.state as any).stack || [])[1]?.targets).toEqual(['player_relic_1', 'opponent_relic_1']);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const replayGameId = `${gameId}_replay_keep`;
    const replayGame = createInitialGameState(replayGameId);
    seedTradeRelayCopyBoard(replayGame, playerId, opponentId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayCopiedAbility = ((replayGame.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(replayCopiedAbility?.targets).toEqual(['player_relic_1', 'opponent_relic_1']);
    expect(Number((replayGame.state as any).manaPool[playerId]?.colorless || 0)).toBe(0);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toEqual([]);
  });

  it('replays direct-copy retarget flows with the copied stack item intact', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedDirectCopyRetargetBoard(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;

    game.resolveTopOfStack();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).retargetAbilityCopy === true);
    expect(retargetChoiceStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetChoiceStep as any).id),
      selections: ['retarget'],
      cancelled: false,
    });

    const retargetTargetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).retargetAbilityCopyTargetSelection === true);
    expect(retargetTargetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetTargetStep as any).id),
      selections: ['player_3'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    expect(((game.state as any).stack || [])[1]?.targets).toEqual(['player_3']);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['copyTriggeredAbilityResolve', 'retargetAbilityCopyResolve']),
    );

    const replayGame = createInitialGameState(`${gameId}_replay_direct_copy`);
    seedDirectCopyRetargetBoard(replayGame, playerId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayCopiedAbility = ((replayGame.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId === 'ability_1');
    expect(replayCopiedAbility).toBeDefined();
    expect(replayCopiedAbility?.targets).toEqual(['player_3']);
    expect(ResolutionQueueManager.getQueue(`${gameId}_replay_direct_copy`).steps).toEqual([]);
  });
});