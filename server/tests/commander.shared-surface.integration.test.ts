import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCommanderHandlers } from '../src/socket/commander.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: any,
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_1',
    data,
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

const trackedGameIds: string[] = [];

async function cleanupTrackedGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createTestGameId(label: string): string {
  const gameId = `test_commander_shared_surface_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

function createEmptyManaPool() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

describe('commander shared-surface integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds.splice(0)) {
      await cleanupTrackedGame(gameId);
    }
  });

  it('casts a reduced-cost commander through the shared command-zone surface', async () => {
    const gameId = createTestGameId('reduced_cost');
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: p1,
      priority: p1,
      players: [
        { id: p1, name: 'Player 1', spectator: false, life: 40 },
        { id: p2, name: 'Player 2', spectator: false, life: 40 },
      ],
      battlefield: [
        {
          id: 'mountain_1',
          controller: p1,
          tapped: false,
          card: {
            id: 'mountain_card_1',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'ruby_medallion_1',
          controller: p1,
          tapped: false,
          card: {
            id: 'ruby_medallion_card',
            name: 'Ruby Medallion',
            type_line: 'Artifact',
            oracle_text: 'Red spells you cast cost {1} less to cast.',
          },
        },
      ],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: createEmptyManaPool(),
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_red'],
          commanderNames: ['Red Commander'],
          commanderCards: [
            {
              id: 'cmd_red',
              name: 'Red Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red'],
          taxById: { cmd_red: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_red' });

    const pendingCasts = Object.entries((game.state as any).pendingSpellCasts || {});
    expect(pendingCasts).toHaveLength(1);

    const [effectId, pendingCast] = pendingCasts[0] as [string, any];
    expect(pendingCast?.fromZone).toBe('command');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep?.type).toBe('mana_payment_choice');
    expect(paymentStep?.manaCost).toBe('{R}');
    expect(paymentStep?.costAdjustment).toMatchObject({
      originalManaCost: '{1}{R}',
      adjustedManaCost: '{R}',
      kind: 'reduction',
    });
    expect(paymentStep?.costAdjustment?.reductionMessages).toContain('Ruby Medallion: -{1}');

    await handlers['completeCastSpell']({
      gameId,
      cardId: 'cmd_red',
      effectId,
      payment: [{ permanentId: 'mountain_1', mana: 'R', count: 1 }],
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect((game.state.stack || []).some((item: any) => String(item?.card?.id || '') === 'cmd_red')).toBe(true);
    expect(((game.state.commandZone as any)?.[p1]?.inCommandZone || [])).not.toContain('cmd_red');
    expect((game.state.commandZone as any)?.[p1]?.taxById?.cmd_red).toBe(2);
  });

  it('casts a command-zone commander through non-battlefield cost adjustments on the shared surface', async () => {
    const gameId = createTestGameId('nonbattlefield_adjustments');
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: p1,
      priority: p1,
      players: [
        { id: p1, name: 'Player 1', spectator: false, life: 40 },
        { id: p2, name: 'Player 2', spectator: false, life: 40 },
      ],
      battlefield: [
        {
          id: 'mountain_1',
          controller: p1,
          tapped: false,
          card: {
            id: 'mountain_card_1',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'mountain_2',
          controller: p1,
          tapped: false,
          card: {
            id: 'mountain_card_2',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
      ],
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: createEmptyManaPool(),
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_plane_scheme'],
          commanderNames: ['Plane Scheme Commander'],
          commanderCards: [
            {
              id: 'cmd_plane_scheme',
              name: 'Plane Scheme Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_plane_scheme'],
          taxById: { cmd_plane_scheme: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_plane_scheme' });

    const pendingCasts = Object.entries((game.state as any).pendingSpellCasts || {});
    expect(pendingCasts).toHaveLength(1);

    const [effectId, pendingCast] = pendingCasts[0] as [string, any];
    expect(pendingCast?.fromZone).toBe('command');
    expect(pendingCast?.manaCost).toBe('{2}');
    expect(pendingCast?.paymentCostAdjustment).toMatchObject({
      originalManaCost: '{1}{R}',
      adjustedManaCost: '{2}',
      genericTax: 1,
      kind: 'mixed',
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep?.type).toBe('mana_payment_choice');
    expect(paymentStep?.costAdjustment).toMatchObject({
      originalManaCost: '{1}{R}',
      adjustedManaCost: '{2}',
      genericTax: 1,
      kind: 'mixed',
    });
    expect(paymentStep?.costAdjustment?.reductionMessages).toContain('Feeding Grounds: -{R}');
    expect(paymentStep?.costAdjustment?.taxMessages).toContain('The Very Soil Shall Shake: +{1}');

    await handlers['completeCastSpell']({
      gameId,
      cardId: 'cmd_plane_scheme',
      effectId,
      payment: [
        { permanentId: 'mountain_1', mana: 'R', count: 1 },
        { permanentId: 'mountain_2', mana: 'R', count: 1 },
      ],
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect((game.state.stack || []).some((item: any) => String(item?.card?.id || '') === 'cmd_plane_scheme')).toBe(true);
    expect(((game.state.commandZone as any)?.[p1]?.inCommandZone || [])).not.toContain('cmd_plane_scheme');
  });

  it('preserves command-zone payment metadata through target-selection continuation', async () => {
    const gameId = createTestGameId('targeted_metadata');
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: p1,
      priority: p1,
      players: [
        { id: p1, name: 'Player 1', spectator: false, life: 40 },
        { id: p2, name: 'Player 2', spectator: false, life: 40 },
      ],
      battlefield: [
        {
          id: 'target_creature',
          controller: p2,
          owner: p2,
          tapped: false,
          card: {
            id: 'target_creature_card',
            name: 'Silvercoat Lion',
            type_line: 'Creature — Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      activeSchemes: [
        {
          id: 'scheme_tax',
          name: 'The Very Soil Shall Shake',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.",
        },
      ],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: createEmptyManaPool(),
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_targeted'],
          commanderNames: ['Targeted Commander Spell'],
          commanderCards: [
            {
              id: 'cmd_targeted',
              name: 'Targeted Commander Spell',
              type_line: 'Legendary Instant',
              mana_cost: '{1}{R}',
              oracle_text: 'Targeted Commander Spell deals 3 damage to any target.',
            },
          ],
          inCommandZone: ['cmd_targeted'],
          taxById: { cmd_targeted: 2 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_targeted' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(targetStep?.type).toBe('target_selection');

    const pendingCasts = Object.entries((game.state as any).pendingSpellCasts || {});
    expect(pendingCasts).toHaveLength(1);
    const [, pendingCast] = pendingCasts[0] as [string, any];
    expect(pendingCast?.paymentCostAdjustment).toMatchObject({
      originalManaCost: '{1}{R}',
      adjustedManaCost: '{4}',
      genericTax: 3,
      kind: 'mixed',
    });

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['target_creature'],
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep?.type).toBe('mana_payment_choice');
    expect(paymentStep?.manaCost).toBe('{4}');
    expect(paymentStep?.costAdjustment).toMatchObject({
      originalManaCost: '{1}{R}',
      adjustedManaCost: '{4}',
      genericTax: 3,
      kind: 'mixed',
    });
    expect(paymentStep?.costAdjustment?.reductionMessages).toContain('Feeding Grounds: -{R}');
    expect(paymentStep?.costAdjustment?.taxMessages).toContain('The Very Soil Shall Shake: +{1}');
    expect(paymentStep?.costAdjustment?.taxMessages).toContain('Commander tax: +{2}');
  });

  it('rejects non-flash commanders outside sorcery timing via the shared command-zone surface', async () => {
    const gameId = createTestGameId('timing');
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      turnPlayer: p2,
      priority: p1,
      players: [
        { id: p1, name: 'Player 1', spectator: false, life: 40 },
        { id: p2, name: 'Player 2', spectator: false, life: 40 },
      ],
      battlefield: [],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: createEmptyManaPool(),
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_sorcery'],
          commanderNames: ['Sorcery Commander'],
          commanderCards: [
            {
              id: 'cmd_sorcery',
              name: 'Sorcery Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_sorcery'],
          taxById: { cmd_sorcery: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_sorcery' });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('SORCERY_TIMING');
  });
});