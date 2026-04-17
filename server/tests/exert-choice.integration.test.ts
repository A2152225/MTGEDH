import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
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

function seedCombatGame(gameId: string, attackerId: string, defenderId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: attackerId, name: 'Attacker', spectator: false, life: 40 },
    { id: defenderId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [attackerId]: 40, [defenderId]: 40 };
  (game.state as any).turnPlayer = attackerId;
  (game.state as any).activePlayer = attackerId;
  (game.state as any).priority = attackerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).extraCombats = [];
  (game.state as any).zones = {
    [attackerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [defenderId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createAttacker(id: string, controller: string, name: string, oracleText: string, power: number, toughness: number) {
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

function createCreatureCard(id: string, name: string, power = 6, toughness = 6) {
  return {
    id,
    name,
    type_line: 'Creature - Beast',
    oracle_text: '',
    power: String(power),
    toughness: String(toughness),
  };
}

function findExertStep(gameId: string, playerId: PlayerID) {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const activeStep = queue?.activeStep;
  if (
    activeStep &&
    String(activeStep?.playerId || '') === String(playerId) &&
    activeStep?.type === ResolutionStepType.OPTION_CHOICE &&
    activeStep?.exertChoice === true
  ) {
    return activeStep;
  }

  return ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
    (entry: any) => entry?.type === ResolutionStepType.OPTION_CHOICE && entry?.exertChoice === true,
  );
}

function findTargetSelectionStep(gameId: string, playerId: PlayerID, predicate?: (entry: any) => boolean) {
  const matches = (entry: any) =>
    entry?.type === ResolutionStepType.TARGET_SELECTION &&
    (predicate ? predicate(entry) : true);
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const activeStep = queue?.activeStep;
  if (
    activeStep &&
    String(activeStep?.playerId || '') === String(playerId) &&
    matches(activeStep)
  ) {
    return activeStep;
  }

  return ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(matches);
}

describe('supported exert attack automation (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `exert_choice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('queues Combat Celebrant exert as an option choice and does not grant the extra combat unless the player exerts it', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'combat_celebrant',
        attackerId,
        'Combat Celebrant',
        "If this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase. (An exerted creature won't untap during your next untap step.)",
        4,
        1,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'combat_celebrant', targetPlayerId: defenderId }],
    });

    expect(((game.state as any).stack || []).length).toBe(0);
    const step = findExertStep(gameId, attackerId) as any;
    expect(step).toBeDefined();
    expect((step.options || []).map((entry: any) => entry.id)).toEqual(['exert', 'normal']);
    expect((game.state as any).extraCombats || []).toHaveLength(0);

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: 'normal',
    });

    expect(((game.state as any).stack || []).length).toBe(0);
    expect((game.state as any).extraCombats || []).toHaveLength(0);
    expect((game.state as any).battlefield[0].doesntUntapNextTurn).toBeUndefined();
    expect(
      getEvents(gameId).some((event: any) => event?.type === 'pushTriggeredAbility' && event?.payload?.triggerType === 'exert'),
    ).toBe(false);
  });

  it('exerting Champion of Rhonas marks the attacker and pushes a reflexive trigger that resolves into the existing hand-to-battlefield modal flow', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).zones[attackerId].hand = [createCreatureCard('hand_beast', 'Hand Beast')];
    (game.state as any).zones[attackerId].handCount = 1;
    (game.state as any).battlefield = [
      createAttacker(
        'champion_of_rhonas',
        attackerId,
        'Champion of Rhonas',
        "You may exert this creature as it attacks. When you do, you may put a creature card from your hand onto the battlefield. (An exerted creature won't untap during your next untap step.)",
        3,
        3,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'champion_of_rhonas', targetPlayerId: defenderId }],
    });

    const step = findExertStep(gameId, attackerId) as any;
    expect(step).toBeDefined();
    expect(((game.state as any).stack || []).length).toBe(0);

    const eventStart = getEvents(gameId).length;
    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: 'exert',
    });

    const champion = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'champion_of_rhonas');
    expect(champion?.doesntUntapNextTurn).toBe(true);
    expect(champion?.exertedThisTurn).toBe(true);

    const stack = ((game.state as any).stack || []) as any[];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toContain('put a creature card from your hand onto the battlefield');

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) => event?.type === 'exertChoice' && event?.payload?.attackerId === 'champion_of_rhonas')).toBe(true);
    expect(events.some((event: any) => event?.type === 'pushTriggeredAbility' && event?.payload?.triggerType === 'exert')).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const modalStep = ResolutionQueueManager.getStepsForPlayer(gameId, attackerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MODAL_CHOICE && entry?.putFromHandData,
    ) as any;
    expect(modalStep).toBeDefined();
    expect((modalStep.options || []).some((entry: any) => entry.id === 'hand_beast')).toBe(true);
  });

  it('replays exertChoice state and the persisted reflexive trigger deterministically', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'combat_celebrant',
        attackerId,
        'Combat Celebrant',
        "If this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase. (An exerted creature won't untap during your next untap step.)",
        4,
        1,
      ),
    ];
    (game.state as any).battlefield[0].attacking = defenderId;

    game.applyEvent({
      type: 'exertChoice',
      playerId: attackerId,
      attackerId: 'combat_celebrant',
    } as any);

    const attacker = ((game.state as any).battlefield || [])[0] as any;
    expect(attacker.doesntUntapNextTurn).toBe(true);
    expect(attacker.exertedThisTurn).toBe(true);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exert_trigger_replay',
      sourceId: 'combat_celebrant',
      permanentId: 'combat_celebrant',
      sourceName: 'Combat Celebrant',
      controllerId: attackerId,
      description: 'untap all other creatures you control and after this phase, there is an additional combat phase',
      triggerType: 'exert',
      effect: 'untap all other creatures you control and after this phase, there is an additional combat phase',
      mandatory: true,
      card: { ...attacker.card },
    } as any);

    expect(((game.state as any).extraCombats || []).length).toBe(0);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(((game.state as any).extraCombats || []).length).toBe(1);
    expect(((game.state as any).extraCombats || [])[0]?.source).toBe('Combat Celebrant');
  });

  it('supports self-buff exert rewards like Glory-Bound Initiate through the same exert queue path', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'glory_bound_initiate',
        attackerId,
        'Glory-Bound Initiate',
        "You may exert this creature as it attacks. When you do, it gets +1/+3 and gains lifelink until end of turn. (An exerted creature won't untap during your next untap step.)",
        3,
        1,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'glory_bound_initiate', targetPlayerId: defenderId }],
    });

    const step = findExertStep(gameId, attackerId) as any;
    expect(step).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[]).length).toBe(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const initiate = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'glory_bound_initiate') as any;
    expect(Array.isArray(initiate?.temporaryPTMods)).toBe(true);
    expect(initiate.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
    expect(Array.isArray(initiate?.temporaryAbilities)).toBe(true);
    expect(initiate.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: 'lifelink', expiresAt: 'end_of_turn' }),
    ]);
  });

  it('queues target selection for target-based exert rewards like Ahn-Crop Crasher and persists the chosen target on the reflexive trigger', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'ahn_crop_crasher',
        attackerId,
        'Ahn-Crop Crasher',
        "You may exert this creature as it attacks. When you do, target creature can't block this turn. (An exerted creature won't untap during your next untap step.)",
        3,
        2,
      ),
      createAttacker('defender_wall', defenderId, 'Defender Wall', '', 0, 4),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'ahn_crop_crasher', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[]).length).toBe(0);

    const targetStep = findTargetSelectionStep(gameId, attackerId, (entry: any) => entry?.exertTargetChoice === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((entry: any) => entry.id)).toContain('defender_wall');

    const eventStart = getEvents(gameId).length;
    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['defender_wall'],
    });

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(1);
    expect(stack[0]?.targets).toEqual(['defender_wall']);

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'pushTriggeredAbility' &&
      event?.payload?.triggerType === 'exert' &&
      Array.isArray(event?.payload?.targets) &&
      event.payload.targets.includes('defender_wall'),
    )).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const blockedCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'defender_wall') as any;
    expect(blockedCreature.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: "can't block", expiresAt: 'end_of_turn' }),
    ]);
  });

  it('supports untap-all-other exert rewards like Ahn-Crop Champion without untapping the exerted attacker itself', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'ahn_crop_champion',
        attackerId,
        'Ahn-Crop Champion',
        'You may exert this creature as it attacks. When you do, untap all other creatures you control. (An exerted creature won\'t untap during your next untap step.)',
        4,
        4,
      ),
      {
        ...createAttacker('support_creature', attackerId, 'Support Creature', '', 2, 2),
        tapped: true,
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'ahn_crop_champion', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const champion = battlefield.find((permanent: any) => permanent?.id === 'ahn_crop_champion') as any;
    const supportCreature = battlefield.find((permanent: any) => permanent?.id === 'support_creature') as any;

    expect(supportCreature?.tapped).toBe(false);
    expect(champion?.tapped).toBe(true);
  });

  it('supports draw-card exert rewards like Watchful Naga', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'watchful_naga',
        attackerId,
        'Watchful Naga',
        "You may exert this creature as it attacks. When you do, draw a card. (An exerted creature won't untap during your next untap step.)",
        2,
        2,
      ),
    ];
    (game.state as any).zones[attackerId].library = [
      createCreatureCard('watchful_draw', 'Watchful Draw', 1, 1),
    ];
    (game.state as any).zones[attackerId].libraryCount = 1;
    (game as any).libraries.set(attackerId, (game.state as any).zones[attackerId].library);
    (game as any).libraries.set(defenderId, []);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'watchful_naga', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const attackerZones = (game.state as any).zones[attackerId] as any;
    expect((attackerZones.hand || []).map((card: any) => card?.id)).toContain('watchful_draw');
    expect(attackerZones.handCount).toBe(1);
    expect(attackerZones.libraryCount).toBe(0);
  });

  it('supports team-pump exert rewards like Tah-Crop Elite', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'tah_crop_elite',
        attackerId,
        'Tah-Crop Elite',
        "Flying\nYou may exert this creature as it attacks. When you do, creatures you control get +1/+1 until end of turn. (An exerted creature won't untap during your next untap step.)",
        2,
        2,
      ),
      createAttacker('ally_creature', attackerId, 'Ally Creature', '', 3, 3),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'tah_crop_elite', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const elite = battlefield.find((permanent: any) => permanent?.id === 'tah_crop_elite') as any;
    const ally = battlefield.find((permanent: any) => permanent?.id === 'ally_creature') as any;

    expect(elite?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
    expect(ally?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 1, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('supports self-unblockable plus scry exert rewards like Clockwork Droid', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'clockwork_droid',
        attackerId,
        'Clockwork Droid',
        "You may exert this creature as it attacks. When you do, it can't be blocked this turn and you scry 1. (An exerted creature won't untap during your next untap step. To scry 1, look at the top card of your library. You may put that card on the bottom.)",
        3,
        1,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'clockwork_droid', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const droid = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'clockwork_droid') as any;
    expect(droid?.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: "can't be blocked", expiresAt: 'end_of_turn' }),
    ]);
    expect((game.state as any).pendingScry?.[attackerId]).toBe(1);
  });
});