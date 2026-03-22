import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
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

function seedBaseGame(
  game: any,
  playerId: string,
  manaPool: Record<string, number>,
  battlefieldExtras: any[] = []
) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).manaPool = {
    [playerId]: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      ...manaPool,
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
    ...battlefieldExtras,
  ];
}

function seedTriggeredAbilityStack(
  game: any,
  playerId: string,
  trigger: {
    sourceId: string;
    sourceName: string;
    description: string;
    effect: string;
  }
) {
  (game.state as any).stack = [
    {
      id: 'ability_1',
      type: 'ability',
      controller: playerId,
      source: 'artifact_1',
      sourceName: 'Chromatic Sphere',
      description: 'Draw a card.',
      abilityType: 'test_ability',
      targets: [{ id: 'player_2', type: 'player' }],
    },
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: trigger.sourceId,
      sourceName: trigger.sourceName,
      description: trigger.description,
      effect: trigger.effect,
      triggerType: 'ability_activated',
      mandatory: false,
      triggeringStackItemId: 'ability_1',
      activatedAbilityIsManaAbility: false,
    },
  ];
}

describe('ability-activated copy triggers (integration)', () => {
  const gameId = 'test_ability_activated_copy_integration';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues an optional payment prompt and copies the triggering stack ability on pay', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game, playerId, { colorless: 2 }, [
      {
        id: 'rings_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'rings_card_1',
          name: 'Rings of Brighthearth',
          type_line: 'Legendary Artifact',
        },
      },
    ]);
    seedTriggeredAbilityStack(game, playerId, {
      sourceId: 'rings_1',
      sourceName: 'Rings of Brighthearth',
      description: 'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
      effect: 'Whenever you activate an ability, if it is not a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
    });

    game.resolveTopOfStack();

    expect((game.state as any).stack).toHaveLength(1);
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).optionalPaymentPrompt === true);
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['pay'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedAbility = (game.state as any).stack[1];
    expect(String(copiedAbility.id || '')).not.toBe('ability_1');
    expect(copiedAbility.copiedFromStackItemId).toBe('ability_1');
    expect(copiedAbility.description).toBe('Draw a card.');
    expect(copiedAbility.targets).toEqual([{ id: 'player_2', type: 'player' }]);
    expect(Number((game.state as any).manaPool[playerId].colorless || 0)).toBe(0);
  });

  it('routes targeted grant-ability activations through shared targeting and offers Rings copy retargeting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'player_2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, player_2: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 3 },
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
        id: 'banner_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'banner_card_1',
          name: 'Sky Banner',
          oracle_text: '{1}{R}, {T}: Target creature you control gets +1/+1 and gains flying until end of turn.',
          type_line: 'Artifact',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
        },
      },
      {
        id: 'creature_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'creature_card_2',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'banner_1',
      abilityId: 'banner_1-grant-ability-0',
    });

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true);
    expect(targetStep).toBeDefined();
    expect((targetStep as any).validTargets.map((target: any) => target.id)).toEqual(['creature_1', 'creature_2']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['creature_1'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    const originalAbility = (game.state as any).stack[0];
    expect(originalAbility.targets).toEqual(['creature_1']);
    expect(originalAbility.copyRetargetValidTargets.map((target: any) => target.id)).toEqual(['creature_1', 'creature_2']);

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
      selections: ['creature_2'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedAbility = (game.state as any).stack[1];
    expect(copiedAbility.copiedFromStackItemId).toBe(originalAbility.id);
    expect(copiedAbility.targets).toEqual(['creature_2']);
  });

  it('consumes colored mana and copies the ability for Kurkesh', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game, playerId, { red: 1 }, [
      {
        id: 'kurkesh_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'kurkesh_card_1',
          name: 'Kurkesh, Onakke Ancient',
          type_line: 'Legendary Creature — Ogre Spirit',
        },
      },
    ]);
    seedTriggeredAbilityStack(game, playerId, {
      sourceId: 'kurkesh_1',
      sourceName: 'Kurkesh, Onakke Ancient',
      description: 'You may pay {R}. If you do, copy that ability.',
      effect: 'Whenever you activate an ability of an artifact, if it is not a mana ability, you may pay {R}. If you do, copy that ability.',
    });

    game.resolveTopOfStack();

    const step = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).optionalPaymentPrompt === true);
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['pay'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    expect((game.state as any).stack[1].copiedFromStackItemId).toBe('ability_1');
    expect(Number((game.state as any).manaPool[playerId].red || 0)).toBe(0);
  });

  it('copies the triggering stack ability immediately for Illusionist\'s Bracers', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game, playerId, { colorless: 0 }, [
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
    ]);
    seedTriggeredAbilityStack(game, playerId, {
      sourceId: 'bracers_1',
      sourceName: "Illusionist's Bracers",
      description: 'Copy that ability. You may choose new targets for the copy.',
      effect: 'Whenever an ability of equipped creature is activated, if it is not a mana ability, copy that ability. You may choose new targets for the copy.',
    });

    game.resolveTopOfStack();

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).stack).toHaveLength(2);
    const copiedAbility = (game.state as any).stack[1];
    expect(copiedAbility.copiedFromStackItemId).toBe('ability_1');
    expect(copiedAbility.isCopy).toBe(true);
    expect(copiedAbility.targets).toEqual([{ id: 'player_2', type: 'player' }]);
    expect(Number((game.state as any).manaPool[playerId].colorless || 0)).toBe(0);
  });

  it('offers retargeting for copied abilities when retarget metadata exists', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game, playerId, { colorless: 2 }, [
      {
        id: 'rings_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'rings_card_1',
          name: 'Rings of Brighthearth',
          type_line: 'Legendary Artifact',
        },
      },
    ]);
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'player_2', name: 'P2', spectator: false, life: 40 },
      { id: 'player_3', name: 'P3', spectator: false, life: 40 },
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
        source: 'rings_1',
        sourceName: 'Rings of Brighthearth',
        description: 'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
        effect: 'Whenever you activate an ability, if it is not a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy.',
        triggerType: 'ability_activated',
        mandatory: false,
        triggeringStackItemId: 'ability_1',
        activatedAbilityIsManaAbility: false,
      },
    ];

    game.resolveTopOfStack();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

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
      selections: ['player_3'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedAbility = (game.state as any).stack[1];
    expect(copiedAbility.copiedFromStackItemId).toBe('ability_1');
    expect(copiedAbility.targets).toEqual(['player_3']);
  });

  it('queues a {1} payment copy prompt for Battlemage\'s Bracers and allows retargeting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game, playerId, { colorless: 1 }, [
      {
        id: 'bracers_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        attachedTo: 'artifact_1',
        card: {
          id: 'bracers_card_2',
          name: "Battlemage's Bracers",
          type_line: 'Artifact — Equipment',
        },
      },
    ]);
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'player_2', name: 'P2', spectator: false, life: 40 },
      { id: 'player_3', name: 'P3', spectator: false, life: 40 },
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
        source: 'bracers_2',
        sourceName: "Battlemage's Bracers",
        description: 'You may pay {1}. If you do, copy that ability. You may choose new targets for the copy.',
        effect: 'Whenever an ability of equipped creature is activated, if it is not a mana ability, you may pay {1}. If you do, copy that ability. You may choose new targets for the copy.',
        triggerType: 'ability_activated',
        mandatory: false,
        triggeringStackItemId: 'ability_1',
        activatedAbilityIsManaAbility: false,
      },
    ];

    game.resolveTopOfStack();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const payStep = ResolutionQueueManager.getQueue(gameId).steps.find((queuedStep: any) => (queuedStep as any).optionalPaymentPrompt === true);
    expect(payStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((payStep as any).id),
      selections: ['pay'],
      cancelled: false,
    });

    expect(Number((game.state as any).manaPool[playerId].colorless || 0)).toBe(0);

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
    const copiedAbility = (game.state as any).stack[1];
    expect(copiedAbility.copiedFromStackItemId).toBe('ability_1');
    expect(copiedAbility.targets).toEqual(['player_3']);
  });

  it('copies an equip activation and retargets the copied equip ability', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'player_2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, player_2: 40 };
    (game.state as any).manaPool = {
      [playerId]: {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 2,
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
        id: 'sword_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'sword_card_1',
          name: 'Test Sword',
          oracle_text: 'Equip {0}',
          type_line: 'Artifact — Equipment',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
        },
      },
      {
        id: 'creature_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_card_2',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    handlers['equipAbility']({
      gameId,
      equipmentId: 'sword_1',
      targetCreatureId: 'creature_1',
    });

    expect((game.state as any).stack).toHaveLength(2);
    const originalEquipAbility = (game.state as any).stack[0];
    expect(originalEquipAbility.abilityType).toBe('equip');
    expect(originalEquipAbility.targets).toEqual(['creature_1']);
    expect(originalEquipAbility.equipParams.targetCreatureId).toBe('creature_1');
    expect(originalEquipAbility.copyRetargetValidTargets.map((target: any) => target.id)).toEqual(['creature_1', 'creature_2']);

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
      selections: ['creature_2'],
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedEquipAbility = (game.state as any).stack[1];
    expect(copiedEquipAbility.copiedFromStackItemId).toBe(originalEquipAbility.id);
    expect(copiedEquipAbility.targets).toEqual(['creature_2']);
    expect(copiedEquipAbility.equipParams.targetCreatureId).toBe('creature_2');
    expect(copiedEquipAbility.equipParams.targetCreatureName).toBe('Runeclaw Bear');

    game.resolveTopOfStack();
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'sword_1')?.attachedTo).toBe('creature_2');

    game.resolveTopOfStack();
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'sword_1')?.attachedTo).toBe('creature_1');
  });
});