import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

async function setupBaseGame(testGameId: string, playerId = 'p1', opponentId = 'p2') {
  await resetGame(testGameId);
  createGameIfNotExists(testGameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(testGameId);
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
  return game;
}

describe('castSpellFromHand prompt persistence (integration)', () => {
  const gameId = 'test_cast_spell_from_hand_prompt_persistence';
  const playerId = 'p1';
  const opponentId = 'p2';
  const derivedGameIds = [
    `${gameId}_force`,
    `${gameId}_abundant`,
    `${gameId}_target_single`,
    `${gameId}_target_graveyard_dynamic`,
    `${gameId}_modal`,
    `${gameId}_target_multi`,
    `${gameId}_target_mixed`,
    `${gameId}_target_exchange`,
    `${gameId}_target_exchange_explicit`,
    `${gameId}_overload`,
    `${gameId}_spree`,
  ];

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    for (const derivedGameId of derivedGameIds) {
      await resetGame(derivedGameId);
    }
  });

  it('persists direct Force of Will alternate-cost prompts', async () => {
    const testGameId = `${gameId}_force`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'spell_1', name: 'Force of Will', type_line: 'Instant', oracle_text: '', colors: ['U'], image_uris: { small: 'https://example.com/force.jpg' } },
          { id: 'blue_1', name: 'Ponder', type_line: 'Sorcery', oracle_text: '', colors: ['U'], image_uris: { small: 'https://example.com/ponder.jpg' } },
          { id: 'red_1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', colors: ['R'], image_uris: { small: 'https://example.com/bolt.jpg' } },
        ],
        handCount: 3,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'spell_1', alternateCostId: 'force_of_will' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'option_choice') as any;
    expect(step?.forceOfWillExileChoice).toBe(true);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('spell_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('option_choice');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.forceOfWillExileChoice).toBe(true);
  });

  it('persists direct Abundant Harvest choice prompts', async () => {
    const testGameId = `${gameId}_abundant`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'abundant_harvest_1',
            name: 'Abundant Harvest',
            mana_cost: '{G}',
            manaCost: '{G}',
            type_line: 'Sorcery',
            oracle_text: 'Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind.',
            image_uris: { small: 'https://example.com/abundant-harvest.jpg' },
            colors: ['G'],
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'abundant_harvest_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'mode_selection') as any;
    expect(step?.modeSelectionPurpose).toBe('abundantChoice');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('abundant_harvest_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mode_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.modeSelectionPurpose).toBe('abundantChoice');
  });

  it('persists direct single-target prompts with pending cast state', async () => {
    const testGameId = `${gameId}_target_single`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).stack = [
      {
        id: 'stack_spell_1',
        type: 'spell',
        controller: opponentId,
        card: {
          name: 'Lightning Bolt',
          type_line: 'Instant',
          image_uris: { small: 'https://example.com/lightning-bolt.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'counterspell_1',
            name: 'Counterspell',
            mana_cost: '{U}{U}',
            manaCost: '{U}{U}',
            type_line: 'Instant',
            oracle_text: 'Counter target spell.',
            image_uris: { small: 'https://example.com/counterspell.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'counterspell_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(step?.spellCastContext?.cardId).toBe('counterspell_1');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('counterspell_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('counterspell_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('target_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.validTargets?.[0]?.id).toBe('stack_spell_1');
  });

  it('persists spell graveyard target prompts with dynamic experience-counter limits', async () => {
    const testGameId = `${gameId}_target_graveyard_dynamic`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).experienceCounters = { [playerId]: 3 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'revive_experience_1',
            name: 'Experience Revival',
            mana_cost: '{2}{W}',
            manaCost: '{2}{W}',
            type_line: 'Sorcery',
            oracle_text: 'Return target creature card with mana value less than or equal to the number of experience counters you have from your graveyard to the battlefield.',
            image_uris: { small: 'https://example.com/experience-revival.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [
          { id: 'grave_creature_3', name: 'Seasoned Adept', type_line: 'Creature - Human', mana_cost: '{2}{W}', image_uris: { small: 'https://example.com/adept.jpg' } },
          { id: 'grave_creature_4', name: 'Late Titan', type_line: 'Creature - Giant', mana_cost: '{3}{W}', image_uris: { small: 'https://example.com/titan.jpg' } },
        ],
        graveyardCount: 2,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'revive_experience_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(step?.spellCastContext?.cardId).toBe('revive_experience_1');
    expect(step?.targetDescription).toBe('target creature card in your graveyard with mana value 3 or less');
    expect((step?.validTargets || []).map((target: any) => String(target?.id))).toEqual(['grave_creature_3']);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('target_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.targetDescription).toBe('target creature card in your graveyard with mana value 3 or less');
    expect((queuedCastEvent?.payload?.queuedResolutionStep?.validTargets || []).map((target: any) => String(target?.id))).toEqual(['grave_creature_3']);
  });

  it('persists direct modal spell selection prompts', async () => {
    const testGameId = `${gameId}_modal`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
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
            oracle_text: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
            image_uris: { small: 'https://example.com/prismari-command.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'prismari_command_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'mode_selection') as any;
    expect(step?.modeSelectionPurpose).toBe('modalSpell');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('prismari_command_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mode_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.modeSelectionPurpose).toBe('modalSpell');
  });

  it('queues mode selection before graveyard targeting for single-line modal spells', async () => {
    const testGameId = `${gameId}_modal_single_line`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'crypt_choice_1',
            name: 'Crypt Choice',
            mana_cost: '{1}{B}',
            manaCost: '{1}{B}',
            type_line: 'Sorcery',
            oracle_text: 'Choose one - Return target creature card with mana value 3 or less from your graveyard to your hand; or draw two cards.',
            image_uris: { small: 'https://example.com/crypt-choice.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [
          {
            id: 'grave_creature_3',
            name: 'Reassembling Skeleton',
            type_line: 'Creature — Skeleton Warrior',
            oracle_text: '{1}{B}: Return Reassembling Skeleton from your graveyard to the battlefield tapped.',
            mana_value: 2,
            cmc: 2,
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'crypt_choice_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const modeStep = queue.steps.find((entry: any) => entry.type === 'mode_selection') as any;
    expect(modeStep?.modeSelectionPurpose).toBe('modalSpell');
    expect(queue.steps.some((entry: any) => entry.type === 'target_selection')).toBe(false);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('crypt_choice_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mode_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.modeSelectionPurpose).toBe('modalSpell');
  });

  it('persists direct multi-target prompts as an ordered continuation list', async () => {
    const testGameId = `${gameId}_target_multi`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
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
            oracle_text: 'Choose two -\n• Prismari Command deals 2 damage to any target.\n• Target player draws two cards, then discards two cards.\n• Target player creates a Treasure token.\n• Destroy target artifact.',
            image_uris: { small: 'https://example.com/prismari-command.jpg' },
            selectedModes: ['mode_1', 'mode_4'],
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'prismari_command_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const targetSteps = queue.steps.filter((entry: any) => entry.type === 'target_selection') as any[];
    expect(targetSteps).toHaveLength(2);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('prismari_command_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('prismari_command_1');
    expect(queuedCastEvent?.payload?.queuedResolutionSteps).toHaveLength(2);
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[0]?.targetDescription || '').toLowerCase()).toContain('any target');
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[1]?.targetDescription || '').toLowerCase()).toContain('target artifact');
  });

  it('persists mixed player and permanent target prompts for Harmless Offering', async () => {
    const testGameId = `${gameId}_target_mixed`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'offering_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Loaned Relic', type_line: 'Artifact', oracle_text: '' },
      },
      {
        id: 'offering_target_2',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Opponent Relic', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'harmless_offering_1',
            name: 'Harmless Offering',
            mana_cost: '{2}{R}',
            manaCost: '{2}{R}',
            type_line: 'Sorcery',
            oracle_text: 'Target opponent gains control of target permanent you control.',
            image_uris: { small: 'https://example.com/harmless-offering.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'harmless_offering_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const targetSteps = queue.steps.filter((entry: any) => entry.type === 'target_selection') as any[];
    expect(targetSteps).toHaveLength(2);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('harmless_offering_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('harmless_offering_1');
    expect(queuedCastEvent?.payload?.queuedResolutionSteps).toHaveLength(2);
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[0]?.targetDescription || '').toLowerCase()).toContain('target opponent');
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[1]?.targetDescription || '').toLowerCase()).toContain('target permanent you control');

    const playerTargetStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target opponent')) as any;
    const permanentTargetStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target permanent you control')) as any;
    expect(playerTargetStep?.validTargets?.map((target: any) => String(target.id))).toEqual([opponentId]);
    expect(permanentTargetStep?.validTargets?.map((target: any) => String(target.id))).toEqual(['offering_target_1']);
  });

  it('persists paired permanent targeting for exchange-control spells', async () => {
    const testGameId = `${gameId}_target_exchange`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'exchange_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Loaned Relic', type_line: 'Artifact', oracle_text: '' },
      },
      {
        id: 'exchange_target_2',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Opponent Relic', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'market_chaos_1',
            name: 'Market Chaos',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Sorcery',
            oracle_text: 'Exchange control of two target permanents that share a card type.',
            image_uris: { small: 'https://example.com/market-chaos.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'market_chaos_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    expect(targetStep?.minTargets).toBe(2);
    expect(targetStep?.maxTargets).toBe(2);
    expect(String(targetStep?.targetDescription || '').toLowerCase()).toContain('two target permanents');
    expect(targetStep?.validTargets?.map((target: any) => String(target.id))).toEqual(['exchange_target_1', 'exchange_target_2']);
  });

  it('persists explicit target-and-target exchange prompts with scoped target lists', async () => {
    const testGameId = `${gameId}_target_exchange_explicit`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'exchange_explicit_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Loaned Bear', type_line: 'Creature — Bear', oracle_text: '' },
      },
      {
        id: 'exchange_explicit_target_2',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Opponent Bear', type_line: 'Creature — Bear', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'swap_contrivance_1',
            name: 'Swap Contrivance',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Sorcery',
            oracle_text: 'Exchange control of target creature you control and target creature an opponent controls.',
            image_uris: { small: 'https://example.com/swap-contrivance.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'swap_contrivance_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const targetSteps = queue.steps.filter((entry: any) => entry.type === 'target_selection') as any[];
    expect(targetSteps).toHaveLength(2);

    const firstStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature you control')) as any;
    const secondStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature an opponent controls')) as any;
    expect(firstStep).toBeDefined();
    expect(secondStep).toBeDefined();
    expect(firstStep?.validTargets?.map((target: any) => String(target.id))).toEqual(['exchange_explicit_target_1']);
    expect(secondStep?.validTargets?.map((target: any) => String(target.id))).toEqual(['exchange_explicit_target_2']);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('swap_contrivance_1');
    expect(queuedCastEvent?.payload?.queuedResolutionSteps).toHaveLength(2);
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[0]?.targetDescription || '').toLowerCase()).toContain('target creature you control');
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[1]?.targetDescription || '').toLowerCase()).toContain('target creature an opponent controls');
  });

  it('persists direct overload mode prompts', async () => {
    const testGameId = `${gameId}_overload`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'vandalblast_1',
            name: 'Vandalblast',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Sorcery',
            oracle_text: "Destroy target artifact you don't control. Overload {4}{R}",
            image_uris: { small: 'https://example.com/vandalblast.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'vandalblast_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'mode_selection') as any;
    expect(step?.modeSelectionPurpose).toBe('overload');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('vandalblast_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mode_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.modeSelectionPurpose).toBe('overload');
  });

  it('persists direct spree mode prompts', async () => {
    const testGameId = `${gameId}_spree`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'spree_spell_1',
            name: 'Spree Test Spell',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Sorcery',
            oracle_text: 'Spree\n+ {1} - Deal 1 damage to any target.\n+ {R} - Draw a card.',
            image_uris: { small: 'https://example.com/spree-test.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'spree_spell_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'mode_selection') as any;
    expect(step?.modeSelectionPurpose).toBe('spree');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('spree_spell_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mode_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.modeSelectionPurpose).toBe('spree');
  });
});