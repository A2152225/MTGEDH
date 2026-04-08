import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
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

describe('modal command targeting (integration)', () => {
  const gameId = 'test_modal_command_targeting';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues one target step per selected Prismari Command target mode and defers payment until all are chosen', async () => {
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
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
          image_uris: { small: 'https://example.com/sol-ring.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'prismari_command_1',
            name: 'Prismari Command',
            mana_cost: '{1}{U}{R}',
            manaCost: '{1}{U}{R}',
            type_line: 'Instant',
            oracle_text: 'Choose two —\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
            image_uris: { small: 'https://example.com/prismari-command.jpg' },
            colors: ['U', 'R'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 1, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'prismari_command_1' });

    const modeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'prismari_command_1') as any;
    expect(modeStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(modeStep.id),
      selections: ['mode_1', 'mode_4'],
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('prismari_command_1');

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    let queue = ResolutionQueueManager.getQueue(gameId);
    let targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Prismari Command');
    expect(targetSteps.length).toBe(2);
    expect(String(targetSteps[0]?.targetDescription || '').toLowerCase()).toContain('any target');
    expect(targetSteps.some((step: any) => String(step.targetDescription || '').toLowerCase().includes('target artifact'))).toBe(true);

    const firstTargetStep = targetSteps[0] as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(firstTargetStep.id),
      selections: [opponentId],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Prismari Command');
    expect(targetSteps.length).toBe(1);
    expect(String(targetSteps[0]?.targetDescription || '').toLowerCase()).toContain('target artifact');
    expect(queue.steps.some((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true)).toBe(false);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetSteps[0].id),
      selections: ['sol_ring_1'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual([opponentId, 'sol_ring_1']);

    emitted.length = 0;
    await handlers['completeCastSpell']({
      gameId,
      cardId: 'prismari_command_1',
      effectId: String(paymentStep.effectId),
    });

    const invalidTargetError = emitted.find((event) => event.event === 'error' && event.payload?.code === 'INVALID_TARGET');
    expect(invalidTargetError).toBeUndefined();
    expect(Array.isArray((game.state as any).stack)).toBe(true);
    expect((game.state as any).stack.length).toBe(1);
    expect(String((game.state as any).stack[0]?.card?.name || '')).toBe('Prismari Command');
  });

  it('allows entwine mode selection to choose all modes and adds the entwine cost to payment', async () => {
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
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'grizzly_bears_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/grizzly-bears.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'grab_the_reins_1',
            name: 'Grab the Reins',
            mana_cost: '{3}{R}',
            manaCost: '{3}{R}',
            type_line: 'Instant',
            oracle_text: 'Choose one —\n• Until end of turn, you gain control of target creature and it gains haste.\n• Sacrifice a creature. Grab the Reins deals damage equal to that creature\'s power to any target.\nEntwine {2}{R} (Choose both if you pay the entwine cost.)',
            image_uris: { small: 'https://example.com/grab-the-reins.jpg' },
            colors: ['R'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 5 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'grab_the_reins_1' });

    const modeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'grab_the_reins_1') as any;
    expect(modeStep).toBeDefined();
    expect(modeStep.maxModes).toBe(2);
    expect(modeStep.entwineCost).toBe('{2}{R}');

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(modeStep.id),
      selections: ['mode_1', 'mode_2'],
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('grab_the_reins_1');

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Grab the Reins');
    expect(targetSteps.length).toBe(2);
    expect(targetSteps.some((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature'))).toBe(true);
    expect(targetSteps.some((step: any) => String(step.targetDescription || '').toLowerCase().includes('any target'))).toBe(true);

    const creatureTargetStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature')) as any;
    const anyTargetStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('any target')) as any;

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(creatureTargetStep.id),
      selections: ['grizzly_bears_1'],
    });

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(anyTargetStep.id),
      selections: [opponentId],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual(['grizzly_bears_1', opponentId]);
    expect(paymentStep.manaCost).toBe('{3}{R}{2}{R}');
  });

  it('scopes Spree target prompts and payment to the selected additional costs', async () => {
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
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'sol_ring_2',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
          image_uris: { small: 'https://example.com/sol-ring.jpg' },
        },
      },
      {
        id: 'grizzly_bears_2',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/grizzly-bears.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'explosive_derailment_1',
            name: 'Explosive Derailment',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Instant',
            oracle_text: 'Spree (Choose one or more additional costs.)\n+ {2} — Explosive Derailment deals 4 damage to target creature.\n+ {2} — Destroy target artifact.',
            image_uris: { small: 'https://example.com/explosive-derailment.jpg' },
            colors: ['R'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'explosive_derailment_1' });

    const spreeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'explosive_derailment_1') as any;
    expect(spreeStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(spreeStep.id),
      selections: ['spree_1'],
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('explosive_derailment_1');

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Explosive Derailment');
    expect(targetSteps.length).toBe(1);
    expect(String(targetSteps[0]?.targetDescription || '').toLowerCase()).toContain('target artifact');
    expect(String(targetSteps[0]?.targetDescription || '').toLowerCase()).not.toContain('target creature');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetSteps[0].id),
      selections: ['sol_ring_2'],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual(['sol_ring_2']);
    expect(paymentStep.manaCost).toBe('{R}{2}');
  });

  it('supports choose-one-or-more modal cards with Escalate cost on extra selected modes', async () => {
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
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'grizzly_bears_3',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/grizzly-bears.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'collective_defiance_1',
            name: 'Collective Defiance',
            mana_cost: '{1}{R}{R}',
            manaCost: '{1}{R}{R}',
            type_line: 'Sorcery',
            oracle_text: 'Escalate {1} (Pay this cost for each mode chosen beyond the first.)\nChoose one or more —\n• Target player discards all the cards in their hand, then draws that many cards.\n• Collective Defiance deals 4 damage to target creature.\n• Collective Defiance deals 3 damage to target opponent or planeswalker.',
            image_uris: { small: 'https://example.com/collective-defiance.jpg' },
            colors: ['R'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'collective_defiance_1' });

    const modeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'collective_defiance_1') as any;
    expect(modeStep).toBeDefined();
    expect(modeStep.maxModes).toBe(3);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(modeStep.id),
      selections: ['mode_2', 'mode_3'],
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('collective_defiance_1');

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    let queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Collective Defiance');
    expect(targetSteps.length).toBe(2);
    expect(targetSteps.some((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature'))).toBe(true);
    expect(targetSteps.some((step: any) => {
      const description = String(step.targetDescription || '').toLowerCase();
      return description.includes('planeswalker') || description.includes('target player') || description.includes('target opponent');
    })).toBe(true);

    const creatureStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature')) as any;
    const opponentStep = targetSteps.find((step: any) => step !== creatureStep) as any;

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(creatureStep.id),
      selections: ['grizzly_bears_3'],
    });

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(opponentStep.id),
      selections: [opponentId],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual(['grizzly_bears_3', opponentId]);
    expect(paymentStep.manaCost).toBe('{1}{R}{R}{1}');
  });

  it('adds Strive cost for each target beyond the first after multi-target selection', async () => {
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
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'selfless_savior_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Selfless Savior',
          type_line: 'Creature — Dog',
          oracle_text: '',
          power: '1',
          toughness: '1',
          image_uris: { small: 'https://example.com/selfless-savior.jpg' },
        },
      },
      {
        id: 'esper_sentinel_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Esper Sentinel',
          type_line: 'Artifact Creature — Human Soldier',
          oracle_text: '',
          power: '1',
          toughness: '1',
          image_uris: { small: 'https://example.com/esper-sentinel.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'launch_the_fleet_1',
            name: 'Launch the Fleet',
            mana_cost: '{W}',
            manaCost: '{W}',
            type_line: 'Sorcery',
            oracle_text: 'Strive — This spell costs {1} more to cast for each target beyond the first.\nUntil end of turn, any number of target creatures each gain "Whenever this creature attacks, create a 1/1 white Soldier creature token that\'s tapped and attacking."',
            image_uris: { small: 'https://example.com/launch-the-fleet.jpg' },
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const effectId = 'cast_launch_the_fleet_1';
    (game.state as any).pendingSpellCasts = {
      [effectId]: {
        cardId: 'launch_the_fleet_1',
        cardName: 'Launch the Fleet',
        manaCost: '{W}',
        rawManaCost: '{W}',
        playerId,
        validTargetIds: ['selfless_savior_1', 'esper_sentinel_1'],
        targets: [],
        card: {
          name: 'Launch the Fleet',
          oracle_text: 'Strive — This spell costs {1} more to cast for each target beyond the first.\nUntil end of turn, any number of target creatures each gain "Whenever this creature attacks, create a 1/1 white Soldier creature token that\'s tapped and attacking."',
          image_uris: { small: 'https://example.com/launch-the-fleet.jpg' },
        },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: playerId as any,
      sourceId: effectId,
      sourceName: 'Launch the Fleet',
      description: 'Choose any number of target creatures for Launch the Fleet',
      mandatory: false,
      validTargets: [
        {
          id: 'selfless_savior_1',
          label: 'Selfless Savior',
          description: 'creature',
          imageUrl: 'https://example.com/selfless-savior.jpg',
        },
        {
          id: 'esper_sentinel_1',
          label: 'Esper Sentinel',
          description: 'creature',
          imageUrl: 'https://example.com/esper-sentinel.jpg',
        },
      ],
      targetTypes: ['spell_target'],
      minTargets: 0,
      maxTargets: 999,
      targetDescription: 'any number of target creatures',
      spellCastContext: {
        cardId: 'launch_the_fleet_1',
        cardName: 'Launch the Fleet',
        manaCost: '{W}',
        effectId,
        oracleText: 'Strive — This spell costs {1} more to cast for each target beyond the first.\nUntil end of turn, any number of target creatures each gain "Whenever this creature attacks, create a 1/1 white Soldier creature token that\'s tapped and attacking."',
        imageUrl: 'https://example.com/launch-the-fleet.jpg',
      },
    } as any);

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['selfless_savior_1', 'esper_sentinel_1'],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual(['selfless_savior_1', 'esper_sentinel_1']);
    expect(paymentStep.manaCost).toBe('{W}{1}');
  });

  it('uses the selected Tiered branch when the highest tier removes targeting entirely', async () => {
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
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'plains_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
          image_uris: { small: 'https://example.com/plains.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'restoration_magic_1',
            name: 'Restoration Magic',
            mana_cost: '{W}',
            manaCost: '{W}',
            type_line: 'Instant',
            oracle_text: 'Tiered (Choose one additional cost.)\n• Cure — {0} — Target permanent gains hexproof and indestructible until end of turn.\n• Cura — {1} — Target permanent gains hexproof and indestructible until end of turn. You gain 3 life.\n• Curaga — {3}{W} — Permanents you control gain hexproof and indestructible until end of turn. You gain 6 life.',
            image_uris: { small: 'https://example.com/restoration-magic.jpg' },
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'restoration_magic_1' });

    const tieredStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'restoration_magic_1') as any;
    expect(tieredStep).toBeDefined();
    expect(tieredStep.maxModes).toBe(1);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(tieredStep.id),
      selections: ['tiered_2'],
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('restoration_magic_1');

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Restoration Magic');
    expect(targetSteps.length).toBe(0);
    expect(Array.isArray((game.state as any).stack)).toBe(true);
    expect((game.state as any).stack.length).toBe(1);
    expect(String((game.state as any).stack[0]?.card?.name || '')).toBe('Restoration Magic');
  });

  it('uses the selected Tiered branch when the middle tier changes the target clause to any number', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const thirdPlayerId = 'p3';
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
      { id: thirdPlayerId, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40, [thirdPlayerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'grizzly_bears_4',
        controller: opponentId,
        owner: opponentId,
        tapped: true,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/grizzly-bears.jpg' },
        },
      },
      {
        id: 'silvercoat_lion_1',
        controller: thirdPlayerId,
        owner: thirdPlayerId,
        tapped: true,
        card: {
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
          oracle_text: '',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/silvercoat-lion.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'cloud_limit_break_1',
            name: "Cloud's Limit Break",
            mana_cost: '{1}{W}',
            manaCost: '{1}{W}',
            type_line: 'Instant',
            oracle_text: 'Tiered (Choose one additional cost.)\n• Cross-Slash — {0} — Destroy target tapped creature.\n• Blade Beam — {1} — Destroy any number of target tapped creatures with different controllers.\n• Omnislash — {3}{W} — Destroy all tapped creatures.',
            image_uris: { small: 'https://example.com/cloud-limit-break.jpg' },
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [thirdPlayerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [thirdPlayerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'cloud_limit_break_1' });

    const tieredStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'cloud_limit_break_1') as any;
    expect(tieredStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(tieredStep.id),
      selections: ['tiered_1'],
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('cloud_limit_break_1');

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    let queue = ResolutionQueueManager.getQueue(gameId);
    const targetSteps = queue.steps.filter((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === "Cloud's Limit Break");
    expect(targetSteps.length).toBe(1);
    expect(String(targetSteps[0]?.targetDescription || '').toLowerCase()).toContain('tapped creature');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetSteps[0].id),
      selections: ['grizzly_bears_4'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual(['grizzly_bears_4']);
    expect(paymentStep.manaCost).toBe('{1}{W}{1}');
  });
});