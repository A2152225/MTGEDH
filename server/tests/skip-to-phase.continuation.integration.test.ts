import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import type { PlayerID } from '../../shared/src/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
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

async function resetGame(gameId: string) {
  await resetIntegrationGame(gameId);
}

async function passPriorityRound(
  handlersP2: Record<string, Function>,
  handlersP1: Record<string, Function>,
  gameId: string,
) {
  await handlersP2['passPriority']({ gameId });
  await handlersP1['passPriority']({ gameId });
}

describe('skipToPhase continuation (integration)', () => {
  const gameId = 'test_skip_to_phase_continuation';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('stops at BEGIN_COMBAT when skipping MAIN1 to MAIN2 with a begin-combat trigger', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'ouro_perm',
        controller: p2,
        owner: p2,
        basePower: 3,
        baseToughness: 3,
        tapped: false,
        card: {
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          oracle_text:
            "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
          power: '3',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, gameId, emitted);
    registerGameActions(io, socketP2 as any);
    registerGameActions(io, socketP1 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('BEGIN_COMBAT');
    expect(String((game.state as any).phase || '')).toBe('combat');
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p2,
      skipOriginPhase: 'precombatmain',
      skipOriginStep: 'MAIN1',
    });
  });

  it('continues to MAIN2 after begin-combat triggers resolve via passPriority', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'ouro_perm',
        controller: p2,
        owner: p2,
        basePower: 3,
        baseToughness: 3,
        tapped: false,
        card: {
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          oracle_text:
            "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
          power: '3',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, gameId, emitted);
    registerGameActions(io, socketP2 as any);
    registerGameActions(io, socketP1 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('BEGIN_COMBAT');
    expect((game.state as any).pendingPhaseSkip?.targetStep).toBe('MAIN2');

    await handlersP2['passPriority']({ gameId });
    expect(String((game.state as any).priority || '')).toBe(p1);

    await handlersP1['passPriority']({ gameId });

    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('stops at MAIN1 when skipping UPKEEP to MAIN2 with a saga on the battlefield', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const sagaOracle =
      'I — Create a 1/1 white Soldier creature token.\n' +
      'II — Create two 1/1 white Soldier creature tokens.\n' +
      'III — You gain 5 life.';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'saga_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: { lore: 0 },
        card: {
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: sagaOracle,
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    registerGameActions(io, socketP2 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('MAIN1');
    expect(String((game.state as any).phase || '')).toBe('precombatMain');
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p2,
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UPKEEP',
    });

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.some((item: any) => String(item?.source || item?.permanentId || '') === 'saga_perm')).toBe(true);
    expect(stack.some((item: any) => String(item?.triggerType || '') === 'saga_chapter')).toBe(true);
    const saga = (game.state as any).battlefield.find((p: any) => p.id === 'saga_perm');
    expect(saga?.counters?.lore).toBe(1);
    expect((game.state as any)._pendingAttractionVisitRollPlayer).toBe(p2);
  });

  it('continues to MAIN2 via passPriority when stack is already empty at BEGIN_COMBAT', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'BEGIN_COMBAT';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).pendingPhaseSkip = {
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p2,
      skipOriginPhase: 'precombatmain',
      skipOriginStep: 'MAIN1',
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, gameId, emitted);
    registerGameActions(io, socketP2 as any);
    registerGameActions(io, socketP1 as any);

    await handlersP2['passPriority']({ gameId });
    await handlersP1['passPriority']({ gameId });

    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
  });

  it('continues through DRAW when skipping UPKEEP to MAIN2 with only an additional-draw effect', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: {
        hand: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        libraryCount: 2,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    game.libraries.set(p2, [
      { id: 'lib_draw_1', name: 'Island' },
      { id: 'lib_draw_2', name: 'Forest' },
    ]);
    (game.state as any).battlefield = [
      {
        id: 'sun_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          name: 'The Immortal Sun',
          type_line: 'Legendary Artifact',
          oracle_text: 'At the beginning of your draw step, draw an additional card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    registerGameActions(io, socketP2 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    // Spec conflict: additional-draw-only draw-step effects (Howling Mine /
    // Immortal Sun) are applied via calculateAdditionalDraws, not the stack.
    // Skip therefore does not stop at DRAW for those cards.
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
    expect((game.state.zones?.[p2]?.handCount ?? 0)).toBeGreaterThanOrEqual(1);
    expect(
      ((game.state as any).stack || []).some(
        (item: any) => String(item?.sourceName || item?.cardName || '') === 'The Immortal Sun',
      ),
    ).toBe(false);
  });

  it('stops at END_COMBAT when skipping MAIN1 to MAIN2 with an end-of-combat trigger', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'end_combat_perm',
        controller: p2,
        owner: p2,
        card: {
          name: 'Conditional End Combat',
          oracle_text: 'At end of combat, if you control a creature, draw a card.',
        },
      },
      {
        id: 'bear_perm',
        controller: p2,
        owner: p2,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    registerGameActions(io, socketP2 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('END_COMBAT');
    expect(String((game.state as any).phase || '')).toBe('combat');
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetStep: 'MAIN2',
      requestedBy: p2,
    });
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
    expect(
      ((game.state as any).stack || []).some(
        (item: any) => String(item?.source || item?.permanentId || '') === 'end_combat_perm',
      ),
    ).toBe(true);
  });

  it('skips DRAW additional-draw-only and stops at MAIN1 saga when skipping UPKEEP to MAIN2', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const sagaOracle =
      'I — Create a 1/1 white Soldier creature token.\n' +
      'II — Create two 1/1 white Soldier creature tokens.\n' +
      'III — You gain 5 life.';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'sun_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          name: 'The Immortal Sun',
          type_line: 'Legendary Artifact',
          oracle_text: 'At the beginning of your draw step, draw an additional card.',
        },
      },
      {
        id: 'saga_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: { lore: 0 },
        card: {
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: sagaOracle,
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, gameId, emitted);
    registerGameActions(io, socketP2 as any);
    registerGameActions(io, socketP1 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    // Spec conflict: Immortal Sun no longer queues a DRAW stack trigger, so skip
    // continues through DRAW and stops at the saga chapter on MAIN1.
    expect(String((game.state as any).step || '')).toBe('MAIN1');
    expect(String((game.state as any).phase || '')).toBe('precombatMain');
    expect((game.state as any).pendingPhaseSkip?.targetStep).toBe('MAIN2');
    expect(
      ((game.state as any).stack || []).some(
        (item: any) => String(item?.source || item?.permanentId || '') === 'saga_perm',
      ),
    ).toBe(true);
    expect(
      ((game.state as any).stack || []).some(
        (item: any) => String(item?.triggerType || '') === 'saga_chapter',
      ),
    ).toBe(true);
    expect(
      (game.state as any).battlefield.find((p: any) => p.id === 'saga_perm')?.counters?.lore,
    ).toBe(1);
  });

  it('stops at UPKEEP when skipping from UPKEEP to MAIN2 with an upkeep trigger', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'arena_perm',
        controller: p2,
        owner: p2,
        card: {
          name: 'Phyrexian Arena',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    registerGameActions(io, socketP2 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetStep: 'MAIN2',
      requestedBy: p2,
      lastStopStep: 'UPKEEP',
    });
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
  });

  it('stops at MAIN2 when skipping MAIN1 to MAIN2 with a postcombat main trigger', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'savior_perm',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          name: 'Savior of the Small',
          type_line: 'Creature — Kithkin Soldier',
          oracle_text:
            'At the beginning of your second main phase, if this creature is tapped, return target creature card with mana value 3 or less from your graveyard to your hand.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    registerGameActions(io, socketP2 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetStep: 'MAIN2',
      requestedBy: p2,
      lastStopStep: 'MAIN2',
    });
    expect(
      ((game.state as any).stack || []).some(
        (item: any) => String(item?.source || item?.permanentId || '') === 'savior_perm',
      ),
    ).toBe(true);
  });

  it('chains UPKEEP → MAIN1 → BEGIN_COMBAT → MAIN2 when skipping from UPKEEP (additional-draw DRAW is not a stop)', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const sagaOracle =
      'I — Create a 1/1 white Soldier creature token.\n' +
      'II — Create two 1/1 white Soldier creature tokens.\n' +
      'III — You gain 5 life.';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: {
        hand: [],
        graveyard: [],
        exile: [],
        library: [{ id: 'lib_1', name: 'Island' }],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'upkeep_perm',
        controller: p2,
        owner: p2,
        card: {
          name: 'Test Upkeep Draw',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, draw a card.',
        },
      },
      {
        id: 'sun_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          name: 'The Immortal Sun',
          type_line: 'Legendary Artifact',
          oracle_text: 'At the beginning of your draw step, draw an additional card.',
        },
      },
      {
        id: 'saga_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: { lore: 0 },
        card: {
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: sagaOracle,
        },
      },
      {
        id: 'ouro_perm',
        controller: p2,
        owner: p2,
        basePower: 3,
        baseToughness: 3,
        tapped: false,
        card: {
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          oracle_text:
            "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
          power: '3',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, gameId, emitted);
    registerGameActions(io, socketP2 as any);
    registerGameActions(io, socketP1 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('UPKEEP');

    await passPriorityRound(handlersP2, handlersP1, gameId);
    expect(String((game.state as any).step || '')).toBe('MAIN1');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('MAIN1');

    await passPriorityRound(handlersP2, handlersP1, gameId);
    expect(String((game.state as any).step || '')).toBe('BEGIN_COMBAT');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('BEGIN_COMBAT');

    await passPriorityRound(handlersP2, handlersP1, gameId);
    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('stops at UPKEEP when skipping UNTAP to MAIN2, untapping before upkeep triggers', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'tapped_land',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'upkeep_perm',
        controller: p2,
        owner: p2,
        card: {
          name: 'Test Upkeep Draw',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    registerGameActions(io, socketP2 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect(String((game.state as any).phase || '')).toBe('beginning');
    expect((game.state as any).pendingPhaseSkip).toMatchObject({
      targetStep: 'MAIN2',
      requestedBy: p2,
      skipOriginPhase: 'beginning',
      skipOriginStep: 'UNTAP',
      lastStopStep: 'UPKEEP',
      untapStepActionPerformed: true,
    });
    expect((game.state as any).pendingPhaseSkip?.untappedDuringSkipIds).toContain('tapped_land');
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((p: any) => p.id === 'tapped_land')?.tapped).toBe(false);
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
  });

  it('chains UNTAP → UPKEEP → MAIN1 → BEGIN_COMBAT → MAIN2 when skipping from UNTAP (additional-draw DRAW is not a stop)', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const sagaOracle =
      'I — Create a 1/1 white Soldier creature token.\n' +
      'II — Create two 1/1 white Soldier creature tokens.\n' +
      'III — You gain 5 life.';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p2);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 2;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).priorityPassedBy = new Set<string>();
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: {
        hand: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 1,
      },
    };
    game.libraries.set(p2, [{ id: 'lib_1', name: 'Island' }]);
    (game.state as any).battlefield = [
      {
        id: 'tapped_land',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'upkeep_perm',
        controller: p2,
        owner: p2,
        card: {
          name: 'Test Upkeep Draw',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your upkeep, draw a card.',
        },
      },
      {
        id: 'sun_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          name: 'The Immortal Sun',
          type_line: 'Legendary Artifact',
          oracle_text: 'At the beginning of your draw step, draw an additional card.',
        },
      },
      {
        id: 'saga_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: { lore: 0 },
        card: {
          name: 'Test Saga',
          type_line: 'Enchantment — Saga',
          oracle_text: sagaOracle,
        },
      },
      {
        id: 'ouro_perm',
        controller: p2,
        owner: p2,
        basePower: 3,
        baseToughness: 3,
        tapped: false,
        card: {
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          oracle_text:
            "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
          power: '3',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, gameId, emitted);
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, gameId, emitted);
    registerGameActions(io, socketP2 as any);
    registerGameActions(io, socketP1 as any);

    await handlersP2['skipToPhase']({
      gameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect((game.state as any).pendingPhaseSkip?.untapStepActionPerformed).toBe(true);
    expect(
      ((game.state as any).battlefield || []).find((p: any) => p.id === 'tapped_land')?.tapped,
    ).toBe(false);
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('UPKEEP');

    await passPriorityRound(handlersP2, handlersP1, gameId);
    expect(String((game.state as any).step || '')).toBe('MAIN1');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('MAIN1');
    expect((game.state as any).pendingPhaseSkip?.drawStepActionPerformed).toBe(true);

    await passPriorityRound(handlersP2, handlersP1, gameId);
    expect(String((game.state as any).step || '')).toBe('BEGIN_COMBAT');
    expect((game.state as any).pendingPhaseSkip?.lastStopStep).toBe('BEGIN_COMBAT');

    await passPriorityRound(handlersP2, handlersP1, gameId);
    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});
