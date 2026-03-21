import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { createRulesBridge } from '../src/rules-bridge.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { rulesEngine } from '../../rules-engine/src/RulesEngineAdapter.js';
import { makeMerfolkIterationState } from '../../rules-engine/test/helpers/merfolkIterationFixture.js';
import { games } from '../src/socket/socket.js';

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

function seedMerrowChoiceStack(gameId: string) {
  const rulesEngineAny = rulesEngine as any;
  const stacks = rulesEngineAny.stacks as Map<string, any>;
  stacks.set(gameId, {
    objects: [
      {
        id: 'stack-trigger-reejerey-choice',
        spellId: 'merrow-reejerey',
        cardName: 'Merrow Reejerey',
        controllerId: 'p1',
        targets: [],
        timestamp: Date.now(),
        type: 'ability',
        triggerMeta: {
          effectText: 'You may tap or untap target permanent.',
          triggerEventDataSnapshot: {
            sourceId: 'merrow-reejerey',
            sourceControllerId: 'p1',
          },
        },
      },
    ],
  });
}

function seedTargetOpponentChoiceStack(gameId: string) {
  const rulesEngineAny = rulesEngine as any;
  const stacks = rulesEngineAny.stacks as Map<string, any>;
  stacks.set(gameId, {
    objects: [
      {
        id: 'stack-trigger-target-opponent-choice',
        spellId: 'grim-harbinger',
        cardName: 'Grim Harbinger',
        controllerId: 'p1',
        targets: [],
        timestamp: Date.now(),
        type: 'ability',
        triggerMeta: {
          effectText: 'Target opponent loses 1 life.',
          triggerEventDataSnapshot: {
            sourceId: 'grim-harbinger',
            sourceControllerId: 'p1',
          },
        },
      },
    ],
  });
}

describe('RulesBridge choice-required integration', () => {
  const queueGameId = 'test_rules_bridge_choice_required_queue';
  const executeGameId = 'test_rules_bridge_choice_required_execute';
  const declineGameId = 'test_rules_bridge_choice_required_decline';
  const cancelGameId = 'test_rules_bridge_choice_required_cancel';
  const opponentGameId = 'test_rules_bridge_choice_required_opponent';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(queueGameId);
    ResolutionQueueManager.removeQueue(executeGameId);
    ResolutionQueueManager.removeQueue(declineGameId);
    ResolutionQueueManager.removeQueue(cancelGameId);
    ResolutionQueueManager.removeQueue(opponentGameId);
    games.delete(queueGameId as any);
    games.delete(executeGameId as any);
    games.delete(declineGameId as any);
    games.delete(cancelGameId as any);
    games.delete(opponentGameId as any);
  });

  it('enqueues resolution queue steps for unresolved triggered ability choices', () => {
    const gameId = queueGameId;
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(gameId, io);
    const state = makeMerfolkIterationState({ id: gameId } as any);

    bridge.initialize(state as any);
    seedMerrowChoiceStack(gameId);

    const result = bridge.executeAction({ type: 'resolveStack' });
    expect(result.success).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(3);
    expect(queue.steps.map((step: any) => step.type)).toEqual([
      'option_choice',
      'target_selection',
      'option_choice',
    ]);

    const mayStep = queue.steps[0] as any;
    expect(mayStep.mayAbilityPrompt).toBe(true);
    expect(mayStep.effectText).toBe('You may tap or untap target permanent.');
    expect(mayStep.effectKey).toBe('merrow reejerey:you may tap or untap target permanent.');
    expect(mayStep.rulesChoiceGroupId).toBe('stack-trigger-reejerey-choice');
    expect(mayStep.rulesChoiceIndex).toBe(0);
    expect(mayStep.rulesChoiceCount).toBe(3);
    expect(mayStep.rulesTriggerEventData).toMatchObject({
      sourceId: 'merrow-reejerey',
      sourceControllerId: 'p1',
    });
    expect(mayStep.rulesTriggerEffectText).toBe('You may tap or untap target permanent.');
    expect(mayStep.options).toEqual([
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ]);

    const targetStep = queue.steps[1] as any;
    expect(targetStep.validTargets.some((target: any) => target.id === 'nykthos-shrine-to-nyx')).toBe(true);

    const optionStep = queue.steps[2] as any;
    expect(optionStep.options.map((option: any) => option.id)).toEqual(['tap', 'untap']);

    const rulesChoiceEvents = emitted.filter((entry) => entry.event === 'rulesChoiceRequired');
    expect(rulesChoiceEvents).toHaveLength(1);
    expect(rulesChoiceEvents[0]?.payload).toMatchObject({
      gameId,
      choiceGroupId: 'stack-trigger-reejerey-choice',
      sourceName: 'Merrow Reejerey',
      effectText: 'You may tap or untap target permanent.',
      controllerId: 'p1',
      choiceCount: 3,
    });
  });

  it('executes the grouped trigger on the authoritative game state after all queue responses resolve', async () => {
    const gameId = executeGameId;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).state = makeMerfolkIterationState({ id: gameId } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const bridge = createRulesBridge(gameId, io);
    bridge.initialize((game as any).state);
    seedMerrowChoiceStack(gameId);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(3);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((queue.steps[0] as any).id), selections: 'yes' });
    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(2);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((queue.steps[0] as any).id), selections: ['nykthos-shrine-to-nyx'] });
    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);

    const beforeNykthos = ((game as any).state.battlefield || []).find((perm: any) => perm.id === 'nykthos-shrine-to-nyx');
    expect(beforeNykthos?.tapped).toBe(false);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((queue.steps[0] as any).id), selections: 'tap' });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const nykthos = ((game as any).state.battlefield || []).find((perm: any) => perm.id === 'nykthos-shrine-to-nyx');
    expect(nykthos?.tapped).toBe(true);
  });

  it('clears the grouped queue and leaves state unchanged when the MAY choice is declined', async () => {
    const gameId = declineGameId;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).state = makeMerfolkIterationState({ id: gameId } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const bridge = createRulesBridge(gameId, io);
    bridge.initialize((game as any).state);
    seedMerrowChoiceStack(gameId);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(3);

    const beforeNykthos = ((game as any).state.battlefield || []).find((perm: any) => perm.id === 'nykthos-shrine-to-nyx');
    expect(beforeNykthos?.tapped).toBe(false);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((queue.steps[0] as any).id), selections: 'no' });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
    expect(queueSummary.hasPending).toBe(false);

    const nykthos = ((game as any).state.battlefield || []).find((perm: any) => perm.id === 'nykthos-shrine-to-nyx');
    expect(nykthos?.tapped).toBe(false);
  });

  it('clears the grouped queue and leaves state unchanged when the MAY choice is cancelled', async () => {
    const gameId = cancelGameId;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).state = makeMerfolkIterationState({ id: gameId } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const bridge = createRulesBridge(gameId, io);
    bridge.initialize((game as any).state);
    seedMerrowChoiceStack(gameId);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(3);

    const mayStepId = String((queue.steps[0] as any).id);
    const beforeNykthos = ((game as any).state.battlefield || []).find((perm: any) => perm.id === 'nykthos-shrine-to-nyx');
    expect(beforeNykthos?.tapped).toBe(false);

    await handlers['cancelResolutionStep']({ gameId, stepId: mayStepId });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
    expect(queueSummary.hasPending).toBe(false);

    const cancelledEvents = emitted.filter((entry) => entry.event === 'resolutionStepCancelled');
    expect(cancelledEvents.some((entry) => entry.payload?.stepId === mayStepId)).toBe(true);

    const nykthos = ((game as any).state.battlefield || []).find((perm: any) => perm.id === 'nykthos-shrine-to-nyx');
    expect(nykthos?.tapped).toBe(false);
  });

  it('executes grouped target-opponent trigger choices on the authoritative game state', async () => {
    const gameId = opponentGameId;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).state = makeMerfolkIterationState({
      id: gameId,
      players: [
        ...makeMerfolkIterationState().players,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const bridge = createRulesBridge(gameId, io);
    bridge.initialize((game as any).state);
    seedTargetOpponentChoiceStack(gameId);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).targetTypes).toEqual(['opponent']);
    expect((queue.steps[0] as any).validTargets.map((target: any) => target.id)).toEqual(['p2', 'p3']);

    const beforeP2 = ((game as any).state.players || []).find((player: any) => player.id === 'p2');
    const beforeP3 = ((game as any).state.players || []).find((player: any) => player.id === 'p3');
    expect(beforeP2?.life).toBe(40);
    expect(beforeP3?.life).toBe(40);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((queue.steps[0] as any).id), selections: ['p2'] });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const player2 = ((game as any).state.players || []).find((player: any) => player.id === 'p2');
    const player3 = ((game as any).state.players || []).find((player: any) => player.id === 'p3');
    expect(player2?.life).toBe(39);
    expect(player3?.life).toBe(40);
  });
});