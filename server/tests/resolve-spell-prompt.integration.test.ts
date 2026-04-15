import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('resolveSpell prompt persistence (integration)', () => {
  const ponderGameId = 'test_resolve_spell_prompt_ponder';
  const scryGameId = 'test_resolve_spell_prompt_scry';
  const surveilGameId = 'test_resolve_spell_prompt_surveil';
  const blightGameId = 'test_resolve_spell_prompt_blight_each_opponent';
  const genesisWaveGameId = 'test_resolve_spell_prompt_genesis_wave';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of [ponderGameId, scryGameId, surveilGameId, blightGameId, genesisWaveGameId]) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of [ponderGameId, scryGameId, surveilGameId, blightGameId, genesisWaveGameId]) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  });

  it('queues Ponder-style prompts directly during spell resolution without pending staging state', () => {
    createGameIfNotExists(ponderGameId, 'commander', 40);
    const game = ensureGame(ponderGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = ponderGameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game as any).libraries = new Map([
      ['p1', [
        { id: 'ponder_a', name: 'A', zone: 'library' },
        { id: 'ponder_b', name: 'B', zone: 'library' },
        { id: 'ponder_c', name: 'C', zone: 'library' },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'spell_ponder_stack_1',
        cardId: 'spell_ponder_card_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'spell_ponder_card_1',
          name: 'Index Test',
          type_line: 'Sorcery',
          oracle_text: 'Look at the top three cards of your library, then put them back in any order. You may shuffle your library.',
        },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(ponderGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PONDER_EFFECT);
    expect((queue.steps[0] as any)?.sourceName).toBe('Index Test');
    expect((queue.steps[0] as any)?.cards?.map((card: any) => card.id)).toEqual(['ponder_a', 'ponder_b', 'ponder_c']);
    expect((game.state as any).pendingPonder).toBeUndefined();

    const promptEvent = getEvents(ponderGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      queuedResolutionStep: {
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: 'p1',
        sourceName: 'Index Test',
      },
    });
    expect(String(promptEvent.payload?.sourceId || '')).toBeTruthy();
  });

  it('persists scry prompts created during spell resolution', () => {
    createGameIfNotExists(scryGameId, 'commander', 40);
    const game = ensureGame(scryGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = scryGameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).stack = [
      {
        id: 'spell_scry_stack_1',
        cardId: 'spell_scry_card_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'spell_scry_card_1',
          name: 'Serum Visions Test',
          type_line: 'Sorcery',
          oracle_text: 'Scry 2.',
        },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(scryGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.SCRY);
    expect((queue.steps[0] as any)?.sourceId).toBe('spell_scry_stack_1');
    expect(Number((queue.steps[0] as any)?.scryCount || 0)).toBe(2);

    const promptEvent = getEvents(scryGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'spell_scry_stack_1',
      queuedResolutionStep: {
        type: ResolutionStepType.SCRY,
        playerId: 'p1',
        sourceId: 'spell_scry_stack_1',
        scryCount: 2,
      },
    });
  });

  it('persists surveil prompts created during spell resolution', () => {
    createGameIfNotExists(surveilGameId, 'commander', 40);
    const game = ensureGame(surveilGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = surveilGameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).stack = [
      {
        id: 'spell_surveil_stack_1',
        cardId: 'spell_surveil_card_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'spell_surveil_card_1',
          name: 'Consider Test',
          type_line: 'Instant',
          oracle_text: 'Surveil 2.',
        },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(surveilGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.SURVEIL);
    expect((queue.steps[0] as any)?.sourceId).toBe('spell_surveil_stack_1');
    expect(Number((queue.steps[0] as any)?.surveilCount || 0)).toBe(2);

    const promptEvent = getEvents(surveilGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'spell_surveil_stack_1',
      queuedResolutionStep: {
        type: ResolutionStepType.SURVEIL,
        playerId: 'p1',
        sourceId: 'spell_surveil_stack_1',
        surveilCount: 2,
      },
    });
  });

  it('persists APNAP blight prompts created during spell resolution', () => {
    createGameIfNotExists(blightGameId, 'commander', 40);
    const game = ensureGame(blightGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = blightGameId;
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).activePlayerId = 'p1';
    (game.state as any).battlefield = [
      {
        id: 'creature_p2',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'creature_p2_card', name: 'P2 Creature', type_line: 'Creature — Test' },
      },
      {
        id: 'creature_p3',
        controller: 'p3',
        owner: 'p3',
        card: { id: 'creature_p3_card', name: 'P3 Creature', type_line: 'Creature — Test' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'spell_blight_stack_1',
        cardId: 'spell_blight_card_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'spell_blight_card_1',
          name: 'High Perfect Morcant Test',
          type_line: 'Sorcery',
          oracle_text: 'Each opponent blights 1.',
        },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(blightGameId);
    expect(queue.steps).toHaveLength(2);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[1] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.keywordBlight).toBe(true);
    expect((queue.steps[1] as any)?.keywordBlight).toBe(true);
    expect(String((queue.steps[0] as any)?.sourceId || '')).toBe('spell_blight_stack_1');
    expect(String((queue.steps[1] as any)?.sourceId || '')).toBe('spell_blight_stack_1');
    expect(new Set(queue.steps.map((step: any) => String(step?.playerId || '')))).toEqual(new Set(['p2', 'p3']));

    const promptEvent = getEvents(blightGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload.playerId).toBe('p2');
    expect(promptEvent.payload.sourceId).toBe('spell_blight_stack_1');
    expect(promptEvent.payload.queuedResolutionSteps).toHaveLength(2);
    expect(new Set((promptEvent.payload.queuedResolutionSteps as any[]).map((step: any) => String(step?.playerId || '')))).toEqual(new Set(['p2', 'p3']));
    expect((promptEvent.payload.queuedResolutionSteps as any[]).every((step: any) => step?.keywordBlight === true)).toBe(true);
    expect((promptEvent.payload.queuedResolutionSteps as any[]).every((step: any) => String(step?.sourceId || '') === 'spell_blight_stack_1')).toBe(true);
  });

  it('persists Genesis Wave library-search prompts created during spell resolution', () => {
    createGameIfNotExists(genesisWaveGameId, 'commander', 40);
    const game = ensureGame(genesisWaveGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = genesisWaveGameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      ['p1']: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 3,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      ['p1', [
        {
          id: 'wave_creature_1',
          name: 'Wave Creature',
          type_line: 'Creature — Test',
          oracle_text: '',
          cmc: 3,
          image_uris: { small: 'https://example.com/wave-creature-small.jpg', normal: 'https://example.com/wave-creature.jpg' },
        },
        {
          id: 'wave_instant_1',
          name: 'Wave Instant',
          type_line: 'Instant',
          oracle_text: '',
          cmc: 2,
          image_uris: { small: 'https://example.com/wave-instant-small.jpg', normal: 'https://example.com/wave-instant.jpg' },
        },
        {
          id: 'wave_artifact_1',
          name: 'Wave Artifact',
          type_line: 'Artifact',
          oracle_text: '',
          cmc: 2,
          image_uris: { small: 'https://example.com/wave-artifact-small.jpg', normal: 'https://example.com/wave-artifact.jpg' },
        },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'spell_genesis_wave_stack_1',
        cardId: 'spell_genesis_wave_card_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        xValue: 3,
        card: {
          id: 'spell_genesis_wave_card_1',
          name: 'Genesis Wave',
          type_line: 'Sorcery',
          oracle_text: 'Reveal the top X cards of your library. You may put any number of permanent cards with mana value X or less from among them onto the battlefield. Then put all cards revealed this way that were not put onto the battlefield into your graveyard.',
          image_uris: { small: 'https://example.com/genesis-wave-small.jpg', normal: 'https://example.com/genesis-wave.jpg' },
        },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(genesisWaveGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
    expect(String((queue.steps[0] as any)?.sourceId || '')).toBe('spell_genesis_wave_stack_1');
    expect(Array.isArray((queue.steps[0] as any)?.availableCards)).toBe(true);
    expect(((queue.steps[0] as any)?.availableCards || [])).toHaveLength(2);
    expect(((queue.steps[0] as any)?.nonSelectableCards || [])).toHaveLength(1);

    const promptEvent = getEvents(genesisWaveGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'spell_genesis_wave_stack_1',
      queuedResolutionStep: {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: 'p1',
        sourceId: 'spell_genesis_wave_stack_1',
        sourceName: 'Genesis Wave',
      },
    });
    expect((promptEvent.payload.queuedResolutionStep?.availableCards || [])).toHaveLength(2);
    expect((promptEvent.payload.queuedResolutionStep?.nonSelectableCards || [])).toHaveLength(1);
  });
});