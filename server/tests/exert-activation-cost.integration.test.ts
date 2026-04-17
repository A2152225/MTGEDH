import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
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

function seedGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'main';
  (game.state as any).step = 'main1';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createCreature(
  id: string,
  controller: string,
  name: string,
  oracleText: string,
  power: number,
  toughness: number,
) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    basePower: power,
    baseToughness: toughness,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature - Warrior',
      oracle_text: oracleText,
      power: String(power),
      toughness: String(toughness),
    },
  };
}

describe('activated exert costs (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `exert_activation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  it('supports Exert this creature as an activated cost and fires whenever-you-exert watchers', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'steward_of_solidarity',
        playerId,
        'Steward of Solidarity',
        '{T}, Exert this creature: Create a 1/1 white Warrior creature token with vigilance.',
        2,
        2,
      ),
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    const eventStart = getEvents(gameId).length;
    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'steward_of_solidarity',
      abilityId: 'steward_of_solidarity-ability-0',
    });

    const steward = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'steward_of_solidarity') as any;
    expect(steward?.tapped).toBe(true);
    expect(steward?.doesntUntapNextTurn).toBe(true);
    expect(steward?.exertedThisTurn).toBe(true);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'steward_of_solidarity',
      description: 'create a 1/1 white warrior creature token with vigilance.',
    }));
    expect(stack[1]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
      effect: 'creatures you control get +1/+0 until end of turn.',
    }));

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'activateBattlefieldAbility' &&
      event?.payload?.permanentId === 'steward_of_solidarity' &&
      event?.payload?.exertedPermanentIdForCost === 'steward_of_solidarity',
    )).toBe(true);
    expect(events.some((event: any) =>
      event?.type === 'pushTriggeredAbility' &&
      event?.payload?.triggerType === 'whenever_you_exert' &&
      event?.payload?.sourceId === 'trueheart_twins',
    )).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(steward.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const warriorToken = ((game.state as any).battlefield || []).find((permanent: any) =>
      permanent?.id !== 'steward_of_solidarity' &&
      permanent?.id !== 'trueheart_twins' &&
      String(permanent?.card?.type_line || '').toLowerCase().includes('warrior'),
    ) as any;
    expect(warriorToken).toBeDefined();
    expect(String(warriorToken?.card?.power || '')).toBe('1');
    expect(String(warriorToken?.card?.toughness || '')).toBe('1');
    expect(Array.isArray(warriorToken?.card?.keywords)).toBe(true);
    expect((warriorToken.card.keywords || []).map((entry: any) => String(entry))).toContain('Vigilance');
  });

  it('supports Exert this creature when a mana-color prompt defers completion', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'oasis_ritualist',
        playerId,
        'Oasis Ritualist',
        "{T}: Add one mana of any color.\n{T}, Exert this creature: Add two mana of any one color. (An exerted creature won't untap during your next untap step.)",
        2,
        4,
      ),
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    const eventStart = getEvents(gameId).length;
    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'oasis_ritualist',
      abilityId: 'oasis_ritualist-ability-1',
    });

    const manaStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (step: any) => step.type === ResolutionStepType.MANA_COLOR_SELECTION,
    ) as any;
    expect(manaStep).toBeDefined();
    expect(manaStep.requiresSelfExertForCost).toBe(true);

    const queuedEvents = getEvents(gameId).slice(eventStart);
    expect(queuedEvents.some((event: any) =>
      event?.type === 'activateBattlefieldAbility' &&
      event?.payload?.permanentId === 'oasis_ritualist' &&
      event?.payload?.queuedResolutionStep?.requiresSelfExertForCost === true,
    )).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(manaStep.id),
      selections: 'green',
    });

    const ritualist = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'oasis_ritualist') as any;
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(ritualist?.tapped).toBe(true);
    expect(ritualist?.doesntUntapNextTurn).toBe(true);
    expect(ritualist?.exertedThisTurn).toBe(true);
    expect(Number((game.state as any).manaPool?.[playerId]?.green || 0)).toBe(2);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
      effect: 'creatures you control get +1/+0 until end of turn.',
    }));

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'activateBattlefieldAbility' &&
      event?.payload?.permanentId === 'oasis_ritualist' &&
      event?.payload?.exertedPermanentIdForCost === 'oasis_ritualist',
    )).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(ritualist.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('supports Exert this creature when a target-selection prompt defers completion', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'exerting_reclaimer',
        playerId,
        'Exerting Reclaimer',
        '{T}, Exert this creature: Return target creature card from your graveyard to your hand. (An exerted creature won\'t untap during your next untap step.)',
        3,
        3,
      ),
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
      createCreature(
        'opponent_creature',
        opponentId,
        'Opponent Creature',
        '',
        1,
        1,
      ),
    ];

    (game.state as any).zones[playerId].graveyard = [{
      id: 'graveyard_target',
      name: 'Recovered Creature',
      type_line: 'Creature - Warrior',
      zone: 'graveyard',
      image_uris: {},
    }];
    (game.state as any).zones[playerId].graveyardCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    const eventStart = getEvents(gameId).length;
    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'exerting_reclaimer',
      abilityId: 'exerting_reclaimer-ability-0',
    });

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.requiresSelfExertForCost).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['graveyard_target'],
    });

    const reclaimer = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'exerting_reclaimer') as any;
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(reclaimer?.tapped).toBe(true);
    expect(reclaimer?.doesntUntapNextTurn).toBe(true);
    expect(reclaimer?.exertedThisTurn).toBe(true);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(2);
    expect(String(stack[0]?.description || '').toLowerCase()).toBe('return target creature card from your graveyard to your hand.');
    expect(stack[1]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
      effect: 'creatures you control get +1/+0 until end of turn.',
    }));

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'activateBattlefieldAbility' &&
      event?.payload?.permanentId === 'exerting_reclaimer' &&
      event?.payload?.exertedPermanentIdForCost === 'exerting_reclaimer',
    )).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(reclaimer.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const returnedCard = ((game.state as any).zones?.[playerId]?.hand || []).find((card: any) => card?.id === 'graveyard_target') as any;
    expect(returnedCard).toBeDefined();
  });

  it('supports Exert this creature when a tap-untap prompt defers completion', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createCreature(
        'hope_tender',
        playerId,
        'Hope Tender',
        "{1}, {T}: Untap target land.\n{1}, {T}, Exert this creature: Untap two target lands. (An exerted creature won't untap during your next untap step.)",
        2,
        2,
      ),
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
      {
        id: 'forest_a',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: { id: 'forest_a_card', name: 'Forest A', type_line: 'Basic Land — Forest', oracle_text: '' },
      },
      {
        id: 'forest_b',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: { id: 'forest_b_card', name: 'Forest B', type_line: 'Basic Land — Forest', oracle_text: '' },
      },
    ];

    (game.state as any).manaPool[playerId].colorless = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    const eventStart = getEvents(gameId).length;
    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'hope_tender',
      abilityId: 'hope_tender-ability-1',
    });

    const tapUntapStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (step: any) => step.type === ResolutionStepType.TAP_UNTAP_TARGET,
    ) as any;
    expect(tapUntapStep).toBeDefined();
    expect(tapUntapStep.requiresSelfExertForCost).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(tapUntapStep.id),
      selections: { targetIds: ['forest_a', 'forest_b'] },
    });

    const hopeTender = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'hope_tender') as any;
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    const forestA = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'forest_a') as any;
    const forestB = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'forest_b') as any;

    expect(hopeTender?.tapped).toBe(true);
    expect(hopeTender?.doesntUntapNextTurn).toBe(true);
    expect(hopeTender?.exertedThisTurn).toBe(true);
    expect(forestA?.tapped).toBe(true);
    expect(forestB?.tapped).toBe(true);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'hope_tender',
      description: 'untap two target lands. (an exerted creature won\'t untap during your next untap step.)',
      targets: ['forest_a', 'forest_b'],
      tapUntapAction: 'untap',
    }));
    expect(stack[1]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
      effect: 'creatures you control get +1/+0 until end of turn.',
    }));

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'activateBattlefieldAbility' &&
      event?.payload?.permanentId === 'hope_tender' &&
      event?.payload?.exertedPermanentIdForCost === 'hope_tender' &&
      Array.isArray(event?.payload?.targets) &&
      event.payload.targets.includes('forest_a') &&
      event.payload.targets.includes('forest_b'),
    )).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(hopeTender.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(forestA?.tapped).toBe(true);
    expect(forestB?.tapped).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(forestA?.tapped).toBe(false);
    expect(forestB?.tapped).toBe(false);
  });

  it('supports Fervent Paincaster exert damage through target-selection completion', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      {
        id: 'fervent_paincaster',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 1,
        card: {
          id: 'fervent_paincaster_card',
          name: 'Fervent Paincaster',
          type_line: 'Creature — Human Wizard',
          oracle_text: '{T}: This creature deals 1 damage to target player or planeswalker.\n{T}, Exert this creature: It deals 1 damage to target creature. (An exerted creature won\'t untap during your next untap step.)',
          power: '3',
          toughness: '1',
        },
      },
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
      createCreature(
        'target_creature',
        opponentId,
        'Target Creature',
        '',
        1,
        1,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'fervent_paincaster',
      abilityId: 'fervent_paincaster-ability-1',
    });

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.requiresSelfExertForCost).toBe(true);
    expect((targetStep.validTargets || []).map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['fervent_paincaster', 'trueheart_twins', 'target_creature']),
    );

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['target_creature'],
    });

    const paincaster = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'fervent_paincaster') as any;
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(paincaster?.tapped).toBe(true);
    expect(paincaster?.doesntUntapNextTurn).toBe(true);
    expect(paincaster?.exertedThisTurn).toBe(true);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'fervent_paincaster',
      targets: ['target_creature'],
    }));
    expect(stack[1]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
    }));

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(paincaster?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const targetCreature = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'target_creature') as any;
    expect(targetCreature).toBeDefined();
    expect(Number(targetCreature?.damageMarked || 0)).toBe(1);
    expect(Number(targetCreature?.markedDamage || 0)).toBe(0);
  });

  it('supports Pride Sovereign exert token creation with lifelink cats', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      {
        id: 'pride_sovereign',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'pride_sovereign_card',
          name: 'Pride Sovereign',
          type_line: 'Creature — Cat',
          oracle_text: 'This creature gets +1/+1 for each other Cat you control.\n{W}, {T}, Exert this creature: Create two 1/1 white Cat creature tokens with lifelink. (An exerted creature won\'t untap during your next untap step.)',
          power: '2',
          toughness: '2',
        },
      },
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
    ];
    (game.state as any).manaPool[playerId].white = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'pride_sovereign',
      abilityId: 'pride_sovereign-ability-0',
    });

    const sovereign = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'pride_sovereign') as any;
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(sovereign?.tapped).toBe(true);
    expect(sovereign?.doesntUntapNextTurn).toBe(true);
    expect(sovereign?.exertedThisTurn).toBe(true);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'pride_sovereign',
      description: 'create two 1/1 white cat creature tokens with lifelink.',
    }));
    expect(stack[1]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
    }));

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(sovereign?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const catTokens = (((game.state as any).battlefield || []) as any[]).filter((permanent: any) =>
      permanent?.id !== 'pride_sovereign' &&
      permanent?.id !== 'trueheart_twins' &&
      String(permanent?.card?.type_line || '').toLowerCase().includes('cat'),
    );
    expect(catTokens).toHaveLength(2);
    for (const token of catTokens) {
      expect(String(token?.card?.power || '')).toBe('1');
      expect(String(token?.card?.toughness || '')).toBe('1');
      expect((token?.card?.keywords || []).map((entry: any) => String(entry))).toContain('Lifelink');
    }
  });

  it('supports Angel of Condemnation exert exile through target-selection completion and returns the card when Angel leaves', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      {
        id: 'angel_of_condemnation',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'angel_of_condemnation_card',
          name: 'Angel of Condemnation',
          type_line: 'Creature — Angel',
          oracle_text: 'Flying, vigilance\n{2}{W}, {T}: Exile another target creature. Return that card to the battlefield under its owner\'s control at the beginning of the next end step.\n{2}{W}, {T}, Exert this creature: Exile another target creature until this creature leaves the battlefield. (An exerted creature won\'t untap during your next untap step.)',
          power: '3',
          toughness: '3',
        },
      },
      createCreature(
        'trueheart_twins',
        playerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
      createCreature(
        'target_creature',
        opponentId,
        'Target Creature',
        '',
        2,
        2,
      ),
    ];

    (game.state as any).manaPool[playerId].white = 1;
    (game.state as any).manaPool[playerId].colorless = 2;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket]);

    registerResolutionHandlers(io as any, playerSocket as any);
    registerInteractionHandlers(io as any, playerSocket as any);

    const eventStart = getEvents(gameId).length;
    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'angel_of_condemnation',
      abilityId: 'angel_of_condemnation-ability-1',
    });

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.requiresSelfExertForCost).toBe(true);
    expect((targetStep.validTargets || []).map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['trueheart_twins', 'target_creature']),
    );
    expect((targetStep.validTargets || []).map((target: any) => String(target?.id || ''))).not.toContain('angel_of_condemnation');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['target_creature'],
    });

    const angel = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'angel_of_condemnation') as any;
    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    expect(angel?.tapped).toBe(true);
    expect(angel?.doesntUntapNextTurn).toBe(true);
    expect(angel?.exertedThisTurn).toBe(true);

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'angel_of_condemnation',
      targets: ['target_creature'],
    }));
    expect(stack[1]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      triggerType: 'whenever_you_exert',
    }));

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(angel.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefieldAfterExile = ((game.state as any).battlefield || []) as any[];
    expect(battlefieldAfterExile.some((permanent: any) => permanent?.id === 'target_creature')).toBe(false);
    expect((((game.state as any).zones?.[opponentId]?.exile || []) as any[]).some((card: any) => String(card?.name || '') === 'Target Creature')).toBe(true);
    expect(((game.state as any).linkedExiles || [])).toEqual([
      expect.objectContaining({
        exilingPermanentId: 'angel_of_condemnation',
        exiledCardName: 'Target Creature',
        originalOwner: opponentId,
      }),
    ]);

    expect(movePermanentToGraveyard(game as any, 'angel_of_condemnation')).toBe(true);

    const battlefieldAfterReturn = ((game.state as any).battlefield || []) as any[];
    const returnedCreature = battlefieldAfterReturn.find((permanent: any) => String(permanent?.card?.name || '') === 'Target Creature') as any;
    expect(returnedCreature).toBeDefined();
    expect(String(returnedCreature?.controller || '')).toBe(opponentId);
    expect(((game.state as any).linkedExiles || [])).toEqual([]);

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'activateBattlefieldAbility' &&
      event?.payload?.permanentId === 'angel_of_condemnation' &&
      event?.payload?.exertedPermanentIdForCost === 'angel_of_condemnation',
    )).toBe(true);
  });
});