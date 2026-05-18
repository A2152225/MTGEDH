import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCommanderHandlers } from '../src/socket/commander.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { buildDurableCommandZonePermission } from '../src/state/modules/durable-permissions.js';
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

  it('casts a commander with durable command-zone free-cost metadata while preserving commander tax', async () => {
    const gameId = createTestGameId('durable_command_free_tax');
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
      stack: [{ id: 'spell_on_stack', controller: p2, card: { name: 'Test Spell' } }],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_free_taxed'],
          commanderNames: ['Free Taxed Commander'],
          commanderCards: [
            {
              id: 'cmd_free_taxed',
              name: 'Free Taxed Commander',
              type_line: 'Legendary Creature — Wizard',
              mana_cost: '{3}{U}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_free_taxed'],
          taxById: { cmd_free_taxed: 2 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
      durablePermissions: [
        buildDurableCommandZonePermission({
          playerId: p1 as any,
          action: 'cast',
          duration: 'this_turn',
          turnApplied: 1,
          expiresAtTurn: 1,
          sourceName: 'Command Beacon Emblem',
          cardIds: ['cmd_free_taxed'],
          costMode: 'without_paying_mana_cost',
          grantsFlash: true,
        }),
      ],
      turnNumber: 1,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_free_taxed' });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep).toEqual(expect.objectContaining({
      type: 'mana_payment_choice',
      cardName: 'Free Taxed Commander',
      manaCost: '{2}',
    }));
    expect(paymentStep?.costAdjustment?.taxMessages).toContain('Commander tax: +{2}');
  });

  it('completes a commander cast using durable command-zone flexible mana metadata', async () => {
    const gameId = createTestGameId('durable_command_flexible_mana');
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
      battlefield: [],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_white'],
          commanderNames: ['White Commander'],
          commanderCards: [
            {
              id: 'cmd_white',
              name: 'White Commander',
              type_line: 'Legendary Creature — Soldier',
              mana_cost: '{W}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_white'],
          taxById: { cmd_white: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
      durablePermissions: [
        buildDurableCommandZonePermission({
          playerId: p1 as any,
          action: 'cast',
          duration: 'while_source_remains',
          turnApplied: 1,
          sourceName: 'Command Mana Lens',
          cardIds: ['cmd_white'],
          spendManaAsThoughAnyType: true,
        }),
      ],
      turnNumber: 1,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_white' });

    const pendingCasts = Object.entries((game.state as any).pendingSpellCasts || {});
    expect(pendingCasts).toHaveLength(1);
    const [effectId] = pendingCasts[0] as [string, any];
    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep).toEqual(expect.objectContaining({
      type: 'mana_payment_choice',
      cardName: 'White Commander',
      manaCost: '{W}',
    }));

    await handlers['completeCastSpell']({
      gameId,
      cardId: 'cmd_white',
      effectId,
      payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 1 }],
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect((game.state.stack || []).some((item: any) => String(item?.card?.id || '') === 'cmd_white')).toBe(true);
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
    expect(pendingCast?.paymentCostAdjustment).toBeUndefined();
    expect(pendingCast?.costMetadata?.paymentCostAdjustment).toMatchObject({
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
    expect(pendingCast?.paymentCostAdjustment).toBeUndefined();
    expect(pendingCast?.costMetadata?.paymentCostAdjustment).toMatchObject({
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

  it('allows durable command-zone ignore-timing metadata outside sorcery timing', async () => {
    const gameId = createTestGameId('durable_ignore_timing');
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
        [p1]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_ignore_timing'],
          commanderNames: ['Timingless Commander'],
          commanderCards: [
            {
              id: 'cmd_ignore_timing',
              name: 'Timingless Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_ignore_timing'],
          taxById: { cmd_ignore_timing: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
      durablePermissions: [
        buildDurableCommandZonePermission({
          playerId: p1 as any,
          action: 'cast',
          duration: 'this_turn',
          turnApplied: 1,
          expiresAtTurn: 1,
          sourceName: 'Command Timing Window',
          cardIds: ['cmd_ignore_timing'],
          timingOverride: { ignoreTiming: true },
        }),
      ],
      turnNumber: 1,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_ignore_timing' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('SORCERY_TIMING');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep).toEqual(expect.objectContaining({
      type: 'mana_payment_choice',
      cardName: 'Timingless Commander',
      manaCost: '{1}{R}',
    }));
  });
});