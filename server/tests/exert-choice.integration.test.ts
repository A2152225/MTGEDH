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

function findGraveyardSelectionStep(gameId: string, playerId: PlayerID, predicate?: (entry: any) => boolean) {
  const matches = (entry: any) =>
    entry?.type === ResolutionStepType.GRAVEYARD_SELECTION &&
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
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

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
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

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
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

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

  it('allows plain attack-time exert and fires whenever-you-exert watchers like Trueheart Twins', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'trueheart_twins',
        attackerId,
        'Trueheart Twins',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, creatures you control get +1/+0 until end of turn.",
        4,
        4,
      ),
      createAttacker(
        'supporting_ally',
        attackerId,
        'Supporting Ally',
        '',
        2,
        2,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'trueheart_twins', targetPlayerId: defenderId }],
    });

    const step = findExertStep(gameId, attackerId) as any;
    expect(step).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: 'exert',
    });

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toEqual(expect.objectContaining({
      source: 'trueheart_twins',
      permanentId: 'trueheart_twins',
      sourceName: 'Trueheart Twins',
      effect: 'creatures you control get +1/+0 until end of turn.',
    }));

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const twins = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'trueheart_twins') as any;
    const ally = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'supporting_ally') as any;
    expect(twins.doesntUntapNextTurn).toBe(true);
    expect(twins.exertedThisTurn).toBe(true);
    expect(twins.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
    expect(ally.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 1, toughness: 0, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('fires damage-and-life whenever-you-exert watchers like Resolute Survivors', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'resolute_survivors',
        attackerId,
        'Resolute Survivors',
        "You may exert this creature as it attacks. (It won't untap during your next untap step.)\nWhenever you exert a creature, this creature deals 1 damage to each opponent and you gain 1 life.",
        3,
        3,
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'resolute_survivors', targetPlayerId: defenderId }],
    });

    const step = findExertStep(gameId, attackerId) as any;
    expect(step).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: 'exert',
    });

    expect((((game.state as any).stack || []) as any[])).toHaveLength(1);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect((game.state as any).life[attackerId]).toBe(41);
    expect((game.state as any).life[defenderId]).toBe(39);
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
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

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

    (game.state as any).step = 'declareBlockers';
    const emitStart = emitted.length;
    await defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'defender_wall', attackerId: 'ahn_crop_crasher' }],
    });

    const newEmits = emitted.slice(emitStart);
    expect(newEmits.some((entry) => entry.event === 'error' && entry.payload?.code === 'CANT_BLOCK')).toBe(true);
    const attacker = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'ahn_crop_crasher') as any;
    expect(attacker?.blockedBy).toBeUndefined();
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

  it('queues graveyard selection for Devoted Crop-Mate and binds the selected card onto the reflexive trigger', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'devoted_crop_mate',
        attackerId,
        'Devoted Crop-Mate',
        "You may exert this creature as it attacks. When you do, return target creature card with mana value 2 or less from your graveyard to the battlefield. (An exerted creature won't untap during your next untap step.)",
        3,
        2,
      ),
    ];
    (game.state as any).zones[attackerId].graveyard = [
      {
        id: 'cheap_return',
        name: 'Cheap Return',
        type_line: 'Creature - Cleric',
        oracle_text: '',
        mana_cost: '{1}{W}',
        cmc: 2,
        power: '2',
        toughness: '2',
      },
      {
        id: 'expensive_return',
        name: 'Expensive Return',
        type_line: 'Creature - Angel',
        oracle_text: '',
        mana_cost: '{3}{W}',
        cmc: 4,
        power: '4',
        toughness: '4',
      },
    ];
    (game.state as any).zones[attackerId].graveyardCount = 2;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'devoted_crop_mate', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    const graveyardStep = findGraveyardSelectionStep(gameId, attackerId, (entry: any) => entry?.exertGraveyardTargetChoice === true) as any;
    expect(graveyardStep).toBeDefined();
    expect((graveyardStep.validTargets || []).map((entry: any) => entry.id)).toContain('cheap_return');
    expect((graveyardStep.validTargets || []).map((entry: any) => entry.id)).not.toContain('expensive_return');

    const eventStart = getEvents(gameId).length;
    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(graveyardStep.id),
      selections: ['cheap_return'],
    });

    const stack = (((game.state as any).stack || []) as any[]);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      targets: ['cheap_return'],
      boundGraveyardCardId: 'cheap_return',
      boundGraveyardOwnerId: attackerId,
      preselectedTargetsPersisted: true,
    });

    const events = getEvents(gameId).slice(eventStart);
    expect(events.some((event: any) =>
      event?.type === 'pushTriggeredAbility' &&
      event?.payload?.triggerType === 'exert' &&
      event?.payload?.boundGraveyardCardId === 'cheap_return' &&
      event?.payload?.boundGraveyardOwnerId === attackerId,
    )).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const returnedPermanent = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => String(permanent?.card?.id || '') === 'cheap_return',
    ) as any;
    expect(returnedPermanent).toMatchObject({
      controller: attackerId,
      owner: attackerId,
    });
    expect(((game.state as any).zones[attackerId]?.graveyard || []).map((card: any) => card?.id)).toEqual(['expensive_return']);
  });

  it('filters non-Dragon targets for Glorybringer and applies the damage trigger to the chosen creature', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'glorybringer',
        attackerId,
        'Glorybringer',
        "You may exert this creature as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls. (An exerted creature won't untap during your next untap step.)",
        4,
        4,
      ),
      {
        ...createAttacker('dragon_target', defenderId, 'Dragon Target', '', 4, 4),
        card: {
          id: 'dragon_target_card',
          name: 'Dragon Target',
          type_line: 'Creature - Dragon',
          oracle_text: '',
          power: '4',
          toughness: '4',
        },
      },
      createAttacker('beast_target', defenderId, 'Beast Target', '', 2, 2),
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
      attackers: [{ creatureId: 'glorybringer', targetPlayerId: defenderId }],
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

    const targetStep = findTargetSelectionStep(gameId, attackerId, (entry: any) => entry?.targetedTriggeredAbility === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((entry: any) => entry.id)).toContain('beast_target');
    expect((targetStep.validTargets || []).map((entry: any) => entry.id)).not.toContain('dragon_target');

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['beast_target'],
    });

    const beastTarget = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'beast_target') as any;
    const dragonTarget = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'dragon_target') as any;
    expect(beastTarget?.damageMarked).toBe(4);
    expect(dragonTarget?.damageMarked || 0).toBe(0);
  });

  it('prevents combat damage to Oketra\'s Avenger after the exert trigger resolves', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'oketras_avenger',
        attackerId,
        "Oketra's Avenger",
        "You may exert this creature as it attacks. When you do, prevent all combat damage that would be dealt to it this turn. (An exerted creature won't untap during your next untap step.)",
        3,
        1,
      ),
      createAttacker('large_blocker', defenderId, 'Large Blocker', '', 4, 4),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'oketras_avenger', targetPlayerId: defenderId }],
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

    const avengerBeforeBlocks = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'oketras_avenger') as any;
    expect(avengerBeforeBlocks?.temporaryAbilities).toEqual([
      expect.objectContaining({
        ability: 'prevent all combat damage that would be dealt to this creature this turn',
        expiresAt: 'end_of_turn',
      }),
    ]);

    (game.state as any).step = 'declareBlockers';
    await defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'large_blocker', attackerId: 'oketras_avenger' }],
    });

    game.applyEvent({ type: 'nextStep' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const avenger = battlefield.find((permanent: any) => permanent?.id === 'oketras_avenger') as any;
    const blocker = battlefield.find((permanent: any) => permanent?.id === 'large_blocker') as any;
    expect(Number(avenger?.markedDamage || 0)).toBe(0);
    expect(Number(blocker?.markedDamage || 0)).toBe(3);
    expect(avenger?.markedForDestruction).toBeUndefined();
  });

  it('prevents creatures with power 2 or less from blocking Rhonas\'s Stalwart after exerting', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'rhonas_stalwart',
        attackerId,
        "Rhonas's Stalwart",
        "You may exert this creature as it attacks. When you do, it can't be blocked by creatures with power 2 or less this turn. (An exerted creature won't untap during your next untap step.)",
        2,
        2,
      ),
      createAttacker('small_blocker', defenderId, 'Small Blocker', '', 2, 2),
      createAttacker('large_blocker', defenderId, 'Large Blocker', '', 3, 3),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);
    registerCombatHandlers(io as any, defenderSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'rhonas_stalwart', targetPlayerId: defenderId }],
    });

    const exertStep = findExertStep(gameId, attackerId) as any;
    expect(exertStep).toBeDefined();

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(exertStep.id),
      selections: 'exert',
    });

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const attackerBeforeBlocks = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'rhonas_stalwart') as any;
    expect(attackerBeforeBlocks?.temporaryAbilities).toEqual([
      expect.objectContaining({ ability: "can't be blocked by creatures with power 2 or less this turn", expiresAt: 'end_of_turn' }),
    ]);

    (game.state as any).step = 'declareBlockers';
    const emitStart = emitted.length;
    await defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'small_blocker', attackerId: 'rhonas_stalwart' }],
    });

    const failedBlockEmits = emitted.slice(emitStart);
    expect(failedBlockEmits.some((entry) => entry.event === 'error' && entry.payload?.code === 'CANT_BLOCK')).toBe(true);

    const emitStartSuccess = emitted.length;
    await defenderHandlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'large_blocker', attackerId: 'rhonas_stalwart' }],
    });

    const successEmits = emitted.slice(emitStartSuccess);
    expect(successEmits.some((entry) => entry.event === 'error')).toBe(false);

    const attacker = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.id === 'rhonas_stalwart') as any;
    expect(attacker?.blockedBy).toEqual(['large_blocker']);
  });

  it('supports Hydra Trainer exert pumps based on the total counters you control', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      {
        ...createAttacker(
          'hydra_trainer',
          attackerId,
          'Hydra Trainer',
          "You may exert this creature as it attacks. When you do, target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control. (An exerted creature won't untap during your next untap step.)\n{2}{G}: Adapt 2. (If this creature has no +1/+1 counters on it, put two +1/+1 counters on it.)",
          1,
          1,
        ),
        counters: { '+1/+1': 2 },
      },
      createAttacker('counter_target', attackerId, 'Counter Target', '', 2, 2),
      {
        id: 'charge_relic',
        controller: attackerId,
        owner: attackerId,
        tapped: false,
        summoningSickness: false,
        counters: { charge: 1 },
        card: {
          id: 'charge_relic_card',
          name: 'Charge Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
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
      attackers: [{ creatureId: 'hydra_trainer', targetPlayerId: defenderId }],
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

    const targetStep = findTargetSelectionStep(gameId, attackerId, (entry: any) => entry?.targetedTriggeredAbility === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((entry: any) => entry.id)).toEqual(
      expect.arrayContaining(['hydra_trainer', 'counter_target']),
    );

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['counter_target'],
    });

    const target = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'counter_target') as any;
    expect(target?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);
  });

  it('creates a tapped and attacking copy for Sandstorm Crasher and schedules next-end-step sacrifice', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAttacker(
        'sandstorm_crasher',
        attackerId,
        'Sandstorm Crasher',
        "Trample\nYou may exert this creature as it attacks. When you do, create a tapped and attacking token that's a copy of target creature you control. Sacrifice the token at the beginning of the next end step. (An exerted creature won't untap during your next untap step.)",
        3,
        4,
      ),
      createAttacker('copy_source', attackerId, 'Copy Source', '', 5, 5),
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
      attackers: [{ creatureId: 'sandstorm_crasher', targetPlayerId: defenderId }],
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

    const targetStep = findTargetSelectionStep(gameId, attackerId, (entry: any) => entry?.targetedTriggeredAbility === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((entry: any) => entry.id)).toContain('copy_source');

    await attackerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['copy_source'],
    });

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const tokens = battlefield.filter((permanent: any) => permanent?.isToken === true);
    const delayedSacrifice = ((game.state as any).pendingSacrificeAtNextEndStep || []) as any[];
    const delayedExile = ((game.state as any).pendingExileAtEndOfCombat || []) as any[];

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      attacking: defenderId,
      tapped: true,
      copiedFromPermanentId: 'copy_source',
    });
    expect(tokens[0]?.card?.name).toBe('Copy Source');
    expect(delayedSacrifice).toHaveLength(1);
    expect(delayedSacrifice[0]?.permanentId).toBe(tokens[0]?.id);
    expect(delayedExile).toHaveLength(0);
  });
});