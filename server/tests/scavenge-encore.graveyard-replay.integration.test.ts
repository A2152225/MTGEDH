import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.clearAllSteps(gameId as any);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
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

describe('scavenge and encore graveyard replay semantics (integration)', () => {
  const gameId = 'test_scavenge_encore_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('live scavenge queues a target and adds counters to the chosen creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'scavenge_card_1',
            name: 'Slitherhead',
            type_line: 'Creature - Plant Zombie',
            oracle_text: 'Scavenge {0}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'scavenge_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'scavenge_target_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'scavenge_card_1',
      abilityId: 'scavenge',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => (step as any)?.scavengeTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.targetTypes).toEqual(['creature']);
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['scavenge_target_1']);

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event?.type === 'resolveTopOfStackPrompt' && event?.payload?.queuedResolutionStep?.scavengeTargetSelection === true
    ) as any;
    expect(promptEvent?.payload?.queuedResolutionStep?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(promptEvent?.payload?.queuedResolutionStep?.sourceId).toBe('scavenge_card_1');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['scavenge_target_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('scavenge_card_1');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 });

    const targetPermanent = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'scavenge_target_1');
    expect(targetPermanent?.counters?.['+1/+1']).toBe(1);
  });

  it('live scavenge requires sorcery-speed timing', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'scavenge_timing_card_1',
            name: 'Slitherhead',
            type_line: 'Creature - Plant Zombie',
            oracle_text: 'Scavenge {0}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'scavenge_timing_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'scavenge_timing_target_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [
      {
        id: 'stack_spell_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'stack_spell_card_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'scavenge_timing_card_1',
      abilityId: 'scavenge',
    });

    const errorEntry = emitted.filter((entry) => entry.event === 'error').at(-1);
    expect(errorEntry?.payload?.code).toBe('SORCERY_SPEED_ONLY');

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => (step as any)?.scavengeTargetSelection === true);
    expect(targetStep).toBeUndefined();

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(1);
    expect(zones?.exileCount).toBe(0);
  });

  it('live encore exiles the card, creates one token per opponent, and enforces each token\'s required defender', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentA = 'p2';
    const opponentB = 'p3';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentA, name: 'P2', spectator: false, life: 40 },
      { id: opponentB, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'encore_card_1',
            name: 'Impetuous Devils',
            type_line: 'Creature - Devil',
            oracle_text: 'Encore {3}{R}{R}',
            power: '6',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'encore_card_1',
      abilityId: 'encore',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('encore_card_1');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    const targetIds = battlefield.map((perm: any) => perm.encoreAttackPlayerId).sort();
    expect(targetIds).toEqual([opponentA, opponentB]);
    expect(battlefield.every((perm: any) => perm.isToken)).toBe(true);
    expect(battlefield.every((perm: any) => perm.mustAttack)).toBe(true);
    expect(battlefield.every((perm: any) => perm.summoningSickness === false)).toBe(true);

    const delayed = (game.state as any).pendingSacrificeAtNextEndStep || [];
    expect(delayed).toHaveLength(2);
    expect(delayed.every((entry: any) => entry.createdBy === playerId)).toBe(true);

    (game.state as any).turnPlayer = playerId;
    (game.state as any).turn = 1;
    (game.state as any).step = 'declareAttackers';
    const tokenForOpponentA = battlefield.find((perm: any) => perm.encoreAttackPlayerId === opponentA);
    expect(tokenForOpponentA).toBeDefined();

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: tokenForOpponentA.id, targetPlayerId: opponentB }],
    });

    const attackError = emitted.filter((entry) => entry.event === 'error').at(-1);
    expect(attackError?.payload?.code).toBe('ATTACK_REQUIREMENT');
  });

  it('live encore queues and persists each token self ETB trigger', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentA = 'p2';
    const opponentB = 'p3';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentA, name: 'P2', spectator: false, life: 40 },
      { id: opponentB, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'encore_card_2',
            name: 'Encore Visionary',
            type_line: 'Creature - Elf Shaman',
            oracle_text: 'When Encore Visionary enters, draw a card.\nEncore {3}{R}{R}',
            power: '2',
            toughness: '2',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const eventStart = getEvents(gameId).length;
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'encore_card_2',
      abilityId: 'encore',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    expect((game.state as any).stack).toHaveLength(2);
    const stackSources = ((game.state as any).stack || []).map((item: any) => String(item?.source || '')).sort();
    expect(stackSources).toEqual(battlefield.map((perm: any) => String(perm?.id || '')).sort());

    const triggerEvents = getEvents(gameId).slice(eventStart).filter((event: any) => event.type === 'pushTriggeredAbility');
    expect(triggerEvents).toHaveLength(2);
    const persistedSourceIds = triggerEvents.map((event: any) => String(event?.payload?.sourceId || '')).sort();
    expect(persistedSourceIds).toEqual(battlefield.map((perm: any) => String(perm?.id || '')).sort());
  });

  it('live encore requires sorcery-speed timing', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentA = 'p2';
    const opponentB = 'p3';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentA, name: 'P2', spectator: false, life: 40 },
      { id: opponentB, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'encore_timing_card_1',
            name: 'Impetuous Devils',
            type_line: 'Creature - Devil',
            oracle_text: 'Encore {3}{R}{R}',
            power: '6',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [
      {
        id: 'encore_stack_spell_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'encore_stack_spell_card_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'encore_timing_card_1',
      abilityId: 'encore',
    });

    const errorEntry = emitted.filter((entry) => entry.event === 'error').at(-1);
    expect(errorEntry?.payload?.code).toBe('SORCERY_SPEED_ONLY');

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(1);
    expect(zones?.exileCount).toBe(0);
    expect(((game.state as any).battlefield || []).length).toBe(0);
  });

  it('replays encore by exiling the card, rebuilding the token copies, and scheduling next-end-step sacrifice', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentA = 'p2';
    const opponentB = 'p3';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentA, name: 'P2', spectator: false, life: 40 },
      { id: opponentB, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'encore_card_1',
            name: 'Impetuous Devils',
            type_line: 'Creature - Devil',
            oracle_text: 'Encore {3}{R}{R}',
            power: '6',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).pendingSacrificeAtNextEndStep = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'encore_card_1',
      abilityId: 'encore',
      manaCost: '{3}{R}{R}',
      createdPermanentIds: ['encore_live_token_1', 'encore_live_token_2'],
      encoreTargetPlayerIds: [opponentA, opponentB],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('encore_card_1');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    expect(battlefield.map((perm: any) => perm.id)).toEqual(['encore_live_token_1', 'encore_live_token_2']);
    const targetIds = battlefield.map((perm: any) => perm.encoreAttackPlayerId).sort();
    expect(targetIds).toEqual([opponentA, opponentB]);
    expect(battlefield.every((perm: any) => perm.isToken)).toBe(true);
    expect(battlefield.every((perm: any) => perm.mustAttack)).toBe(true);

    const delayed = (game.state as any).pendingSacrificeAtNextEndStep || [];
    expect(delayed).toHaveLength(2);
    expect(delayed.every((entry: any) => entry.createdBy === playerId)).toBe(true);
    expect(delayed.map((entry: any) => entry.permanentId)).toEqual(['encore_live_token_1', 'encore_live_token_2']);
  });

  it('replays a queued scavenge target prompt after activation before the choice is made', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'pending_scavenge_card_1',
            name: 'Slitherhead',
            type_line: 'Creature - Plant Zombie',
            oracle_text: 'Scavenge {0}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'pending_scavenge_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'pending_scavenge_target_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'pending_scavenge_card_1',
      abilityId: 'scavenge',
      manaCost: '{0}',
    } as any);
    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'pending_scavenge_card_1',
      queuedResolutionStep: {
        id: 'pending_scavenge_step_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'pending_scavenge_card_1',
        sourceName: 'Slitherhead',
        description: 'Choose target creature for Slitherhead',
        mandatory: true,
        validTargets: [
          {
            id: 'pending_scavenge_target_1',
            label: 'Runeclaw Bear',
            description: 'Creature - Bear',
            type: 'permanent',
            controller: playerId,
            isOpponent: false,
            typeLine: 'Creature - Bear',
          },
        ],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target creature',
        scavengeTargetSelection: true,
        cardId: 'pending_scavenge_card_1',
        cardName: 'Slitherhead',
        counterCount: 1,
      },
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('pending_scavenge_card_1');

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => (step as any)?.scavengeTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['pending_scavenge_target_1']);
  });

  it('replays scavenge by exiling the card and restoring the counter target result', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'replay_scavenge_card_1',
            name: 'Dreg Mangler',
            type_line: 'Creature - Plant Zombie',
            oracle_text: 'Scavenge {0}',
            power: '3',
            toughness: '3',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'replay_scavenge_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'replay_scavenge_target_card_1',
          name: 'Zombie Token',
          type_line: 'Creature - Zombie',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'replay_scavenge_card_1',
      abilityId: 'scavenge',
      manaCost: '{0}',
    } as any);
    game.applyEvent({
      type: 'counterTargetChosen',
      playerId,
      sourceName: 'Dreg Mangler',
      targetId: 'replay_scavenge_target_1',
      targetName: 'Zombie Token',
      counterType: '+1/+1',
    } as any);
    game.applyEvent({
      type: 'counterTargetChosen',
      playerId,
      sourceName: 'Dreg Mangler',
      targetId: 'replay_scavenge_target_1',
      targetName: 'Zombie Token',
      counterType: '+1/+1',
    } as any);
    game.applyEvent({
      type: 'counterTargetChosen',
      playerId,
      sourceName: 'Dreg Mangler',
      targetId: 'replay_scavenge_target_1',
      targetName: 'Zombie Token',
      counterType: '+1/+1',
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('replay_scavenge_card_1');

    const targetPermanent = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'replay_scavenge_target_1');
    expect(targetPermanent?.counters?.['+1/+1']).toBe(3);
  });
});