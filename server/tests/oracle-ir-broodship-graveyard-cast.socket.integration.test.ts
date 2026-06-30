import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { collectActivatedAbilitySteps } from '../src/state/modules/oracleIrAbilityExecution.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { getActiveDurablePermissions } from '../src/state/modules/durable-permissions.js';
import {
  getActiveGraveyardCastingPermissions,
  getMatchingGraveyardCastingPermission,
} from '../src/state/modules/graveyard-permissions.js';
import { nextStep } from '../src/state/modules/turn.js';
import { ResolutionStepType } from '../src/state/resolution/types.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const BROODSHIP_ORACLE =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n" +
  '3+ | You may play an additional land on each of your turns.\n' +
  '8+ | Flying\n' +
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

const ACTIVATED_TEXT =
  '8+ | Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ event: string; payload: any }>) {
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

function toReplayEvents(gameId: string, startIndex = 0) {
  return transformDbEventsForReplay(getEvents(gameId).slice(startIndex) as any);
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

async function activateBroodshipGraveyardCastPermission(
  gameId: string,
  game: any,
  handlers: Record<string, Function>,
) {
  await handlers['activateBattlefieldAbility']({
    gameId,
    permanentId: 'broodship_1',
    abilityId: 'broodship_1-ability-0',
  });

  game.resolveTopOfStack();

  const queue = ResolutionQueueManager.getQueue(gameId);
  const optionalStep = queue.steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE) as any;
  if (optionalStep) {
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(optionalStep.id),
      selections: ['accept'],
    });
  }
}

function seedBroodshipCastGame(game: any, playerId: string) {
  const mindStone = {
    id: 'broodship_mind_stone_1',
    name: 'Mind Stone',
    mana_cost: '{2}',
    manaCost: '{2}',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}.',
  };

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'precombat_main';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
  };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      graveyard: [mindStone],
      library: [],
      handCount: 0,
      graveyardCount: 1,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'broodship_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: { charge: 8 },
      card: {
        id: 'broodship_card_1',
        name: 'Exploration Broodship',
        type_line: 'Artifact — Spacecraft',
        oracle_text: BROODSHIP_ORACLE,
      },
    },
    {
      id: 'broodship_forest_perm_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: 'broodship_forest_card',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '({T}: Add {G}.)',
      },
    },
  ];

  return { mindStone };
}

describe('Exploration Broodship graveyard cast via Oracle IR (integration)', () => {
  const gameId = 'test_broodship_graveyard_cast_ir';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(`${gameId}_broodship_replay`);
    await resetGame(`${gameId}_consumption`);
    await resetGame(`${gameId}_eot_cleanup`);
    await resetGame(`${gameId}_full_event_replay`);
  });

  it('collects wired IR steps from the 8+ threshold graveyard-cast activation line', () => {
    const steps = collectActivatedAbilitySteps(ACTIVATED_TEXT, 'Exploration Broodship');
    expect(steps.map((step) => step.kind)).toEqual(['conditional']);
  });

  it('does not offer graveyard cast candidates until the 8+ ability is activated', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    seedBroodshipCastGame(game, playerId);

    const candidates = getCastableSpellCandidates(
      { state: game.state, libraries: (game as any).libraries } as any,
      playerId as any,
      { mode: 'main', allowUnknownCostFallback: false },
    );

    expect(candidates.some((candidate: any) => String(candidate?.card?.id || '') === 'broodship_mind_stone_1')).toBe(false);
    expect(getActiveGraveyardCastingPermissions(game.state as any, playerId as any, { permission: 'cast' })).toEqual([]);
  });

  it('activates on the stack through IR and enables casting a graveyard permanent with land sacrifice', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const mindStone = {
      id: 'broodship_mind_stone_1',
      name: 'Mind Stone',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
    };

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnNumber = 1;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        graveyard: [mindStone],
        library: [],
        handCount: 0,
        graveyardCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
      {
        id: 'broodship_forest_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'broodship_forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });

    expect(((game.state as any).stack || []).length).toBe(1);
    expect(String(((game.state as any).stack[0] as any)?.activatedAbilityText || '')).toMatch(/^8\+\s*\|/);

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const optionalStep = queue.steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE) as any;
    if (optionalStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(optionalStep.id),
        selections: ['accept'],
      });
    }

    const permission = ((game.state as any).graveyardCastingPermissions || [])[0] as any;
    expect(permission?.sourceText || '').toMatch(/sacrificing a land in addition to paying its other costs/i);
    expect(String(permission?.sourceText || '').toLowerCase()).not.toMatch(/sacrificing a land[\s\S]*sacrificing a land/);
    expect(permission?.additionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });

    const durablePermission = getActiveDurablePermissions(game.state as any, {
      playerId: playerId as any,
      kind: 'graveyard_permission',
    })[0] as any;
    expect(durablePermission?.id).toBe(String(permission?.id || ''));
    expect(durablePermission?.metadata?.additionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });
    expect(String(durablePermission?.debug?.sourceText || '')).toMatch(
      /sacrificing a land in addition to paying its other costs/i,
    );

    const candidates = getCastableSpellCandidates(
      { state: game.state, libraries: (game as any).libraries } as any,
      playerId as any,
      { mode: 'main', allowUnknownCostFallback: false },
    );
    const broodshipCandidate = candidates.find(
      (candidate: any) => String(candidate?.card?.id || '') === 'broodship_mind_stone_1',
    );
    expect(broodshipCandidate?.castMethod).toBe('graveyard_permanent');
    expect(broodshipCandidate?.sourceGrantedAdditionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });

    await handlers['requestCastSpell']({
      gameId,
      cardId: 'broodship_mind_stone_1',
      fromZone: 'graveyard',
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const sacrificeStep = queue.steps.find(
      (step: any) =>
        step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
        && step.costType === 'sacrifice'
        && step.cardId === 'broodship_mind_stone_1',
    ) as any;
    expect(sacrificeStep).toBeDefined();
    expect((sacrificeStep.availableTargets || []).map((target: any) => target.id)).toEqual(['broodship_forest_perm_1']);
  });

  it('serves Broodship graveyard cast from durable mirror when first-class permissions are cleared', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const mindStone = {
      id: 'broodship_mind_stone_1',
      name: 'Mind Stone',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
    };

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnNumber = 1;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        graveyard: [mindStone],
        library: [],
        handCount: 0,
        graveyardCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
      {
        id: 'broodship_forest_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'broodship_forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });
    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const optionalStep = queue.steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE) as any;
    if (optionalStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(optionalStep.id),
        selections: ['accept'],
      });
    }

    const permissionId = String(((game.state as any).graveyardCastingPermissions || [])[0]?.id || '');
    expect(permissionId).toBeTruthy();
    delete (game.state as any).graveyardCastingPermissions;

    const restored = getMatchingGraveyardCastingPermission(game.state as any, playerId as any, mindStone, 'cast');
    expect(restored?.id).toBe(permissionId);
    expect(restored?.additionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });

    const candidate = getCastableSpellCandidates(
      { state: game.state, libraries: (game as any).libraries } as any,
      playerId as any,
      { mode: 'main', allowUnknownCostFallback: false },
    ).find((entry: any) => String(entry?.card?.id || '') === 'broodship_mind_stone_1');

    expect(candidate?.sourceGrantedAdditionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });
    expect(candidate?.graveyardPermissionId).toBe(permissionId);
  });

  it('blocks a second activation after the once-per-turn graveyard-cast ability resolves', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnNumber = 1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        graveyard: [],
        library: [],
        handCount: 0,
        graveyardCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });
    expect(((game.state as any).stack || []).length).toBe(1);

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const optionalStep = queue.steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE) as any;
    if (optionalStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(optionalStep.id),
        selections: ['decline'],
      });
    }

    const broodship = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'broodship_1');
    expect(broodship?.activatedAbilityIndicesThisTurn?.[0]).toBe(true);

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });

    const errorPayload = emitted.find((entry) => entry.event === 'error')?.payload;
    expect(errorPayload?.code).toBe('ABILITY_ALREADY_USED');
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('blocks a second activation while the once-per-turn ability is still on the stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });
    expect(((game.state as any).stack || []).length).toBe(1);

    emitted.length = 0;
    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });

    const errorPayload = emitted.find((entry) => entry.event === 'error')?.payload;
    expect(errorPayload?.code).toBe('ABILITY_ALREADY_USED');
    expect(((game.state as any).stack || []).length).toBe(1);
  });

  it('blocks activation when the player already cast from their graveyard this turn', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).castFromGraveyardThisTurn = { [playerId]: true };
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createNoopIo();

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });

    const errorPayload = emitted.find((entry) => entry.event === 'error')?.payload;
    expect(errorPayload?.code).toBe('ABILITY_ALREADY_USED');
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('blocks a second graveyard permanent cast after Broodship permission is consumed', async () => {
    const consumptionGameId = `${gameId}_consumption`;
    await resetGame(consumptionGameId);
    createGameIfNotExists(consumptionGameId, 'commander', 40);
    const game = ensureGame(consumptionGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const { mindStone } = seedBroodshipCastGame(game, playerId);

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(consumptionGameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await activateBroodshipGraveyardCastPermission(consumptionGameId, game, handlers);

    await handlers['requestCastSpell']({
      gameId: consumptionGameId,
      cardId: mindStone.id,
      fromZone: 'graveyard',
    });

    const sacrificeStep = ResolutionQueueManager.getQueue(consumptionGameId).steps.find((step: any) =>
      step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && step.costType === 'sacrifice'
      && step.cardId === mindStone.id,
    ) as any;
    expect(sacrificeStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: consumptionGameId,
      stepId: String(sacrificeStep.id),
      selections: ['broodship_forest_perm_1'],
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager.getQueue(consumptionGameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === mindStone.id,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: consumptionGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 2 }],
      },
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      game.resolveTopOfStack();
    }

    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((((game.state as any).battlefield || []) as any[]).some((entry: any) => entry?.card?.id === mindStone.id)).toBe(true);

    const solRing = {
      id: 'broodship_sol_ring_1',
      name: 'Sol Ring',
      mana_cost: '{1}',
      manaCost: '{1}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    };
    (game.state as any).zones[playerId].graveyard.push(solRing);
    (game.state as any).zones[playerId].graveyardCount = 2;

    const secondCandidate = getCastableSpellCandidates(
      { state: game.state, libraries: (game as any).libraries } as any,
      playerId as any,
      { mode: 'main', allowUnknownCostFallback: false },
    ).find((candidate: any) => String(candidate?.card?.id || '') === solRing.id);
    expect(secondCandidate).toBeUndefined();

    emitted.length = 0;
    await handlers['requestCastSpell']({
      gameId: consumptionGameId,
      cardId: solRing.id,
      fromZone: 'graveyard',
    });
    const errorPayload = emitted.find((entry) => entry.event === 'error')?.payload;
    expect(errorPayload?.code).toBe('NO_PERMISSION');
  });

  it('replays Broodship graveyard-cast sacrifice continuation after durable mirror activation', async () => {
    const replayGameId = `${gameId}_broodship_replay`;
    createGameIfNotExists(replayGameId, 'commander', 40);
    const game = ensureGame(replayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    seedBroodshipCastGame(game, playerId);

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(replayGameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await activateBroodshipGraveyardCastPermission(replayGameId, game, handlers);

    const durableSnapshot = structuredClone((game.state as any).durablePermissions);
    expect(durableSnapshot?.[0]?.metadata?.additionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });

    await handlers['requestCastSpell']({
      gameId: replayGameId,
      cardId: 'broodship_mind_stone_1',
      fromZone: 'graveyard',
    });

    const continuationEvent = [...getEvents(replayGameId)].reverse().find((event: any) =>
      event.type === 'castSpellContinuation'
      && String((event as any)?.payload?.cardId || '') === 'broodship_mind_stone_1',
    ) as any;
    expect(continuationEvent).toBeDefined();
    expect(continuationEvent?.payload?.queuedResolutionStep?.costType).toBe('sacrifice');

    const zonesSnapshot = structuredClone((game.state as any).zones);
    const battlefieldSnapshot = structuredClone((game.state as any).battlefield);
    const manaPoolSnapshot = structuredClone((game.state as any).manaPool);

    game.reset!(true);
    seedBroodshipCastGame(game, playerId);
    (game.state as any).zones = zonesSnapshot;
    (game.state as any).battlefield = battlefieldSnapshot;
    (game.state as any).manaPool = manaPoolSnapshot;
    (game.state as any).durablePermissions = durableSnapshot;
    delete (game.state as any).graveyardCastingPermissions;

    ResolutionQueueManager.removeQueue(replayGameId);
    const [flatContinuation] = transformDbEventsForReplay([continuationEvent] as any);
    game.applyEvent!(flatContinuation as any);

    const replayedDurable = getActiveDurablePermissions(game.state as any, {
      playerId: playerId as any,
      kind: 'graveyard_permission',
    })[0] as any;
    expect(replayedDurable?.metadata?.additionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });

    const replaySacrificeStep = ResolutionQueueManager.getQueue(replayGameId).steps.find((step: any) =>
      step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && step.costType === 'sacrifice'
      && step.cardId === 'broodship_mind_stone_1',
    ) as any;
    expect(replaySacrificeStep).toBeDefined();
    expect((replaySacrificeStep.availableTargets || []).map((target: any) => target.id)).toEqual(['broodship_forest_perm_1']);

    delete (game.state as any).pendingSpellCasts;
    ResolutionQueueManager.removeQueue(replayGameId);
  });

  it('replays the full Broodship activation-to-graveyard-cast event log through sacrifice and mana payment', async () => {
    const fullReplayGameId = `${gameId}_full_event_replay`;
    createGameIfNotExists(fullReplayGameId, 'commander', 40);
    const game = ensureGame(fullReplayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const { mindStone } = seedBroodshipCastGame(game, playerId);

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(fullReplayGameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const eventStart = getEvents(fullReplayGameId).length;

    await activateBroodshipGraveyardCastPermission(fullReplayGameId, game, handlers);

    await handlers['requestCastSpell']({
      gameId: fullReplayGameId,
      cardId: mindStone.id,
      fromZone: 'graveyard',
    });

    const sacrificeStep = ResolutionQueueManager.getQueue(fullReplayGameId).steps.find((step: any) =>
      step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && step.costType === 'sacrifice'
      && step.cardId === mindStone.id,
    ) as any;
    expect(sacrificeStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: fullReplayGameId,
      stepId: String(sacrificeStep.id),
      selections: ['broodship_forest_perm_1'],
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager.getQueue(fullReplayGameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === mindStone.id,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: fullReplayGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 2 }],
      },
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      game.resolveTopOfStack();
    }

    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((((game.state as any).battlefield || []) as any[]).some((entry: any) => entry?.card?.id === mindStone.id)).toBe(true);
    expect((((game.state as any).battlefield || []) as any[]).some((entry: any) => entry?.id === 'broodship_forest_perm_1')).toBe(false);

    const replayEvents = toReplayEvents(fullReplayGameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining([
        'activateBattlefieldAbility',
        'castSpellContinuation',
      ]),
    );

    game.reset!(true);
    seedBroodshipCastGame(game, playerId);
    ResolutionQueueManager.removeQueue(fullReplayGameId);
    delete (game.state as any).pendingSpellCasts;
    game.replay!(replayEvents as any);

    // castSpell replay pushes onto stack; resolveTopOfStack is not persisted during live play.
    safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      game.resolveTopOfStack();
    }

    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((((game.state as any).battlefield || []) as any[]).some((entry: any) => entry?.card?.id === mindStone.id)).toBe(true);
    expect((((game.state as any).battlefield || []) as any[]).some((entry: any) => entry?.id === 'broodship_forest_perm_1')).toBe(false);

    const replayedDurable = getActiveDurablePermissions(game.state as any, {
      playerId: playerId as any,
      kind: 'graveyard_permission',
    });
    expect(replayedDurable.some((entry: any) => entry?.metadata?.additionalCost?.type === 'sacrifice')).toBe(true);

    delete (game.state as any).pendingSpellCasts;
    ResolutionQueueManager.removeQueue(fullReplayGameId);
  });

  it('clears Broodship this_turn graveyard permissions from first-class and durable stores at end of turn', async () => {
    const eotGameId = `${gameId}_eot_cleanup`;
    createGameIfNotExists(eotGameId, 'commander', 40);
    const game = ensureGame(eotGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    seedBroodshipCastGame(game, playerId);

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(eotGameId);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await activateBroodshipGraveyardCastPermission(eotGameId, game, handlers);

    const permissionId = String(((game.state as any).graveyardCastingPermissions || [])[0]?.id || '');
    expect(permissionId).not.toBe('');
    expect(getActiveGraveyardCastingPermissions(game.state as any, playerId as any, { permission: 'cast' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: permissionId,
          duration: 'this_turn',
          additionalCost: {
            type: 'sacrifice',
            amount: 1,
            filter: 'land',
          },
        }),
      ]),
    );
    expect(getActiveDurablePermissions(game.state as any, {
      playerId: playerId as any,
      kind: 'graveyard_permission',
    })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: permissionId,
          duration: 'this_turn',
          metadata: expect.objectContaining({
            additionalCost: {
              type: 'sacrifice',
              amount: 1,
              filter: 'land',
            },
          }),
        }),
      ]),
    );

    (game.state as any).phase = 'ending';
    (game.state as any).step = 'CLEANUP';
    (game.state as any).stack = [];
    nextStep(game as any);

    expect(((game.state as any).graveyardCastingPermissions || []).map((entry: any) => entry.id)).not.toContain(permissionId);
    expect(getActiveDurablePermissions(game.state as any, {
      playerId: playerId as any,
      kind: 'graveyard_permission',
    }).map((entry: any) => entry.id)).not.toContain(permissionId);
    expect(getActiveGraveyardCastingPermissions(game.state as any, playerId as any, { permission: 'cast' })
      .some((entry) => entry.id === permissionId)).toBe(false);
    expect(getMatchingGraveyardCastingPermission(
      game.state as any,
      playerId as any,
      {
        id: 'broodship_mind_stone_1',
        name: 'Mind Stone',
        type_line: 'Artifact',
      },
      'cast',
    )?.id).not.toBe(permissionId);
  });
});
