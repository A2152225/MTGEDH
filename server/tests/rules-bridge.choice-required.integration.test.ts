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

function seedTargetPlayerChoiceStack(gameId: string) {
  const rulesEngineAny = rulesEngine as any;
  const stacks = rulesEngineAny.stacks as Map<string, any>;
  stacks.set(gameId, {
    objects: [
      {
        id: 'stack-trigger-target-player-choice',
        spellId: 'benevolent-seer',
        cardName: 'Benevolent Seer',
        controllerId: 'p1',
        targets: [],
        timestamp: Date.now(),
        type: 'ability',
        triggerMeta: {
          effectText: 'Target player gains 2 life.',
          triggerEventDataSnapshot: {
            sourceId: 'benevolent-seer',
            sourceControllerId: 'p1',
          },
        },
      },
    ],
  });
}

function seedChooseModeChoiceStack(gameId: string) {
  const rulesEngineAny = rulesEngine as any;
  const stacks = rulesEngineAny.stacks as Map<string, any>;
  stacks.set(gameId, {
    objects: [
      {
        id: 'stack-trigger-choose-mode-choice',
        spellId: 'black-market-connections',
        cardName: 'Black Market Connections',
        controllerId: 'p1',
        targets: [],
        timestamp: Date.now(),
        type: 'ability',
        triggerMeta: {
          effectText: 'Choose up to three -\n\u2022 Sell Contraband - You lose 1 life. Create a Treasure token.\n\u2022 Buy Information - You lose 2 life. Draw a card.\n\u2022 Hire a Mercenary - You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
          triggerEventDataSnapshot: {
            sourceId: 'black-market-connections',
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
  const playerGameId = 'test_rules_bridge_choice_required_player';
  const modeGameId = 'test_rules_bridge_choice_required_mode';
  const castDrivenGameId = 'test_rules_bridge_choice_required_cast_driven';

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
    ResolutionQueueManager.removeQueue(playerGameId);
    ResolutionQueueManager.removeQueue(modeGameId);
    ResolutionQueueManager.removeQueue(castDrivenGameId);
    games.delete(queueGameId as any);
    games.delete(executeGameId as any);
    games.delete(declineGameId as any);
    games.delete(cancelGameId as any);
    games.delete(opponentGameId as any);
    games.delete(playerGameId as any);
    games.delete(modeGameId as any);
    games.delete(castDrivenGameId as any);
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

  it('executes grouped target-player trigger choices on the authoritative game state', async () => {
    const gameId = playerGameId;
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
    seedTargetPlayerChoiceStack(gameId);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).targetTypes).toEqual(['player']);
    expect((queue.steps[0] as any).validTargets.map((target: any) => target.id)).toEqual(['p1', 'p2', 'p3']);

    const beforeP1 = ((game as any).state.players || []).find((player: any) => player.id === 'p1');
    const beforeP2 = ((game as any).state.players || []).find((player: any) => player.id === 'p2');
    const beforeP3 = ((game as any).state.players || []).find((player: any) => player.id === 'p3');
    expect(beforeP1?.life).toBe(40);
    expect(beforeP2?.life).toBe(40);
    expect(beforeP3?.life).toBe(40);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((queue.steps[0] as any).id), selections: ['p1'] });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const player1 = ((game as any).state.players || []).find((player: any) => player.id === 'p1');
    const player2 = ((game as any).state.players || []).find((player: any) => player.id === 'p2');
    const player3 = ((game as any).state.players || []).find((player: any) => player.id === 'p3');
    expect(player1?.life).toBe(42);
    expect(player2?.life).toBe(40);
    expect(player3?.life).toBe(40);
  });

  it('executes grouped choose_mode trigger choices on the authoritative game state', async () => {
    const gameId = modeGameId;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).state = makeMerfolkIterationState({ id: gameId } as any);

    const beforePlayer = ((game as any).state.players || []).find((player: any) => player.id === 'p1');
    const beforeLife = beforePlayer?.life;
    const beforeHandSize = Array.isArray(beforePlayer?.hand) ? beforePlayer.hand.length : 0;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const bridge = createRulesBridge(gameId, io);
    bridge.initialize((game as any).state);
    seedChooseModeChoiceStack(gameId);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('mode_selection');
    expect((queue.steps[0] as any).modes.map((mode: any) => mode.id)).toEqual([
      'Sell Contraband',
      'Buy Information',
      'Hire a Mercenary',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['Sell Contraband', 'Buy Information'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const player = ((game as any).state.players || []).find((entry: any) => entry.id === 'p1');
    const treasure = ((game as any).state.battlefield || []).find((perm: any) => String(perm?.card?.name || '').includes('Treasure'));
    expect(player?.life).toBe(beforeLife - 3);
    expect((player?.hand || []).length).toBe(beforeHandSize + 1);
    expect(treasure).toBeTruthy();
  });

  it('creates unresolved Merrow choice steps from a real Summon the School cast', () => {
    const gameId = castDrivenGameId;
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const bridge = createRulesBridge(gameId, io);
    const state = makeMerfolkIterationState({
      id: gameId,
      players: makeMerfolkIterationState().players.map((player: any) =>
        player.id === 'p1'
          ? {
              ...player,
              hand: [
                {
                  id: 'summon-the-school-cast',
                  name: 'Summon the School',
                  mana_cost: '{3}{W}',
                  manaCost: '{3}{W}',
                  type_line: 'Kindred Sorcery — Merfolk',
                  oracle_text:
                    'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return this card from your graveyard to your hand.',
                },
              ],
              graveyard: [],
            }
          : player
      ),
    } as any);

    bridge.initialize(state as any);

    const castResult = bridge.executeAction({
      type: 'castSpell',
      playerId: 'p1',
      cardId: 'summon-the-school-cast',
      targets: [],
    });
    expect(castResult.success).toBe(true);

    const resolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(resolveResult.success).toBe(true);

    const secondResolveResult = bridge.executeAction({ type: 'resolveStack' });
    expect(secondResolveResult.success).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.map((step: any) => step.type)).toEqual([
      'option_choice',
      'target_selection',
      'option_choice',
    ]);

    const rulesChoiceEvents = emitted.filter((entry) => entry.event === 'rulesChoiceRequired');
    expect(rulesChoiceEvents.some((entry) => entry.payload?.sourceName === 'Merrow Reejerey')).toBe(true);
    expect(queue.steps[1] && (queue.steps[1] as any).validTargets.some((target: any) => target.id === 'nykthos-shrine-to-nyx')).toBe(true);
  });
});