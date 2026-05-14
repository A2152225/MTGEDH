import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
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

async function seedGame(gameId: string, cardId: string, oracleText: string, options?: { manaCost?: string; manaPool?: any; life?: number; hand?: any[]; extraGraveyard?: any[] }) {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: options?.life ?? 40 }];
  (game.state as any).life = { [playerId]: options?.life ?? 40 };
  (game.state as any).zones = {
    [playerId]: {
      hand: options?.hand || [],
      handCount: Array.isArray(options?.hand) ? options?.hand.length : 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        {
          id: cardId,
          name: 'Grave Spell',
          type_line: 'Sorcery',
          mana_cost: options?.manaCost,
          oracle_text: oracleText,
          zone: 'graveyard',
        },
        ...((options?.extraGraveyard || []).map((card: any) => ({ ...card, zone: 'graveyard' }))),
      ],
      graveyardCount: 1 + ((options?.extraGraveyard || []).length),
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: options?.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };

  return { game, playerId };
}

describe('cast-from-graveyard replay semantics (integration)', () => {
  const gameId = 'test_cast_from_graveyard_replay';
  const fixedGameIds = [
    gameId,
    `${gameId}_retrace_live`,
    `${gameId}_escape_live`,
    `${gameId}_uro_live`,
    `${gameId}_woe_strider_live`,
    `${gameId}_jump_start_madness`,
    `${gameId}_jump_start_madness_replay`,
    `${gameId}_jump_start_targeted_madness`,
    `${gameId}_jump_start_targeted_madness_replay`,
    `${gameId}_flashback`,
    `${gameId}_retrace`,
    `${gameId}_escape`,
    `${gameId}_flashback_stack_id`,
    `${gameId}_flashback_targets`,
    `${gameId}_jump_start_replay`,
    `${gameId}_retrace_prompt_replay`,
    `${gameId}_escape_prompt_replay`,
    `${gameId}_escape_replay`,
    `${gameId}_uro_replay`,
    `${gameId}_woe_strider_replay`,
    `${gameId}_granted_flashback_live`,
    `${gameId}_granted_retrace_live`,
    `${gameId}_dread_return_live`,
    `${gameId}_dread_return_prompt_replay`,
    `${gameId}_sevinne_live`,
    `${gameId}_sevinne_replay`,
    `${gameId}_past_in_flames_live`,
    `${gameId}_past_in_flames_replay`,
    `${gameId}_momentary_blink_live`,
    `${gameId}_momentary_blink_replay`,
    `${gameId}_cackling_live`,
    `${gameId}_cackling_replay`,
    `${gameId}_think_twice_live`,
    `${gameId}_think_twice_replay`,
    `${gameId}_strike_it_rich_live`,
    `${gameId}_strike_it_rich_replay`,
    `${gameId}_deep_analysis_live`,
    `${gameId}_deep_analysis_replay`,
    `${gameId}_army_live`,
    `${gameId}_army_replay`,
    `${gameId}_otherworldly_gaze_live`,
    `${gameId}_otherworldly_gaze_replay`,
    `${gameId}_faithless_looting_live`,
    `${gameId}_faithless_looting_replay`,
    `${gameId}_laughing_mad_live`,
    `${gameId}_laughing_mad_replay`,
    `${gameId}_seize_the_day_live`,
    `${gameId}_seize_the_day_replay`,
    `${gameId}_electroduplicate_live`,
    `${gameId}_electroduplicate_replay`,
    `${gameId}_echo_of_eons_live`,
    `${gameId}_echo_of_eons_replay`,
    `${gameId}_galvanic_iteration_live`,
    `${gameId}_galvanic_iteration_replay`,
  ];

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const fixedGameId of fixedGameIds) {
      await resetGame(fixedGameId);
    }
  });

  afterEach(async () => {
    for (const fixedGameId of fixedGameIds) {
      await resetGame(fixedGameId);
    }
  });

  it('live jump-start activation spends mana and moves the card from graveyard to stack', async () => {
    const { game, playerId } = await seedGame(gameId, 'jump_start_1', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [
        {
          id: 'jump_start_discard_1',
          name: 'Spare Idea',
          type_line: 'Instant',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'jump_start_1',
      abilityId: 'jump-start',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const discardStep = steps.find(step => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['jump_start_discard_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['jump_start_discard_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['jump_start_discard_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('jump_start_1');
    expect(stack[0]?.card?.castWithAbility).toBe('jump-start');
    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((game.state as any).cardLeftGraveyardThisTurn?.[playerId]).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const activateEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.discardedCardIds).toEqual(['jump_start_discard_1']);
  });

  it('live granted flashback activation uses the granted mana-cost flashback cost', async () => {
    const grantedGameId = `${gameId}_granted_flashback_live`;
    const { game, playerId } = await seedGame(grantedGameId, 'granted_flashback_spell_1', 'Surveil 1, then draw a card.', {
      manaCost: '{U}',
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
    });
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).step = 'MAIN1';
    (game.state as any).battlefield = [
      {
        id: 'return_the_past_1',
        controller: playerId,
        card: {
          name: 'Return the Past',
          type_line: 'Enchantment',
          oracle_text: 'During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, grantedGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: grantedGameId,
      cardId: 'granted_flashback_spell_1',
      abilityId: 'flashback',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual([]);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('granted_flashback_spell_1');
    expect(stack[0]?.card?.castWithAbility).toBe('flashback');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const activateEvent = [...getEvents(grantedGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.manaCost).toBe('{U}');
  });

  it('live granted retrace activation queues the land discard cost and casts after payment', async () => {
    const retraceGameId = `${gameId}_granted_retrace_live`;
    const { game, playerId } = await seedGame(retraceGameId, 'granted_retrace_spell_1', 'Create a 1/1 blue Merfolk creature token.', {
      manaCost: '{1}{G}',
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      hand: [
        {
          id: 'retrace_land_1',
          name: 'Forest',
          type_line: 'Basic Land - Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'hand',
        },
      ],
    });
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).step = 'MAIN1';
    (game.state as any).battlefield = [
      {
        id: 'deeproot_historian_1',
        controller: playerId,
        card: {
          name: 'Deeproot Historian',
          type_line: 'Creature - Merfolk Druid',
          oracle_text: 'Merfolk and Druid cards in your graveyard have retrace.',
        },
      },
    ];
    const graveyardSpell = (game.state as any).zones[playerId].graveyard[0];
    graveyardSpell.type_line = 'Kindred Sorcery - Merfolk';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, retraceGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: retraceGameId,
      cardId: 'granted_retrace_spell_1',
      abilityId: 'retrace',
    });

    const discardStep = ResolutionQueueManager.getStepsForPlayer(retraceGameId, playerId)
      .find(step => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);

    await handlers['submitResolutionResponse']({
      gameId: retraceGameId,
      stepId: String(discardStep.id),
      selections: ['retrace_land_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('granted_retrace_spell_1');
    expect(stack[0]?.card?.castWithAbility).toBe('retrace');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const activateEvent = [...getEvents(retraceGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.manaCost).toBe('{1}{G}');
    expect(activateEvent?.payload?.discardedCardIds).toEqual(['retrace_land_1']);
  });

  it('jump-start with a madness discard exiles the discarded card, persists split cost evidence, and replays the queued cast prompt', async () => {
    const madnessGameId = `${gameId}_jump_start_madness`;
    const replayGameId = `${gameId}_jump_start_madness_replay`;
    const madnessCard = {
      id: 'jump_start_madness_discard_1',
      name: 'Fiery Temper',
      type_line: 'Instant',
      mana_cost: '{1}{R}{R}',
      oracle_text: 'Madness {R}',
      zone: 'hand',
    };

    const { game, playerId } = await seedGame(madnessGameId, 'jump_start_madness_spell', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [madnessCard],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, madnessGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: madnessGameId,
      cardId: 'jump_start_madness_spell',
      abilityId: 'jump-start',
    });

    const discardStep = ResolutionQueueManager.getStepsForPlayer(madnessGameId, playerId).find((step) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: madnessGameId,
      stepId: String(discardStep.id),
      selections: ['jump_start_madness_discard_1'],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).toContain('jump_start_madness_discard_1');
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).not.toContain('jump_start_madness_discard_1');
    expect(((game.state as any).stack || []).some((item: any) => String(item?.card?.id || '') === 'jump_start_madness_spell')).toBe(true);

    const liveQueue = ResolutionQueueManager.getQueue(madnessGameId);
    expect((liveQueue.steps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'jump_start_madness_discard_1')).toBe(true);

    const activateEvent = [...getEvents(madnessGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility' && String((event as any)?.payload?.cardId || '') === 'jump_start_madness_spell') as any;
    const promptEvent = [...getEvents(madnessGameId)].reverse().find((event) => event.type === 'resolveTopOfStackPrompt' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;

    expect(activateEvent?.payload?.discardedCardIds || []).not.toContain('jump_start_madness_discard_1');
    expect(activateEvent?.payload?.exiledCardIdsFromHandForCost || []).toContain('jump_start_madness_discard_1');
    expect((promptEvent?.payload?.queuedResolutionSteps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'jump_start_madness_discard_1')).toBe(true);

    const replay = await seedGame(replayGameId, 'jump_start_madness_spell', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [madnessCard],
    });

    replay.game.applyEvent({ type: 'activateGraveyardAbility', ...(activateEvent?.payload || {}) } as any);
    replay.game.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent?.payload || {}) } as any);

    const replayedZones = (replay.game.state as any).zones?.[playerId];
    expect((replayedZones?.exile || []).map((card: any) => card.id)).toContain('jump_start_madness_discard_1');
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).not.toContain('jump_start_madness_discard_1');
    expect(((replay.game.state as any).stack || []).some((item: any) => String(item?.card?.id || '') === 'jump_start_madness_spell')).toBe(true);
    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect((replayQueue.steps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'jump_start_madness_discard_1')).toBe(true);
  });

  it('jump-start with targets replays the queued target selection alongside the madness cast prompt', async () => {
    const targetedGameId = `${gameId}_jump_start_targeted_madness`;
    const replayGameId = `${gameId}_jump_start_targeted_madness_replay`;
    const madnessCard = {
      id: 'jump_start_targeted_madness_discard_1',
      name: 'Fiery Temper',
      type_line: 'Instant',
      mana_cost: '{1}{R}{R}',
      oracle_text: 'Madness {R}',
      zone: 'hand',
    };

    const { game, playerId } = await seedGame(targetedGameId, 'jump_start_targeted_spell', 'Destroy target creature.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [madnessCard],
    });
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).battlefield = [
      {
        id: 'jump_start_target_creature_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          name: 'Target Dummy',
          type_line: 'Creature - Construct',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, targetedGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: targetedGameId,
      cardId: 'jump_start_targeted_spell',
      abilityId: 'jump-start',
    });

    const discardStep = ResolutionQueueManager.getStepsForPlayer(targetedGameId, playerId).find((step) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: targetedGameId,
      stepId: String(discardStep.id),
      selections: ['jump_start_targeted_madness_discard_1'],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).toContain('jump_start_targeted_madness_discard_1');
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).not.toContain('jump_start_targeted_madness_discard_1');

    const liveSteps = ResolutionQueueManager.getStepsForPlayer(targetedGameId, playerId);
    const targetStep = liveSteps.find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    const madnessPrompt = liveSteps.find((step: any) => String((step as any)?.castFromExileCardId || '') === 'jump_start_targeted_madness_discard_1') as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).some((target: any) => String(target.id || '') === 'jump_start_target_creature_1')).toBe(true);
    expect(madnessPrompt).toBeDefined();

    const activateEvent = [...getEvents(targetedGameId)].reverse().find((event) =>
      event.type === 'activateGraveyardAbility' &&
      String((event as any)?.payload?.cardId || '') === 'jump_start_targeted_spell' &&
      (event as any)?.payload?.queuedResolutionStep
    ) as any;
    const promptEvent = [...getEvents(targetedGameId)].reverse().find((event) => event.type === 'resolveTopOfStackPrompt' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;

    expect(activateEvent?.payload?.queuedResolutionStep?.graveyardSpellCastTargetSelection).toBe(true);
    expect(activateEvent?.payload?.queuedResolutionStep?.discardedCardIdsForCost || []).not.toContain('jump_start_targeted_madness_discard_1');
    expect(activateEvent?.payload?.queuedResolutionStep?.exiledCardIdsFromHandForCost || []).toContain('jump_start_targeted_madness_discard_1');
    expect((promptEvent?.payload?.queuedResolutionSteps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'jump_start_targeted_madness_discard_1')).toBe(true);

    const replay = await seedGame(replayGameId, 'jump_start_targeted_spell', 'Destroy target creature.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [madnessCard],
    });
    (replay.game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (replay.game.state as any).life = { [playerId]: 40, p2: 40 };
    (replay.game.state as any).battlefield = [
      {
        id: 'jump_start_target_creature_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          name: 'Target Dummy',
          type_line: 'Creature - Construct',
          oracle_text: '',
        },
      },
    ];

    replay.game.applyEvent({ type: 'activateGraveyardAbility', ...(activateEvent?.payload || {}) } as any);
    replay.game.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent?.payload || {}) } as any);

    const replayedZones = (replay.game.state as any).zones?.[playerId];
    expect((replayedZones?.exile || []).map((card: any) => card.id)).toContain('jump_start_targeted_madness_discard_1');
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).not.toContain('jump_start_targeted_madness_discard_1');
    const replaySteps = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId);
    expect(replaySteps.some((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true)).toBe(true);
    expect(replaySteps.some((step: any) => String((step as any)?.castFromExileCardId || '') === 'jump_start_targeted_madness_discard_1')).toBe(true);
  });

  it('live retrace activation requires discarding a land card from hand', async () => {
    const retraceGameId = `${gameId}_retrace_live`;
    const { game, playerId } = await seedGame(retraceGameId, 'retrace_1', 'Flame Jab deals 1 damage to any target.\nRetrace', {
      manaCost: '{R}',
      manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      hand: [
        {
          id: 'retrace_land_1',
          name: 'Mountain',
          type_line: 'Basic Land - Mountain',
          oracle_text: '',
          zone: 'hand',
        },
        {
          id: 'retrace_spell_1',
          name: 'Shock',
          type_line: 'Instant',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, retraceGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: retraceGameId,
      cardId: 'retrace_1',
      abilityId: 'retrace',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(retraceGameId, playerId);
    const discardStep = steps.find(step => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);

    const queuedRetraceEvent = [...getEvents(retraceGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(queuedRetraceEvent?.payload?.cardId).toBe('retrace_1');
    expect(queuedRetraceEvent?.payload?.queuedResolutionStep?.type).toBe('discard_selection');
    expect(queuedRetraceEvent?.payload?.queuedResolutionStep?.graveyardCastDiscardAsCost).toBe(true);
    expect((queuedRetraceEvent?.payload?.queuedResolutionStep?.hand || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);

    await handlers['submitResolutionResponse']({
      gameId: retraceGameId,
      stepId: String(discardStep.id),
      selections: ['retrace_land_1'],
    });

    const retraceTargetStep = ResolutionQueueManager
      .getStepsForPlayer(retraceGameId, playerId)
      .find((queuedStep) => (queuedStep as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(retraceTargetStep).toBeDefined();
    const retraceTargetId = (retraceTargetStep.validTargets || []).map((target: any) => target.id).find(Boolean);
    expect(retraceTargetId).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: retraceGameId,
      stepId: String(retraceTargetStep.id),
      selections: [retraceTargetId],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['retrace_land_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('retrace_1');
    expect(stack[0]?.card?.castWithAbility).toBe('retrace');
    expect(stack[0]?.targets).toEqual([retraceTargetId]);
  });

  it('live escape activation requires exiling other cards from your graveyard', async () => {
    const escapeGameId = `${gameId}_escape_live`;
    const { game, playerId } = await seedGame(escapeGameId, 'escape_1', 'Return target creature card from your graveyard to your hand.\nEscape {2}{G}, Exile three other cards from your graveyard.', {
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      extraGraveyard: [
        { id: 'escape_cost_1', name: 'Card One', type_line: 'Instant', oracle_text: '' },
        { id: 'escape_cost_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: '' },
        { id: 'escape_cost_3', name: 'Card Three', type_line: 'Creature - Human', oracle_text: '' },
        { id: 'escape_target_1', name: 'Target Creature', type_line: 'Creature - Elf', oracle_text: '' },
      ],
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, escapeGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: escapeGameId,
      cardId: 'escape_1',
      abilityId: 'escape',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(escapeGameId, playerId);
    const selectionStep = steps.find(step => step.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(selectionStep).toBeDefined();
    expect((selectionStep.validTargets || []).map((card: any) => card.id).sort()).toEqual(['escape_cost_1', 'escape_cost_2', 'escape_cost_3', 'escape_target_1']);

    const queuedEscapeEvent = [...getEvents(escapeGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(queuedEscapeEvent?.payload?.cardId).toBe('escape_1');
    expect(queuedEscapeEvent?.payload?.queuedResolutionStep?.type).toBe('graveyard_selection');
    expect(queuedEscapeEvent?.payload?.queuedResolutionStep?.graveyardCastExileAsCost).toBe(true);
    expect((queuedEscapeEvent?.payload?.queuedResolutionStep?.validTargets || []).map((card: any) => card.id).sort()).toEqual(['escape_cost_1', 'escape_cost_2', 'escape_cost_3', 'escape_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: escapeGameId,
      stepId: String(selectionStep.id),
      selections: ['escape_cost_1', 'escape_cost_2', 'escape_cost_3'],
    });

    const escapeTargetStep = ResolutionQueueManager
      .getStepsForPlayer(escapeGameId, playerId)
      .find((queuedStep) => (queuedStep as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(escapeTargetStep).toBeDefined();
    expect((escapeTargetStep.validTargets || []).map((target: any) => target.id)).toEqual(['escape_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: escapeGameId,
      stepId: String(escapeTargetStep.id),
      selections: ['escape_target_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['escape_target_1']);
    expect((zones?.exile || []).map((card: any) => card.id).sort()).toEqual(['escape_cost_1', 'escape_cost_2', 'escape_cost_3']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('escape_1');
    expect(stack[0]?.card?.castWithAbility).toBe('escape');
    expect(stack[0]?.targets).toEqual(['escape_target_1']);
    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
    expect((game.state as any).cardLeftGraveyardThisTurn?.[playerId]).toBe(true);
  });

  it('live escape creature casts keep escape entry counters through battlefield resolution', async () => {
    const woeStriderGameId = `${gameId}_woe_strider_live`;
    const { game, playerId } = await seedGame(
      woeStriderGameId,
      'woe_strider_1',
      'When this creature enters, create a 0/1 white Goat creature token.\nSacrifice another creature: Scry 1.\nEscape—{3}{B}{B}, Exile four other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)\nThis creature escapes with two +1/+1 counters on it.',
      {
        manaCost: '{2}{B}',
        manaPool: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 3 },
        extraGraveyard: [
          { id: 'woe_escape_cost_1', name: 'Cost One', type_line: 'Instant', oracle_text: '' },
          { id: 'woe_escape_cost_2', name: 'Cost Two', type_line: 'Sorcery', oracle_text: '' },
          { id: 'woe_escape_cost_3', name: 'Cost Three', type_line: 'Creature - Human', oracle_text: '' },
          { id: 'woe_escape_cost_4', name: 'Cost Four', type_line: 'Enchantment', oracle_text: '' },
        ],
      },
    );
    Object.assign((game.state as any).zones?.[playerId]?.graveyard?.[0] || {}, {
      name: 'Woe Strider',
      type_line: 'Creature — Horror',
      power: '3',
      toughness: '2',
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, woeStriderGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: woeStriderGameId,
      cardId: 'woe_strider_1',
      abilityId: 'escape',
    });

    const exileCostStep = ResolutionQueueManager
      .getStepsForPlayer(woeStriderGameId, playerId)
      .find((step) => step.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(exileCostStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: woeStriderGameId,
      stepId: String(exileCostStep.id),
      selections: ['woe_escape_cost_1', 'woe_escape_cost_2', 'woe_escape_cost_3', 'woe_escape_cost_4'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.entersBattlefieldWithCounters).toEqual({ '+1/+1': 2 });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const woeStrider = battlefield.find((permanent: any) => permanent?.card?.name === 'Woe Strider');
    expect(woeStrider).toBeDefined();
    expect(woeStrider?.counters?.['+1/+1']).toBe(2);

    game.resolveTopOfStack();
    const goatToken = ((game.state as any).battlefield || []).find((permanent: any) => permanent?.card?.name === 'Goat');
    expect(goatToken).toBeDefined();
  });

  it('live escaped Uro preserves the escape marker on the battlefield permanent', async () => {
    const uroGameId = `${gameId}_uro_live`;
    const { game, playerId } = await seedGame(
      uroGameId,
      'uro_1',
      "When Uro enters, sacrifice it unless it escaped.\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)",
      {
        manaCost: '{1}{G}{U}',
        manaPool: { white: 0, blue: 2, black: 0, red: 0, green: 2, colorless: 0 },
        extraGraveyard: [
          { id: 'uro_cost_1', name: 'Cost One', type_line: 'Instant', oracle_text: '' },
          { id: 'uro_cost_2', name: 'Cost Two', type_line: 'Sorcery', oracle_text: '' },
          { id: 'uro_cost_3', name: 'Cost Three', type_line: 'Creature - Human', oracle_text: '' },
          { id: 'uro_cost_4', name: 'Cost Four', type_line: 'Enchantment', oracle_text: '' },
          { id: 'uro_cost_5', name: 'Cost Five', type_line: 'Artifact', oracle_text: '' },
        ],
      },
    );
    Object.assign((game.state as any).zones?.[playerId]?.graveyard?.[0] || {}, {
      name: "Uro, Titan of Nature's Wrath",
      type_line: 'Legendary Creature — Elder Giant',
      power: '6',
      toughness: '6',
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, uroGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: uroGameId,
      cardId: 'uro_1',
      abilityId: 'escape',
    });

    const exileCostStep = ResolutionQueueManager
      .getStepsForPlayer(uroGameId, playerId)
      .find((step) => step.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(exileCostStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: uroGameId,
      stepId: String(exileCostStep.id),
      selections: ['uro_cost_1', 'uro_cost_2', 'uro_cost_3', 'uro_cost_4', 'uro_cost_5'],
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const uro = battlefield.find((permanent: any) => permanent?.card?.name === "Uro, Titan of Nature's Wrath");
    expect(uro).toBeDefined();
    expect(uro?.escapedFrom).toBe('graveyard');
  });

  it('live flashback activation queues the sacrifice cost and casts Dread Return after payment', async () => {
    const dreadReturnGameId = `${gameId}_dread_return_live`;
    const { game, playerId } = await seedGame(
      dreadReturnGameId,
      'dread_return_1',
      'Return target creature card from your graveyard to the battlefield.\nFlashback-Sacrifice three creatures.',
      {
        extraGraveyard: [
          { id: 'dread_return_target_1', name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
        ],
      },
    );
    (game.state as any).battlefield = [
      {
        id: 'dread_return_sac_1',
        controller: playerId,
        owner: playerId,
        card: { id: 'dread_return_sac_1', name: 'Sacrifice One', type_line: 'Creature - Zombie', oracle_text: '' },
      },
      {
        id: 'dread_return_sac_2',
        controller: playerId,
        owner: playerId,
        card: { id: 'dread_return_sac_2', name: 'Sacrifice Two', type_line: 'Creature - Skeleton', oracle_text: '' },
      },
      {
        id: 'dread_return_sac_3',
        controller: playerId,
        owner: playerId,
        card: { id: 'dread_return_sac_3', name: 'Sacrifice Three', type_line: 'Creature - Spirit', oracle_text: '' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, dreadReturnGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: dreadReturnGameId,
      cardId: 'dread_return_1',
      abilityId: 'flashback',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(dreadReturnGameId, playerId);
    const sacrificeStep = steps.find((step) => (step as any)?.graveyardCastSacrificeAsCost === true) as any;
    expect(sacrificeStep).toBeDefined();
    expect((sacrificeStep.validTargets || []).map((target: any) => target.id).sort()).toEqual([
      'dread_return_sac_1',
      'dread_return_sac_2',
      'dread_return_sac_3',
    ]);

    const queuedDreadReturnEvent = [...getEvents(dreadReturnGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(queuedDreadReturnEvent?.payload?.queuedResolutionStep?.type).toBe('target_selection');
    expect(queuedDreadReturnEvent?.payload?.queuedResolutionStep?.graveyardCastSacrificeAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: dreadReturnGameId,
      stepId: String(sacrificeStep.id),
      selections: ['dread_return_sac_1', 'dread_return_sac_2', 'dread_return_sac_3'],
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(dreadReturnGameId, playerId)
      .find((queuedStep) => (queuedStep as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id).sort()).toEqual([
      'dread_return_sac_1',
      'dread_return_sac_2',
      'dread_return_sac_3',
      'dread_return_target_1',
    ]);

    const sacrificeResolveEvent = [...getEvents(dreadReturnGameId)].reverse().find((event) => event.type === 'sacrificeSelectionResolve') as any;
    expect((sacrificeResolveEvent?.payload?.permanentIds || []).sort()).toEqual([
      'dread_return_sac_1',
      'dread_return_sac_2',
      'dread_return_sac_3',
    ]);

    await handlers['submitResolutionResponse']({
      gameId: dreadReturnGameId,
      stepId: String(targetStep.id),
      selections: ['dread_return_target_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id).sort()).toEqual([
      'dread_return_sac_1',
      'dread_return_sac_2',
      'dread_return_sac_3',
      'dread_return_target_1',
    ]);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('dread_return_1');
    expect(stack[0]?.card?.castWithAbility).toBe('flashback');
    expect(stack[0]?.targets).toEqual(['dread_return_target_1']);
  });

  it("live flashback Sevinne's Reclamation queues a post-resolution copy choice and retargets the copy", async () => {
    const sevinneGameId = `${gameId}_sevinne_live`;
    const { game, playerId } = await seedGame(
      sevinneGameId,
      'sevinne_reclamation_1',
      "Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.\nFlashback {4}{W}",
      {
        manaPool: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
        extraGraveyard: [
          { id: 'sevinne_target_1', name: 'Wayfarer\'s Bauble', type_line: 'Artifact', oracle_text: '', mana_value: 1, cmc: 1 },
          { id: 'sevinne_target_2', name: 'Mind Stone', type_line: 'Artifact', oracle_text: '', mana_value: 2, cmc: 2 },
          { id: 'sevinne_invalid_mv', name: 'Hedron Archive', type_line: 'Artifact', oracle_text: '', mana_value: 4, cmc: 4 },
          { id: 'sevinne_invalid_type', name: 'Opt', type_line: 'Instant', oracle_text: '', mana_value: 1, cmc: 1 },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = "Sevinne's Reclamation";

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, sevinneGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: sevinneGameId,
      cardId: 'sevinne_reclamation_1',
      abilityId: 'flashback',
    });

    const castTargetStep = ResolutionQueueManager
      .getStepsForPlayer(sevinneGameId, playerId)
      .find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(castTargetStep).toBeDefined();
    expect((castTargetStep.validTargets || []).map((target: any) => target.id).sort()).toEqual([
      'sevinne_target_1',
      'sevinne_target_2',
    ]);

    await handlers['submitResolutionResponse']({
      gameId: sevinneGameId,
      stepId: String(castTargetStep.id),
      selections: ['sevinne_target_1'],
    });

    expect(((game.state as any).stack || []).map((item: any) => item?.card?.id)).toEqual(['sevinne_reclamation_1']);

    game.resolveTopOfStack();

    expect(((game.state as any).battlefield || []).some((perm: any) => String(perm?.card?.id || '') === 'sevinne_target_1')).toBe(true);
    expect(((game.state as any).stack || [])).toHaveLength(0);

    const copyChoiceStep = ResolutionQueueManager
      .getStepsForPlayer(sevinneGameId, playerId)
      .find((step: any) => (step as any)?.resolvedSpellCopyChoice === true) as any;
    expect(copyChoiceStep).toBeDefined();
    expect((copyChoiceStep.resolvedSpellCopyRetargetValidTargets || []).map((target: any) => target.id)).toEqual(['sevinne_target_2']);

    const copyPromptEvent = [...getEvents(sevinneGameId)].reverse().find((event) =>
      event.type === 'resolveTopOfStackPrompt' && (event as any)?.payload?.queuedResolutionStep?.resolvedSpellCopyChoice === true,
    ) as any;
    expect(copyPromptEvent?.payload?.queuedResolutionStep?.resolvedSpellCopyChoice).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: sevinneGameId,
      stepId: String(copyChoiceStep.id),
      selections: ['yes'],
    });

    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId) as any;
    expect(copiedSpell).toBeDefined();
    expect(copiedSpell?.isCopy).toBe(true);
    expect(copiedSpell?.targets).toEqual(['sevinne_target_1']);

    const retargetChoiceStep = ResolutionQueueManager
      .getStepsForPlayer(sevinneGameId, playerId)
      .find((step: any) => (step as any)?.retargetSpellCopy === true) as any;
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep.retargetSpellCopyValidTargets || []).map((target: any) => target.id)).toEqual(['sevinne_target_2']);

    await handlers['submitResolutionResponse']({
      gameId: sevinneGameId,
      stepId: String(retargetChoiceStep.id),
      selections: ['retarget'],
    });

    const retargetSelectionStep = ResolutionQueueManager
      .getStepsForPlayer(sevinneGameId, playerId)
      .find((step: any) => (step as any)?.retargetSpellCopyTargetSelection === true) as any;
    expect(retargetSelectionStep).toBeDefined();
    expect((retargetSelectionStep.validTargets || []).map((target: any) => target.id)).toEqual(['sevinne_target_2']);

    await handlers['submitResolutionResponse']({
      gameId: sevinneGameId,
      stepId: String(retargetSelectionStep.id),
      selections: ['sevinne_target_2'],
    });

    expect((((game.state as any).stack || [])[0] as any)?.targets).toEqual(['sevinne_target_2']);

    game.resolveTopOfStack();

    const battlefieldCardIds = ((game.state as any).battlefield || []).map((perm: any) => String(perm?.card?.id || ''));
    expect(battlefieldCardIds).toEqual(expect.arrayContaining(['sevinne_target_1', 'sevinne_target_2']));
    expect((game.state as any).stack || []).toHaveLength(0);
    expect(ResolutionQueueManager.getStepsForPlayer(sevinneGameId, playerId)).toEqual([]);
  });

  it("replay resolveTopOfStack restores Sevinne's Reclamation copy choice after the original resolves", async () => {
    const replayGameId = `${gameId}_sevinne_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'sevinne_reclamation_replay_1',
      "Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.\nFlashback {4}{W}",
      {
        manaPool: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
        extraGraveyard: [
          { id: 'sevinne_replay_target_1', name: 'Wayfarer\'s Bauble', type_line: 'Artifact', oracle_text: '', mana_value: 1, cmc: 1 },
          { id: 'sevinne_replay_target_2', name: 'Mind Stone', type_line: 'Artifact', oracle_text: '', mana_value: 2, cmc: 2 },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = "Sevinne's Reclamation";

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'sevinne_reclamation_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_sevinne_replay_1',
      manaCost: '{4}{W}',
      targets: ['sevinne_replay_target_1'],
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect((game.state as any).stack || []).toHaveLength(0);
    expect(((game.state as any).battlefield || []).some((perm: any) => String(perm?.card?.id || '') === 'sevinne_replay_target_1')).toBe(true);

    const copyChoiceStep = ResolutionQueueManager
      .getStepsForPlayer(replayGameId, playerId)
      .find((step: any) => (step as any)?.resolvedSpellCopyChoice === true) as any;
    expect(copyChoiceStep).toBeDefined();
    expect((copyChoiceStep.resolvedSpellCopyRetargetValidTargets || []).map((target: any) => target.id)).toEqual(['sevinne_replay_target_2']);
    expect(copyChoiceStep?.resolvedSpellCopySnapshot?.copiedFromStackItemId).toBe('stack_sevinne_replay_1');
  });

  it('live flashback Past in Flames grants flashback to other instants and sorceries in your graveyard', async () => {
    const pastInFlamesGameId = `${gameId}_past_in_flames_live`;
    const { game, playerId } = await seedGame(
      pastInFlamesGameId,
      'past_in_flames_1',
      'Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.\nFlashback {4}{R}',
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 1, green: 0, colorless: 4 },
        extraGraveyard: [
          { id: 'past_in_flames_opt_1', name: 'Opt', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Scry 1, then draw a card.' },
          { id: 'past_in_flames_divination_1', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: 'Draw two cards.' },
          { id: 'past_in_flames_bear_1', name: 'Runeclaw Bear', type_line: 'Creature - Bear', mana_cost: '{1}{G}', oracle_text: '' },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Past in Flames';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, pastInFlamesGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: pastInFlamesGameId,
      cardId: 'past_in_flames_1',
      abilityId: 'flashback',
    });

    expect(((game.state as any).stack || []).map((item: any) => item?.card?.id)).toEqual(['past_in_flames_1']);

    game.resolveTopOfStack();

    const temporaryGrants = Array.isArray((game.state as any).temporaryGraveyardKeywordGrants)
      ? (game.state as any).temporaryGraveyardKeywordGrants
      : [];
    expect(temporaryGrants).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: 'past_in_flames_opt_1', keyword: 'flashback', cost: '{U}' }),
      expect.objectContaining({ cardId: 'past_in_flames_divination_1', keyword: 'flashback', cost: '{2}{U}' }),
    ]));
    expect(temporaryGrants.some((grant: any) => String(grant?.cardId || '') === 'past_in_flames_bear_1')).toBe(false);

    await handlers['activateGraveyardAbility']({
      gameId: pastInFlamesGameId,
      cardId: 'past_in_flames_opt_1',
      abilityId: 'flashback',
    });

    expect(((game.state as any).stack || []).some((item: any) => String(item?.card?.id || '') === 'past_in_flames_opt_1')).toBe(true);
  });

  it('replay resolveTopOfStack restores Past in Flames temporary flashback grants', async () => {
    const replayGameId = `${gameId}_past_in_flames_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'past_in_flames_replay_1',
      'Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.\nFlashback {4}{R}',
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 1, green: 0, colorless: 4 },
        extraGraveyard: [
          { id: 'past_in_flames_replay_opt_1', name: 'Opt', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Scry 1, then draw a card.' },
          { id: 'past_in_flames_replay_divination_1', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: 'Draw two cards.' },
          { id: 'past_in_flames_replay_bear_1', name: 'Runeclaw Bear', type_line: 'Creature - Bear', mana_cost: '{1}{G}', oracle_text: '' },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Past in Flames';

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'past_in_flames_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_past_in_flames_replay_1',
      manaCost: '{4}{R}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const temporaryGrants = Array.isArray((game.state as any).temporaryGraveyardKeywordGrants)
      ? (game.state as any).temporaryGraveyardKeywordGrants
      : [];
    expect(temporaryGrants).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: 'past_in_flames_replay_opt_1', keyword: 'flashback', cost: '{U}' }),
      expect.objectContaining({ cardId: 'past_in_flames_replay_divination_1', keyword: 'flashback', cost: '{2}{U}' }),
    ]));
    expect(temporaryGrants.some((grant: any) => String(grant?.cardId || '') === 'past_in_flames_replay_bear_1')).toBe(false);
  });

  it('live flashback Momentary Blink flickers the targeted creature you control', async () => {
    const blinkGameId = `${gameId}_momentary_blink_live`;
    const { game, playerId } = await seedGame(
      blinkGameId,
      'momentary_blink_1',
      "Exile target creature you control, then return it to the battlefield under its owner's control.\nFlashback {3}{U}",
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Momentary Blink';
    (game.state as any).battlefield = [
      {
        id: 'momentary_blink_target_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: {
          id: 'momentary_blink_target_card_1',
          name: 'Wall of Omens',
          type_line: 'Creature - Wall',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, blinkGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: blinkGameId,
      cardId: 'momentary_blink_1',
      abilityId: 'flashback',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(blinkGameId, playerId)
      .find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['momentary_blink_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: blinkGameId,
      stepId: String(targetStep.id),
      selections: ['momentary_blink_target_1'],
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).not.toBe('momentary_blink_target_1');
    expect(String(battlefield[0]?.card?.name || '')).toBe('Wall of Omens');
    expect(String(battlefield[0]?.controller || '')).toBe(playerId);
    expect(Boolean(battlefield[0]?.tapped)).toBe(false);
  });

  it('replay resolveTopOfStack restores Momentary Blink flicker results', async () => {
    const replayGameId = `${gameId}_momentary_blink_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'momentary_blink_replay_1',
      "Exile target creature you control, then return it to the battlefield under its owner's control.\nFlashback {3}{U}",
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Momentary Blink';
    (game.state as any).battlefield = [
      {
        id: 'momentary_blink_replay_target_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: {
          id: 'momentary_blink_replay_target_card_1',
          name: 'Wall of Omens',
          type_line: 'Creature - Wall',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'momentary_blink_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_momentary_blink_replay_1',
      manaCost: '{3}{U}',
      targets: ['momentary_blink_replay_target_1'],
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).not.toBe('momentary_blink_replay_target_1');
    expect(String(battlefield[0]?.card?.name || '')).toBe('Wall of Omens');
    expect(String(battlefield[0]?.controller || '')).toBe(playerId);
    expect(Boolean(battlefield[0]?.tapped)).toBe(false);
  });

  it('live flashback Cackling Counterpart creates a token copy of the targeted creature you control', async () => {
    const counterpartGameId = `${gameId}_cackling_live`;
    const { game, playerId } = await seedGame(
      counterpartGameId,
      'cackling_counterpart_1',
      "Create a token that's a copy of target creature you control.\nFlashback {5}{U}{U}",
      {
        manaPool: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 5 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Cackling Counterpart';
    (game.state as any).battlefield = [
      {
        id: 'cackling_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        counters: {},
        card: {
          id: 'cackling_target_card_1',
          name: 'Bear Cub',
          type_line: 'Creature - Bear',
          power: '2',
          toughness: '2',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, counterpartGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: counterpartGameId,
      cardId: 'cackling_counterpart_1',
      abilityId: 'flashback',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(counterpartGameId, playerId)
      .find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['cackling_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: counterpartGameId,
      stepId: String(targetStep.id),
      selections: ['cackling_target_1'],
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const bearCopies = battlefield.filter((perm: any) => String(perm?.card?.name || '') === 'Bear Cub');
    expect(bearCopies).toHaveLength(2);
    const tokenCopy = bearCopies.find((perm: any) => perm?.isToken === true);
    expect(tokenCopy).toBeDefined();
    expect(String(tokenCopy?.controller || '')).toBe(playerId);
    expect(Number(tokenCopy?.basePower || 0)).toBe(2);
    expect(Number(tokenCopy?.baseToughness || 0)).toBe(2);
  });

  it('replay resolveTopOfStack restores Cackling Counterpart token-copy results', async () => {
    const replayGameId = `${gameId}_cackling_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'cackling_counterpart_replay_1',
      "Create a token that's a copy of target creature you control.\nFlashback {5}{U}{U}",
      {
        manaPool: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 5 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Cackling Counterpart';
    (game.state as any).battlefield = [
      {
        id: 'cackling_replay_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        counters: {},
        card: {
          id: 'cackling_replay_target_card_1',
          name: 'Bear Cub',
          type_line: 'Creature - Bear',
          power: '2',
          toughness: '2',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'cackling_counterpart_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_cackling_counterpart_replay_1',
      manaCost: '{5}{U}{U}',
      targets: ['cackling_replay_target_1'],
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = (game.state as any).battlefield || [];
    const bearCopies = battlefield.filter((perm: any) => String(perm?.card?.name || '') === 'Bear Cub');
    expect(bearCopies).toHaveLength(2);
    const tokenCopy = bearCopies.find((perm: any) => perm?.isToken === true);
    expect(tokenCopy).toBeDefined();
    expect(String(tokenCopy?.controller || '')).toBe(playerId);
    expect(Number(tokenCopy?.basePower || 0)).toBe(2);
    expect(Number(tokenCopy?.baseToughness || 0)).toBe(2);
  });

  it('live flashback Think Twice draws a card and exiles itself on resolution', async () => {
    const thinkTwiceGameId = `${gameId}_think_twice_live`;
    const { game, playerId } = await seedGame(
      thinkTwiceGameId,
      'think_twice_1',
      'Draw a card.\nFlashback {2}{U}',
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Think Twice';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    (game.state as any).zones[playerId].library = [
      {
        id: 'think_twice_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
    ];
    (game.state as any).zones[playerId].libraryCount = 1;
    (game as any).libraries.set(playerId, [
      {
        id: 'think_twice_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, thinkTwiceGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: thinkTwiceGameId,
      cardId: 'think_twice_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['think_twice_draw_1']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('think_twice_1');
    expect((((game as any).libraries.get(playerId) || []) as any[]).map((card: any) => card.id)).toEqual([]);
  });

  it('replay resolveTopOfStack restores Think Twice draw-and-exile results', async () => {
    const replayGameId = `${gameId}_think_twice_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'think_twice_replay_1',
      'Draw a card.\nFlashback {2}{U}',
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Think Twice';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    (game.state as any).zones[playerId].library = [
      {
        id: 'think_twice_replay_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
    ];
    (game.state as any).zones[playerId].libraryCount = 1;
    (game as any).libraries.set(playerId, [
      {
        id: 'think_twice_replay_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
    ]);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'think_twice_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_think_twice_replay_1',
      manaCost: '{2}{U}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['think_twice_replay_draw_1']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('think_twice_replay_1');
    expect((((game as any).libraries.get(playerId) || []) as any[]).map((card: any) => card.id)).toEqual([]);
  });

  it('live flashback Strike It Rich creates a Treasure token and exiles itself on resolution', async () => {
    const strikeGameId = `${gameId}_strike_it_rich_live`;
    const { game, playerId } = await seedGame(
      strikeGameId,
      'strike_it_rich_1',
      'Create a Treasure token.\nFlashback {2}{R}',
      {
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Strike It Rich';
    (game.state as any).battlefield = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, strikeGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: strikeGameId,
      cardId: 'strike_it_rich_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const treasureTokens = battlefield.filter((perm: any) => perm?.isToken === true && String(perm?.card?.name || '') === 'Treasure');
    expect(treasureTokens).toHaveLength(1);
    expect(String(treasureTokens[0]?.controller || '')).toBe(playerId);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('strike_it_rich_1');
  });

  it('replay resolveTopOfStack restores Strike It Rich token-and-exile results', async () => {
    const replayGameId = `${gameId}_strike_it_rich_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'strike_it_rich_replay_1',
      'Create a Treasure token.\nFlashback {2}{R}',
      {
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Strike It Rich';
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'strike_it_rich_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_strike_it_rich_replay_1',
      manaCost: '{2}{R}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = (game.state as any).battlefield || [];
    const treasureTokens = battlefield.filter((perm: any) => perm?.isToken === true && String(perm?.card?.name || '') === 'Treasure');
    expect(treasureTokens).toHaveLength(1);
    expect(String(treasureTokens[0]?.controller || '')).toBe(playerId);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('strike_it_rich_replay_1');
  });

  it('live flashback Deep Analysis pays life, draws two cards, and exiles itself on resolution', async () => {
    const analysisGameId = `${gameId}_deep_analysis_live`;
    const { game, playerId } = await seedGame(
      analysisGameId,
      'deep_analysis_1',
      'Target player draws two cards.\nFlashback {1}{U}, Pay 3 life.',
      {
        life: 20,
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Deep Analysis';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    (game.state as any).zones[playerId].library = [
      {
        id: 'deep_analysis_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
      {
        id: 'deep_analysis_draw_2',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1, then draw a card.',
        zone: 'library',
      },
    ];
    (game.state as any).zones[playerId].libraryCount = 2;
    (game as any).libraries.set(playerId, [
      {
        id: 'deep_analysis_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
      {
        id: 'deep_analysis_draw_2',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1, then draw a card.',
        zone: 'library',
      },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, analysisGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: analysisGameId,
      cardId: 'deep_analysis_1',
      abilityId: 'flashback',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(analysisGameId, playerId)
      .find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: analysisGameId,
      stepId: String(targetStep.id),
      selections: [playerId],
    });

    game.resolveTopOfStack();

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id).sort()).toEqual(['deep_analysis_draw_1', 'deep_analysis_draw_2']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('deep_analysis_1');
    expect((((game as any).libraries.get(playerId) || []) as any[]).map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).life?.[playerId]).toBe(17);
  });

  it('replay resolveTopOfStack restores Deep Analysis draw-and-exile results', async () => {
    const replayGameId = `${gameId}_deep_analysis_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'deep_analysis_replay_1',
      'Target player draws two cards.\nFlashback {1}{U}, Pay 3 life.',
      {
        life: 20,
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Deep Analysis';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    (game.state as any).zones[playerId].library = [
      {
        id: 'deep_analysis_replay_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
      {
        id: 'deep_analysis_replay_draw_2',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1, then draw a card.',
        zone: 'library',
      },
    ];
    (game.state as any).zones[playerId].libraryCount = 2;
    (game as any).libraries.set(playerId, [
      {
        id: 'deep_analysis_replay_draw_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
        zone: 'library',
      },
      {
        id: 'deep_analysis_replay_draw_2',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1, then draw a card.',
        zone: 'library',
      },
    ]);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'deep_analysis_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_deep_analysis_replay_1',
      manaCost: '{1}{U}',
      lifePaidForCost: 3,
      targets: [playerId],
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id).sort()).toEqual(['deep_analysis_replay_draw_1', 'deep_analysis_replay_draw_2']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('deep_analysis_replay_1');
    expect((((game as any).libraries.get(playerId) || []) as any[]).map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).life?.[playerId]).toBe(17);
  });

  it('live flashback Army of the Damned creates thirteen tapped 2/2 black Zombie tokens and exiles itself on resolution', async () => {
    const armyGameId = `${gameId}_army_live`;
    const { game, playerId } = await seedGame(
      armyGameId,
      'army_of_the_damned_1',
      'Create thirteen tapped 2/2 black Zombie creature tokens.\nFlashback {7}{B}{B}{B}',
      {
        manaPool: { white: 0, blue: 0, black: 3, red: 0, green: 0, colorless: 7 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Army of the Damned';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    (game.state as any).battlefield = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, armyGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: armyGameId,
      cardId: 'army_of_the_damned_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const zombieTokens = battlefield.filter((perm: any) => perm?.isToken === true && String(perm?.card?.type_line || '').includes('Zombie'));
    expect(zombieTokens).toHaveLength(13);
    expect(zombieTokens.every((perm: any) => perm?.tapped === true)).toBe(true);
    expect(zombieTokens.every((perm: any) => Number(perm?.basePower || 0) === 2)).toBe(true);
    expect(zombieTokens.every((perm: any) => Number(perm?.baseToughness || 0) === 2)).toBe(true);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('army_of_the_damned_1');
  });

  it('replay resolveTopOfStack restores Army of the Damned token-and-exile results', async () => {
    const replayGameId = `${gameId}_army_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'army_of_the_damned_replay_1',
      'Create thirteen tapped 2/2 black Zombie creature tokens.\nFlashback {7}{B}{B}{B}',
      {
        manaPool: { white: 0, blue: 0, black: 3, red: 0, green: 0, colorless: 7 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Army of the Damned';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'army_of_the_damned_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_army_of_the_damned_replay_1',
      manaCost: '{7}{B}{B}{B}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = (game.state as any).battlefield || [];
    const zombieTokens = battlefield.filter((perm: any) => perm?.isToken === true && String(perm?.card?.type_line || '').includes('Zombie'));
    expect(zombieTokens).toHaveLength(13);
    expect(zombieTokens.every((perm: any) => perm?.tapped === true)).toBe(true);
    expect(zombieTokens.every((perm: any) => Number(perm?.basePower || 0) === 2)).toBe(true);
    expect(zombieTokens.every((perm: any) => Number(perm?.baseToughness || 0) === 2)).toBe(true);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('army_of_the_damned_replay_1');
  });

  it('live flashback Otherworldly Gaze queues a surveil prompt and exiles itself on resolution', async () => {
    const gazeGameId = `${gameId}_otherworldly_gaze_live`;
    const { game, playerId } = await seedGame(
      gazeGameId,
      'otherworldly_gaze_1',
      'Surveil 3.\nFlashback {1}{U}',
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Otherworldly Gaze';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    const libraryCards = [
      { id: 'otherworldly_gaze_top_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '', zone: 'library' },
      { id: 'otherworldly_gaze_top_2', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1, then draw a card.', zone: 'library' },
      { id: 'otherworldly_gaze_top_3', name: 'Consider', type_line: 'Instant', oracle_text: 'Surveil 1, then draw a card.', zone: 'library' },
    ];
    (game.state as any).zones[playerId].library = libraryCards.map((card) => ({ ...card }));
    (game.state as any).zones[playerId].libraryCount = libraryCards.length;
    (game as any).libraries.set(playerId, libraryCards.map((card) => ({ ...card })));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gazeGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: gazeGameId,
      cardId: 'otherworldly_gaze_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    const surveilStep = ResolutionQueueManager
      .getStepsForPlayer(gazeGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();
    expect(Number(surveilStep?.surveilCount || 0)).toBe(3);
    expect((surveilStep?.cards || []).map((card: any) => card.id)).toEqual([
      'otherworldly_gaze_top_1',
      'otherworldly_gaze_top_2',
      'otherworldly_gaze_top_3',
    ]);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('otherworldly_gaze_1');
  });

  it('replay resolveTopOfStack restores Otherworldly Gaze surveil prompt state', async () => {
    const replayGameId = `${gameId}_otherworldly_gaze_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'otherworldly_gaze_replay_1',
      'Surveil 3.\nFlashback {1}{U}',
      {
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Otherworldly Gaze';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    const libraryCards = [
      { id: 'otherworldly_gaze_replay_top_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '', zone: 'library' },
      { id: 'otherworldly_gaze_replay_top_2', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1, then draw a card.', zone: 'library' },
      { id: 'otherworldly_gaze_replay_top_3', name: 'Consider', type_line: 'Instant', oracle_text: 'Surveil 1, then draw a card.', zone: 'library' },
    ];
    (game.state as any).zones[playerId].library = libraryCards.map((card) => ({ ...card }));
    (game.state as any).zones[playerId].libraryCount = libraryCards.length;
    (game as any).libraries.set(playerId, libraryCards.map((card) => ({ ...card })));

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'otherworldly_gaze_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_otherworldly_gaze_replay_1',
      manaCost: '{1}{U}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const surveilStep = ResolutionQueueManager
      .getStepsForPlayer(replayGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();
    expect(Number(surveilStep?.surveilCount || 0)).toBe(3);
    expect((surveilStep?.cards || []).map((card: any) => card.id)).toEqual([
      'otherworldly_gaze_replay_top_1',
      'otherworldly_gaze_replay_top_2',
      'otherworldly_gaze_replay_top_3',
    ]);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('otherworldly_gaze_replay_1');
  });

  it('live flashback Faithless Looting draws, queues discard, and exiles itself on resolution', async () => {
    const lootingGameId = `${gameId}_faithless_looting_live`;
    const { game, playerId } = await seedGame(
      lootingGameId,
      'faithless_looting_1',
      'Draw two cards, then discard two cards.\nFlashback {2}{R}',
      {
        manaCost: '{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
        hand: [
          {
            id: 'faithless_keep_1',
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            zone: 'hand',
          },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Faithless Looting';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    const libraryCards = [
      { id: 'faithless_draw_1', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'library' },
      { id: 'faithless_draw_2', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', zone: 'library' },
    ];
    (game.state as any).zones[playerId].library = libraryCards.map((card) => ({ ...card }));
    (game.state as any).zones[playerId].libraryCount = libraryCards.length;
    (game as any).libraries.set(playerId, libraryCards.map((card) => ({ ...card })));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, lootingGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: lootingGameId,
      cardId: 'faithless_looting_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    const discardStep = ResolutionQueueManager
      .getStepsForPlayer(lootingGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect(Number(discardStep?.discardCount || 0)).toBe(2);
    expect((discardStep?.hand || []).map((card: any) => card.id)).toEqual([
      'faithless_keep_1',
      'faithless_draw_1',
      'faithless_draw_2',
    ]);

    const zonesAfterResolve = (game.state as any).zones?.[playerId];
    expect((zonesAfterResolve?.hand || []).map((card: any) => card.id)).toEqual([
      'faithless_keep_1',
      'faithless_draw_1',
      'faithless_draw_2',
    ]);
    expect((zonesAfterResolve?.exile || []).map((card: any) => card.id)).toContain('faithless_looting_1');

    await handlers['submitResolutionResponse']({
      gameId: lootingGameId,
      stepId: String(discardStep.id),
      selections: ['faithless_draw_1', 'faithless_draw_2'],
    });

    const zonesAfterDiscard = (game.state as any).zones?.[playerId];
    expect((zonesAfterDiscard?.hand || []).map((card: any) => card.id)).toEqual(['faithless_keep_1']);
    expect((zonesAfterDiscard?.graveyard || []).map((card: any) => card.id)).toEqual([
      'faithless_draw_1',
      'faithless_draw_2',
    ]);
    expect((zonesAfterDiscard?.exile || []).map((card: any) => card.id)).toContain('faithless_looting_1');
  });

  it('replay resolveTopOfStack restores Faithless Looting discard prompt state', async () => {
    const replayGameId = `${gameId}_faithless_looting_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'faithless_looting_replay_1',
      'Draw two cards, then discard two cards.\nFlashback {2}{R}',
      {
        manaCost: '{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
        hand: [
          {
            id: 'faithless_replay_keep_1',
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            zone: 'hand',
          },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Faithless Looting';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    const libraryCards = [
      { id: 'faithless_replay_draw_1', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'library' },
      { id: 'faithless_replay_draw_2', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', zone: 'library' },
    ];
    (game.state as any).zones[playerId].library = libraryCards.map((card) => ({ ...card }));
    (game.state as any).zones[playerId].libraryCount = libraryCards.length;
    (game as any).libraries.set(playerId, libraryCards.map((card) => ({ ...card })));

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'faithless_looting_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_faithless_looting_replay_1',
      manaCost: '{2}{R}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const discardStep = ResolutionQueueManager
      .getStepsForPlayer(replayGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect(Number(discardStep?.discardCount || 0)).toBe(2);
    expect((discardStep?.hand || []).map((card: any) => card.id)).toEqual([
      'faithless_replay_keep_1',
      'faithless_replay_draw_1',
      'faithless_replay_draw_2',
    ]);

    const zonesAfterResolve = (game.state as any).zones?.[playerId];
    expect((zonesAfterResolve?.hand || []).map((card: any) => card.id)).toEqual([
      'faithless_replay_keep_1',
      'faithless_replay_draw_1',
      'faithless_replay_draw_2',
    ]);
    expect((zonesAfterResolve?.exile || []).map((card: any) => card.id)).toContain('faithless_looting_replay_1');
  });

  it('live flashback Laughing Mad pays the discard cost, draws two cards, and exiles itself on resolution', async () => {
    const laughingMadGameId = `${gameId}_laughing_mad_live`;
    const { game, playerId } = await seedGame(
      laughingMadGameId,
      'laughing_mad_1',
      'As an additional cost to cast this spell, discard a card.\nDraw two cards.\nFlashback {3}{R}',
      {
        manaCost: '{2}{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 3 },
        hand: [
          {
            id: 'laughing_mad_discard_1',
            name: 'Spare Goblin',
            type_line: 'Creature - Goblin',
            oracle_text: '',
            zone: 'hand',
          },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Laughing Mad';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    const libraryCards = [
      { id: 'laughing_mad_draw_1', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'library' },
      { id: 'laughing_mad_draw_2', name: 'Thrill of Possibility', type_line: 'Instant', oracle_text: 'As an additional cost to cast this spell, discard a card. Draw two cards.', zone: 'library' },
    ];
    (game.state as any).zones[playerId].library = libraryCards.map((card) => ({ ...card }));
    (game.state as any).zones[playerId].libraryCount = libraryCards.length;
    (game as any).libraries.set(playerId, libraryCards.map((card) => ({ ...card })));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, laughingMadGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: laughingMadGameId,
      cardId: 'laughing_mad_1',
      abilityId: 'flashback',
    });

    const discardStep = ResolutionQueueManager
      .getStepsForPlayer(laughingMadGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep?.hand || []).map((card: any) => card.id)).toEqual(['laughing_mad_discard_1']);

    const activateEvent = [...getEvents(laughingMadGameId)].reverse().find((event) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.queuedResolutionStep?.type).toBe(ResolutionStepType.DISCARD_SELECTION);
    expect(activateEvent?.payload?.queuedResolutionStep?.graveyardCastDiscardAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: laughingMadGameId,
      stepId: String(discardStep.id),
      selections: ['laughing_mad_discard_1'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('laughing_mad_1');
    expect(stack[0]?.card?.castWithAbility).toBe('flashback');

    game.resolveTopOfStack();

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual([
      'laughing_mad_draw_1',
      'laughing_mad_draw_2',
    ]);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['laughing_mad_discard_1']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('laughing_mad_1');
  });

  it('replays queued Laughing Mad discard prompts before the additional cost is paid', async () => {
    const replayGameId = `${gameId}_laughing_mad_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'laughing_mad_replay_1',
      'As an additional cost to cast this spell, discard a card.\nDraw two cards.\nFlashback {3}{R}',
      {
        hand: [
          {
            id: 'laughing_mad_replay_discard_1',
            name: 'Spare Goblin',
            type_line: 'Creature - Goblin',
            oracle_text: '',
            zone: 'hand',
          },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Laughing Mad';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'laughing_mad_replay_1',
      abilityId: 'flashback',
      queuedResolutionStep: {
        id: 'queued_laughing_mad_discard_1',
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId,
        sourceId: 'laughing_mad_replay_1',
        sourceName: 'Laughing Mad',
        description: 'Laughing Mad: Discard 1 card to cast it.',
        mandatory: true,
        hand: [
          {
            id: 'laughing_mad_replay_discard_1',
            name: 'Spare Goblin',
            type_line: 'Creature - Goblin',
            oracle_text: '',
            zone: 'hand',
          },
        ],
        discardCount: 1,
        currentHandSize: 1,
        maxHandSize: 7,
        reason: 'activation_cost',
        graveyardCastDiscardAsCost: true,
        cardId: 'laughing_mad_replay_1',
        abilityId: 'flashback',
        cardName: 'Laughing Mad',
      },
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toContain('laughing_mad_replay_1');
    expect((game.state as any).stack || []).toHaveLength(0);

    const steps = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId);
    expect(steps).toHaveLength(1);
    expect(String((steps[0] as any)?.id || '')).toBe('queued_laughing_mad_discard_1');
    expect((steps[0] as any)?.graveyardCastDiscardAsCost).toBe(true);
    expect((steps[0] as any)?.hand?.map((card: any) => card.id)).toEqual(['laughing_mad_replay_discard_1']);
  });

  it('live flashback Seize the Day untaps the target and adds an extra combat', async () => {
    const seizeGameId = `${gameId}_seize_the_day_live`;
    const { game, playerId } = await seedGame(
      seizeGameId,
      'seize_the_day_1',
      'Untap target creature. After this main phase, there is an additional combat phase followed by an additional main phase.\nFlashback {2}{R}',
      {
        manaCost: '{3}{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Seize the Day';
    (game.state as any).battlefield = [
      {
        id: 'seize_target_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        attacking: false,
        card: {
          id: 'seize_target_card_1',
          name: 'Goblin Raider',
          type_line: 'Creature - Goblin',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, seizeGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: seizeGameId,
      cardId: 'seize_the_day_1',
      abilityId: 'flashback',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(seizeGameId, playerId)
      .find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['seize_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: seizeGameId,
      stepId: String(targetStep.id),
      selections: ['seize_target_1'],
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    expect(Boolean(battlefield[0]?.tapped)).toBe(false);
    expect(((game.state as any).extraCombats || []).length).toBe(1);
    expect(((game.state as any).extraCombats || [])[0]?.source).toBe('Seize the Day');
    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('seize_the_day_1');
  });

  it('replay resolveTopOfStack restores Seize the Day untap and extra-combat results', async () => {
    const replayGameId = `${gameId}_seize_the_day_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'seize_the_day_replay_1',
      'Untap target creature. After this main phase, there is an additional combat phase followed by an additional main phase.\nFlashback {2}{R}',
      {
        manaCost: '{3}{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Seize the Day';
    (game.state as any).battlefield = [
      {
        id: 'seize_replay_target_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        attacking: false,
        card: {
          id: 'seize_replay_target_card_1',
          name: 'Goblin Raider',
          type_line: 'Creature - Goblin',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'seize_the_day_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_seize_the_day_replay_1',
      manaCost: '{2}{R}',
      targets: ['seize_replay_target_1'],
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(Boolean(battlefield[0]?.tapped)).toBe(false);
    expect(((game.state as any).extraCombats || []).length).toBe(1);
    expect(((game.state as any).extraCombats || [])[0]?.source).toBe('Seize the Day');
    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('seize_the_day_replay_1');
  });

  it('live flashback Electroduplicate creates a hasty token copy and schedules it for sacrifice', async () => {
    const electroduplicateGameId = `${gameId}_electroduplicate_live`;
    const { game, playerId } = await seedGame(
      electroduplicateGameId,
      'electroduplicate_1',
      'Create a token that\'s a copy of target creature you control, except it has haste and "At the beginning of the end step, sacrifice this token."\nFlashback {2}{R}{R}',
      {
        manaCost: '{2}{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Electroduplicate';
    (game.state as any).battlefield = [
      {
        id: 'electroduplicate_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        counters: {},
        card: {
          id: 'electroduplicate_target_card_1',
          name: 'Goblin Heelcutter',
          type_line: 'Creature - Goblin Berserker',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, electroduplicateGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: electroduplicateGameId,
      cardId: 'electroduplicate_1',
      abilityId: 'flashback',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(electroduplicateGameId, playerId)
      .find((step: any) => (step as any)?.graveyardSpellCastTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['electroduplicate_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: electroduplicateGameId,
      stepId: String(targetStep.id),
      selections: ['electroduplicate_target_1'],
    });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    const tokenPerm = battlefield.find((perm: any) => String(perm?.id || '') !== 'electroduplicate_target_1');
    expect(tokenPerm?.isToken).toBe(true);
    expect(String(tokenPerm?.card?.name || '')).toBe('Goblin Heelcutter');
    expect((tokenPerm?.grantedAbilities || []).map((ability: any) => String(ability))).toEqual(expect.arrayContaining([
      'Haste',
      'At the beginning of the end step, sacrifice this token.',
    ]));
    expect((game.state as any).pendingSacrificeAtNextEndStep || []).toEqual(expect.arrayContaining([
      expect.objectContaining({ permanentId: String(tokenPerm?.id || '') }),
    ]));
    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('electroduplicate_1');
  });

  it('replay resolveTopOfStack restores Electroduplicate token-copy rider state', async () => {
    const replayGameId = `${gameId}_electroduplicate_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'electroduplicate_replay_1',
      'Create a token that\'s a copy of target creature you control, except it has haste and "At the beginning of the end step, sacrifice this token."\nFlashback {2}{R}{R}',
      {
        manaCost: '{2}{R}',
        manaPool: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 2 },
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Electroduplicate';
    (game.state as any).battlefield = [
      {
        id: 'electroduplicate_replay_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        counters: {},
        card: {
          id: 'electroduplicate_replay_target_card_1',
          name: 'Goblin Heelcutter',
          type_line: 'Creature - Goblin Berserker',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'electroduplicate_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_electroduplicate_replay_1',
      manaCost: '{2}{R}{R}',
      targets: ['electroduplicate_replay_target_1'],
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    const tokenPerm = battlefield.find((perm: any) => String(perm?.id || '') !== 'electroduplicate_replay_target_1');
    expect(tokenPerm?.isToken).toBe(true);
    expect((tokenPerm?.grantedAbilities || []).map((ability: any) => String(ability))).toEqual(expect.arrayContaining([
      'Haste',
      'At the beginning of the end step, sacrifice this token.',
    ]));
    expect((game.state as any).pendingSacrificeAtNextEndStep || []).toEqual(expect.arrayContaining([
      expect.objectContaining({ permanentId: String(tokenPerm?.id || '') }),
    ]));
    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('electroduplicate_replay_1');
  });

  it('live flashback Echo of Eons shuffles each player hand and graveyard into library, then draws seven', async () => {
    const echoGameId = `${gameId}_echo_of_eons_live`;
    const { game, playerId } = await seedGame(
      echoGameId,
      'echo_of_eons_1',
      'Each player shuffles their hand and graveyard into their library, then draws seven cards.\nFlashback {2}{U}',
      {
        manaCost: '{4}{U}{U}',
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
        hand: [
          { id: 'echo_hand_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1, then draw a card.', zone: 'hand' },
          { id: 'echo_hand_2', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.', zone: 'hand' },
        ],
        extraGraveyard: [
          { id: 'echo_gy_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '' },
          { id: 'echo_gy_2', name: 'Consider', type_line: 'Instant', oracle_text: 'Surveil 1, then draw a card.' },
        ],
      },
    );
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).zones[playerId].graveyard[0].name = 'Echo of Eons';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    (game.state as any).zones[playerId].library = Array.from({ length: 10 }, (_value, index) => ({
      id: `echo_p1_lib_${index + 1}`,
      name: `P1 Library ${index + 1}`,
      type_line: 'Sorcery',
      oracle_text: '',
      zone: 'library',
    }));
    (game.state as any).zones[playerId].libraryCount = 10;
    (game as any).libraries.set(playerId, [...(game.state as any).zones[playerId].library]);
    (game.state as any).zones.p2 = {
      hand: [
        { id: 'echo_p2_hand_1', name: 'Brainstorm', type_line: 'Instant', oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.', zone: 'hand' },
      ],
      handCount: 1,
      library: Array.from({ length: 9 }, (_value, index) => ({
        id: `echo_p2_lib_${index + 1}`,
        name: `P2 Library ${index + 1}`,
        type_line: 'Sorcery',
        oracle_text: '',
        zone: 'library',
      })),
      libraryCount: 9,
      graveyard: [
        { id: 'echo_p2_gy_1', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'graveyard' },
        { id: 'echo_p2_gy_2', name: 'Faithless Looting', type_line: 'Sorcery', oracle_text: 'Draw two cards, then discard two cards.', zone: 'graveyard' },
      ],
      graveyardCount: 2,
      exile: [],
      exileCount: 0,
    };
    (game.state as any).manaPool.p2 = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    (game as any).libraries.set('p2', [...(game.state as any).zones.p2.library]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, echoGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: echoGameId,
      cardId: 'echo_of_eons_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    const p1Zones = (game.state as any).zones?.[playerId];
    const p2Zones = (game.state as any).zones?.p2;
    expect((p1Zones?.hand || [])).toHaveLength(7);
    expect((p1Zones?.graveyard || [])).toEqual([]);
    expect((p1Zones?.exile || []).map((card: any) => card.id)).toContain('echo_of_eons_1');
    expect(Number(p1Zones?.libraryCount || 0)).toBe(7);
    expect((((game as any).libraries.get(playerId) || []) as any[])).toHaveLength(7);

    expect((p2Zones?.hand || [])).toHaveLength(7);
    expect((p2Zones?.graveyard || [])).toEqual([]);
    expect(Number(p2Zones?.libraryCount || 0)).toBe(5);
    expect((((game as any).libraries.get('p2') || []) as any[])).toHaveLength(5);
  });

  it('replay resolveTopOfStack restores Echo of Eons wheel results for each player', async () => {
    const replayGameId = `${gameId}_echo_of_eons_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'echo_of_eons_replay_1',
      'Each player shuffles their hand and graveyard into their library, then draws seven cards.\nFlashback {2}{U}',
      {
        manaCost: '{4}{U}{U}',
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
        hand: [
          { id: 'echo_replay_hand_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1, then draw a card.', zone: 'hand' },
          { id: 'echo_replay_hand_2', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.', zone: 'hand' },
        ],
        extraGraveyard: [
          { id: 'echo_replay_gy_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '' },
          { id: 'echo_replay_gy_2', name: 'Consider', type_line: 'Instant', oracle_text: 'Surveil 1, then draw a card.' },
        ],
      },
    );
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).zones[playerId].graveyard[0].name = 'Echo of Eons';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Sorcery';
    (game.state as any).zones[playerId].library = Array.from({ length: 10 }, (_value, index) => ({
      id: `echo_replay_p1_lib_${index + 1}`,
      name: `Replay P1 Library ${index + 1}`,
      type_line: 'Sorcery',
      oracle_text: '',
      zone: 'library',
    }));
    (game.state as any).zones[playerId].libraryCount = 10;
    (game as any).libraries.set(playerId, [...(game.state as any).zones[playerId].library]);
    (game.state as any).zones.p2 = {
      hand: [
        { id: 'echo_replay_p2_hand_1', name: 'Brainstorm', type_line: 'Instant', oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.', zone: 'hand' },
      ],
      handCount: 1,
      library: Array.from({ length: 9 }, (_value, index) => ({
        id: `echo_replay_p2_lib_${index + 1}`,
        name: `Replay P2 Library ${index + 1}`,
        type_line: 'Sorcery',
        oracle_text: '',
        zone: 'library',
      })),
      libraryCount: 9,
      graveyard: [
        { id: 'echo_replay_p2_gy_1', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'graveyard' },
        { id: 'echo_replay_p2_gy_2', name: 'Faithless Looting', type_line: 'Sorcery', oracle_text: 'Draw two cards, then discard two cards.', zone: 'graveyard' },
      ],
      graveyardCount: 2,
      exile: [],
      exileCount: 0,
    };
    (game.state as any).manaPool.p2 = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    (game as any).libraries.set('p2', [...(game.state as any).zones.p2.library]);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'echo_of_eons_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_echo_of_eons_replay_1',
      manaCost: '{2}{U}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const p1Zones = (game.state as any).zones?.[playerId];
    const p2Zones = (game.state as any).zones?.p2;
    expect((p1Zones?.hand || [])).toHaveLength(7);
    expect((p1Zones?.graveyard || [])).toEqual([]);
    expect((p1Zones?.exile || []).map((card: any) => card.id)).toContain('echo_of_eons_replay_1');
    expect(Number(p1Zones?.libraryCount || 0)).toBe(7);
    expect((((game as any).libraries.get(playerId) || []) as any[])).toHaveLength(7);

    expect((p2Zones?.hand || [])).toHaveLength(7);
    expect((p2Zones?.graveyard || [])).toEqual([]);
    expect(Number(p2Zones?.libraryCount || 0)).toBe(5);
    expect((((game as any).libraries.get('p2') || []) as any[])).toHaveLength(5);
  });

  it('live flashback Galvanic Iteration copies the next instant or sorcery spell this turn', async () => {
    const galvanicGameId = `${gameId}_galvanic_iteration_live`;
    const { game, playerId } = await seedGame(
      galvanicGameId,
      'galvanic_iteration_1',
      'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\nFlashback {1}{U}{R}',
      {
        manaCost: '{U}{R}',
        manaPool: { white: 0, blue: 1, black: 0, red: 1, green: 0, colorless: 1 },
        hand: [
          {
            id: 'galvanic_followup_1',
            name: 'Galvanic Follow-Up',
            mana_cost: '',
            manaCost: '{0}',
            type_line: 'Instant',
            oracle_text: 'Draw a card.',
            zone: 'hand',
          },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Galvanic Iteration';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    (game.state as any).phase = 'main1';
    (game.state as any).step = 'MAIN1';
    (game.state as any).priority = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).zones[playerId].library = [
      { id: 'galvanic_draw_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '', zone: 'library' },
      { id: 'galvanic_draw_2', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'library' },
    ];
    (game.state as any).zones[playerId].libraryCount = 2;
    (game as any).libraries.set(playerId, [...(game.state as any).zones[playerId].library]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, galvanicGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: galvanicGameId,
      cardId: 'galvanic_iteration_1',
      abilityId: 'flashback',
    });

    game.resolveTopOfStack();

    expect(Array.isArray((game.state as any).delayedSpellCopiesThisTurn)).toBe(true);
    expect((game.state as any).delayedSpellCopiesThisTurn || []).toEqual(expect.arrayContaining([
      expect.objectContaining({ controllerId: playerId, sourceName: 'Galvanic Iteration' }),
    ]));

    await handlers['castSpellFromHand']({
      gameId: galvanicGameId,
      cardId: 'galvanic_followup_1',
      targets: [],
    });

    expect((game.state as any).delayedSpellCopiesThisTurn || []).toEqual([]);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);
    const originalSpell = stack.find((item: any) => !item?.copiedFromStackItemId);
    const copiedSpell = stack.find((item: any) => item?.copiedFromStackItemId);
    expect(originalSpell?.card?.id).toBe('galvanic_followup_1');
    expect(copiedSpell?.copiedFromStackItemId).toBe(originalSpell?.id);

    game.resolveTopOfStack();
    game.resolveTopOfStack();

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['galvanic_draw_1', 'galvanic_draw_2']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('galvanic_iteration_1');
    expect((game.state as any).delayedSpellCopiesThisTurn || []).toEqual([]);
  });

  it('replay resolves Galvanic Iteration delayed copy on the next instant or sorcery spell', async () => {
    const replayGameId = `${gameId}_galvanic_iteration_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'galvanic_iteration_replay_1',
      'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\nFlashback {1}{U}{R}',
      {
        manaCost: '{U}{R}',
        manaPool: { white: 0, blue: 1, black: 0, red: 1, green: 0, colorless: 1 },
        hand: [
          {
            id: 'galvanic_followup_replay_1',
            name: 'Galvanic Follow-Up',
            mana_cost: '',
            manaCost: '{0}',
            type_line: 'Instant',
            oracle_text: 'Draw a card.',
            zone: 'hand',
          },
        ],
      },
    );
    (game.state as any).zones[playerId].graveyard[0].name = 'Galvanic Iteration';
    (game.state as any).zones[playerId].graveyard[0].type_line = 'Instant';
    (game.state as any).zones[playerId].library = [
      { id: 'galvanic_replay_draw_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '', zone: 'library' },
      { id: 'galvanic_replay_draw_2', name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '', zone: 'library' },
    ];
    (game.state as any).zones[playerId].libraryCount = 2;
    (game as any).libraries.set(playerId, [...(game.state as any).zones[playerId].library]);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'galvanic_iteration_replay_1',
      abilityId: 'flashback',
      stackId: 'stack_galvanic_iteration_replay_1',
      manaCost: '{1}{U}{R}',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect((game.state as any).delayedSpellCopiesThisTurn || []).toEqual(expect.arrayContaining([
      expect.objectContaining({ controllerId: playerId, sourceName: 'Galvanic Iteration' }),
    ]));

    game.applyEvent({
      type: 'castSpell',
      playerId,
      fromZone: 'hand',
      stackItemId: 'stack_galvanic_followup_replay_1',
      card: {
        id: 'galvanic_followup_replay_1',
        name: 'Galvanic Follow-Up',
        mana_cost: '',
        manaCost: '{0}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
        zone: 'hand',
      },
      targets: [],
    } as any);

    game.applyEvent({
      type: 'copyTriggeredSpellResolve',
      sourceName: 'Galvanic Iteration',
      controllerId: playerId,
      triggeringStackItemId: 'stack_galvanic_followup_replay_1',
      copiedStackItemId: 'copied_galvanic_followup_replay_1',
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);
    const copiedSpell = stack.find((item: any) => String(item?.id || '') === 'copied_galvanic_followup_replay_1');
    expect(copiedSpell?.copiedFromStackItemId).toBe('stack_galvanic_followup_replay_1');

    game.applyEvent({ type: 'resolveTopOfStack' } as any);
    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['galvanic_replay_draw_1', 'galvanic_replay_draw_2']);
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('galvanic_iteration_replay_1');
    expect((game.state as any).delayedSpellCopiesThisTurn || []).toEqual([]);
  });

  for (const abilityId of ['flashback', 'retrace', 'escape']) {
    it(`replays ${abilityId} as a cast-from-graveyard stack item`, async () => {
      const replayGameId = `${gameId}_${abilityId}`;
      const oracleText = abilityId === 'flashback'
        ? 'Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.'
        : abilityId === 'escape'
          ? 'Escape {2}{G}, Exile three other cards from your graveyard.'
          : `${abilityId} sample text`;
      const { game, playerId } = await seedGame(replayGameId, `${abilityId}_1`, oracleText, {
        manaCost: abilityId === 'retrace' ? '{2}{B}' : undefined,
        manaPool: abilityId === 'flashback'
          ? { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 }
          : abilityId === 'escape'
            ? { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 }
            : { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 2 },
        life: abilityId === 'flashback' ? 20 : 40,
      });

      game.applyEvent({
        type: 'activateGraveyardAbility',
        playerId,
        cardId: `${abilityId}_1`,
        abilityId,
        ...(abilityId === 'flashback' ? { manaCost: '{1}{U}', lifePaidForCost: 3 } : {}),
        ...(abilityId === 'escape' ? { manaCost: '{2}{G}' } : {}),
        ...(abilityId === 'retrace' ? { manaCost: '{2}{B}' } : {}),
      });

      const zones = (game.state as any).zones?.[playerId];
      expect(zones?.graveyardCount).toBe(0);
      const stack = (game.state as any).stack || [];
      expect(stack).toHaveLength(1);
      expect(stack[0]?.card?.id).toBe(`${abilityId}_1`);
      expect(stack[0]?.card?.castWithAbility).toBe(abilityId);
      expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
      expect((game.state as any).noncreatureSpellsCastThisTurn?.[playerId]).toBe(1);
      if (abilityId === 'flashback') {
        expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
        expect((game.state as any).life?.[playerId]).toBe(17);
      }
    });
  }

  it('replays escape creature casts with escape entry counters on the stack item', async () => {
    const replayGameId = `${gameId}_woe_strider_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'woe_strider_replay_1',
      'When this creature enters, create a 0/1 white Goat creature token.\nSacrifice another creature: Scry 1.\nEscape—{3}{B}{B}, Exile four other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)\nThis creature escapes with two +1/+1 counters on it.',
      {
        manaCost: '{2}{B}',
        manaPool: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 3 },
        extraGraveyard: [
          { id: 'woe_replay_cost_1', name: 'Cost One', type_line: 'Instant', oracle_text: '' },
          { id: 'woe_replay_cost_2', name: 'Cost Two', type_line: 'Sorcery', oracle_text: '' },
          { id: 'woe_replay_cost_3', name: 'Cost Three', type_line: 'Creature - Human', oracle_text: '' },
          { id: 'woe_replay_cost_4', name: 'Cost Four', type_line: 'Enchantment', oracle_text: '' },
        ],
      },
    );
    Object.assign((game.state as any).zones?.[playerId]?.graveyard?.[0] || {}, {
      name: 'Woe Strider',
      type_line: 'Creature — Horror',
      power: '3',
      toughness: '2',
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'woe_strider_replay_1',
      abilityId: 'escape',
      manaCost: '{3}{B}{B}',
      exiledCardIdsFromGraveyardForCost: ['woe_replay_cost_1', 'woe_replay_cost_2', 'woe_replay_cost_3', 'woe_replay_cost_4'],
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.castWithAbility).toBe('escape');
    expect(stack[0]?.card?.entersBattlefieldWithCounters).toEqual({ '+1/+1': 2 });

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const woeStrider = battlefield.find((permanent: any) => permanent?.card?.name === 'Woe Strider');
    expect(woeStrider?.counters?.['+1/+1']).toBe(2);
  });

  it('replays escaped Uro with the escape marker preserved on the battlefield permanent', async () => {
    const replayGameId = `${gameId}_uro_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'uro_replay_1',
      "When Uro enters, sacrifice it unless it escaped.\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)",
      {
        manaCost: '{1}{G}{U}',
        manaPool: { white: 0, blue: 2, black: 0, red: 0, green: 2, colorless: 0 },
        extraGraveyard: [
          { id: 'uro_replay_cost_1', name: 'Cost One', type_line: 'Instant', oracle_text: '' },
          { id: 'uro_replay_cost_2', name: 'Cost Two', type_line: 'Sorcery', oracle_text: '' },
          { id: 'uro_replay_cost_3', name: 'Cost Three', type_line: 'Creature - Human', oracle_text: '' },
          { id: 'uro_replay_cost_4', name: 'Cost Four', type_line: 'Enchantment', oracle_text: '' },
          { id: 'uro_replay_cost_5', name: 'Cost Five', type_line: 'Artifact', oracle_text: '' },
        ],
      },
    );
    Object.assign((game.state as any).zones?.[playerId]?.graveyard?.[0] || {}, {
      name: "Uro, Titan of Nature's Wrath",
      type_line: 'Legendary Creature — Elder Giant',
      power: '6',
      toughness: '6',
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'uro_replay_1',
      abilityId: 'escape',
      manaCost: '{G}{G}{U}{U}',
      exiledCardIdsFromGraveyardForCost: ['uro_replay_cost_1', 'uro_replay_cost_2', 'uro_replay_cost_3', 'uro_replay_cost_4', 'uro_replay_cost_5'],
    } as any);

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    const uro = battlefield.find((permanent: any) => permanent?.card?.name === "Uro, Titan of Nature's Wrath");
    expect(uro).toBeDefined();
    expect(uro?.escapedFrom).toBe('graveyard');
  });

  it('replays cast-from-graveyard abilities using the persisted live stack id when present', async () => {
    const replayGameId = `${gameId}_flashback_stack_id`;
    const { game, playerId } = await seedGame(replayGameId, 'flashback_stack_id_1', 'Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      life: 20,
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'flashback_stack_id_1',
      abilityId: 'flashback',
      stackId: 'stack_flashback_live_1',
      manaCost: '{1}{U}',
      lifePaidForCost: 3,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe('stack_flashback_live_1');
    expect(stack[0]?.card?.id).toBe('flashback_stack_id_1');
    expect(stack[0]?.card?.castWithAbility).toBe('flashback');
    expect((game.state as any).noncreatureSpellsCastThisTurn?.[playerId]).toBe(1);
  });
  
  it('replay restores persisted targets for graveyard spell casts', async () => {
    const replayGameId = `${gameId}_flashback_targets`;
    const { game, playerId } = await seedGame(replayGameId, 'flashback_targeted_1', 'Target creature gets +1/+1 until end of turn.\nFlashback {U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'flashback_targeted_1',
      abilityId: 'flashback',
      stackId: 'stack_flashback_targeted_1',
      manaCost: '{U}',
      targets: ['battlefield_target_1'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe('stack_flashback_targeted_1');
    expect(stack[0]?.card?.id).toBe('flashback_targeted_1');
    expect(stack[0]?.targets).toEqual(['battlefield_target_1']);
  });

  it('replay applies recorded jump-start discard choices before moving the spell to the stack', async () => {
    const replayGameId = `${gameId}_jump_start_replay`;
    const { game, playerId } = await seedGame(replayGameId, 'jump_start_replay_1', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      hand: [
        {
          id: 'jump_start_replay_discard_1',
          name: 'Spare Idea',
          type_line: 'Instant',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'jump_start_replay_1',
      abilityId: 'jump-start',
      manaCost: '{1}{U}',
      discardedCardIds: ['jump_start_replay_discard_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['jump_start_replay_discard_1']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('jump_start_replay_1');
    expect(stack[0]?.card?.castWithAbility).toBe('jump-start');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays queued retrace discard prompts before the discard cost is paid', async () => {
    const replayGameId = `${gameId}_retrace_prompt_replay`;
    const { game, playerId } = await seedGame(replayGameId, 'retrace_prompt_1', 'Flame Jab deals 1 damage to any target.\nRetrace', {
      hand: [
        {
          id: 'retrace_prompt_land_1',
          name: 'Mountain',
          type_line: 'Basic Land - Mountain',
          oracle_text: '',
          zone: 'hand',
        },
      ],
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'retrace_prompt_1',
      abilityId: 'retrace',
      queuedResolutionStep: {
        id: 'queued_retrace_discard_1',
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId,
        sourceId: 'retrace_prompt_1',
        sourceName: 'Grave Spell',
        description: 'Grave Spell: Discard 1 land card to cast it using retrace.',
        mandatory: false,
        hand: [
          {
            id: 'retrace_prompt_land_1',
            name: 'Mountain',
            type_line: 'Basic Land - Mountain',
            oracle_text: '',
            zone: 'hand',
          },
        ],
        discardCount: 1,
        currentHandSize: 1,
        maxHandSize: 7,
        reason: 'activation_cost',
        graveyardCastDiscardAsCost: true,
        cardId: 'retrace_prompt_1',
        abilityId: 'retrace',
        cardName: 'Grave Spell',
        discardTypeRestriction: 'land',
      },
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toContain('retrace_prompt_1');
    expect((game.state as any).stack || []).toHaveLength(0);
    const steps = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId);
    expect(steps).toHaveLength(1);
    expect(String((steps[0] as any)?.id || '')).toBe('queued_retrace_discard_1');
    expect((steps[0] as any)?.graveyardCastDiscardAsCost).toBe(true);
  });

  it('replays queued escape exile prompts before the exile cost is paid', async () => {
    const replayGameId = `${gameId}_escape_prompt_replay`;
    const { game, playerId } = await seedGame(replayGameId, 'escape_prompt_1', 'Return target creature card from your graveyard to your hand.\nEscape {2}{G}, Exile three other cards from your graveyard.', {
      extraGraveyard: [
        { id: 'escape_prompt_cost_1', name: 'Card One', type_line: 'Instant', oracle_text: '' },
        { id: 'escape_prompt_cost_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: '' },
        { id: 'escape_prompt_cost_3', name: 'Card Three', type_line: 'Creature - Human', oracle_text: '' },
      ],
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'escape_prompt_1',
      abilityId: 'escape',
      queuedResolutionStep: {
        id: 'queued_escape_exile_1',
        type: ResolutionStepType.GRAVEYARD_SELECTION,
        playerId,
        sourceId: 'escape_prompt_1',
        sourceName: 'Grave Spell',
        description: 'Grave Spell: Exile 3 other cards from your graveyard to cast it using escape.',
        mandatory: false,
        targetPlayerId: playerId,
        minTargets: 3,
        maxTargets: 3,
        destination: 'exile',
        cardId: 'escape_prompt_1',
        cardName: 'Grave Spell',
        title: 'Exile 3 other cards for Grave Spell',
        validTargets: [
          { id: 'escape_prompt_cost_1', label: 'Card One', description: 'Instant', imageUrl: undefined },
          { id: 'escape_prompt_cost_2', label: 'Card Two', description: 'Sorcery', imageUrl: undefined },
          { id: 'escape_prompt_cost_3', label: 'Card Three', description: 'Creature - Human', imageUrl: undefined },
        ],
        graveyardCastExileAsCost: true,
        abilityId: 'escape',
        manaCost: '{2}{G}',
      },
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id).sort()).toEqual(['escape_prompt_1', 'escape_prompt_cost_1', 'escape_prompt_cost_2', 'escape_prompt_cost_3']);
    expect((zones?.exile || []).map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).stack || []).toHaveLength(0);
    const steps = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId);
    expect(steps).toHaveLength(1);
    expect(String((steps[0] as any)?.id || '')).toBe('queued_escape_exile_1');
    expect((steps[0] as any)?.graveyardCastExileAsCost).toBe(true);
  });

  it('replays queued Dread Return sacrifice prompts before the sacrifice cost is paid', async () => {
    const replayGameId = `${gameId}_dread_return_prompt_replay`;
    const { game, playerId } = await seedGame(
      replayGameId,
      'dread_return_prompt_1',
      'Return target creature card from your graveyard to the battlefield.\nFlashback-Sacrifice three creatures.',
      {
        extraGraveyard: [
          { id: 'dread_return_prompt_target_1', name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
        ],
      },
    );
    (game.state as any).battlefield = [
      {
        id: 'dread_return_prompt_sac_1',
        controller: playerId,
        owner: playerId,
        card: { id: 'dread_return_prompt_sac_1', name: 'Sacrifice One', type_line: 'Creature - Zombie', oracle_text: '' },
      },
      {
        id: 'dread_return_prompt_sac_2',
        controller: playerId,
        owner: playerId,
        card: { id: 'dread_return_prompt_sac_2', name: 'Sacrifice Two', type_line: 'Creature - Skeleton', oracle_text: '' },
      },
      {
        id: 'dread_return_prompt_sac_3',
        controller: playerId,
        owner: playerId,
        card: { id: 'dread_return_prompt_sac_3', name: 'Sacrifice Three', type_line: 'Creature - Spirit', oracle_text: '' },
      },
    ];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'dread_return_prompt_1',
      abilityId: 'flashback',
      queuedResolutionStep: {
        id: 'queued_dread_return_sacrifice_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        sourceId: 'dread_return_prompt_1',
        sourceName: 'Grave Spell',
        description: 'Grave Spell: Sacrifice 3 creatures to cast it using flashback.',
        mandatory: false,
        validTargets: [
          { id: 'dread_return_prompt_sac_1', label: 'Sacrifice One', description: 'Creature - Zombie', imageUrl: undefined },
          { id: 'dread_return_prompt_sac_2', label: 'Sacrifice Two', description: 'Creature - Skeleton', imageUrl: undefined },
          { id: 'dread_return_prompt_sac_3', label: 'Sacrifice Three', description: 'Creature - Spirit', imageUrl: undefined },
        ],
        targetTypes: ['sacrifice_cost'],
        minTargets: 3,
        maxTargets: 3,
        targetDescription: 'creatures you control',
        sacrificeSelection: true,
        sacrificeSourceName: 'Grave Spell',
        sacrificePermanentType: 'creature',
        sacrificeReason: 'Cast Grave Spell using flashback',
        graveyardCastSacrificeAsCost: true,
        cardId: 'dread_return_prompt_1',
        abilityId: 'flashback',
        cardName: 'Grave Spell',
        sacrificeType: 'creature',
        sacrificeCount: 3,
      },
    } as any);

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id).sort()).toEqual(['dread_return_prompt_1', 'dread_return_prompt_target_1']);
    expect((game.state as any).stack || []).toHaveLength(0);
    const steps = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId);
    expect(steps).toHaveLength(1);
    expect(String((steps[0] as any)?.id || '')).toBe('queued_dread_return_sacrifice_1');
    expect((steps[0] as any)?.graveyardCastSacrificeAsCost).toBe(true);
  });

  it('replay applies recorded escape exile choices before moving the spell to the stack', async () => {
    const replayGameId = `${gameId}_escape_replay`;
    const { game, playerId } = await seedGame(replayGameId, 'escape_replay_1', 'Return target creature card from your graveyard to your hand.\nEscape {2}{G}, Exile three other cards from your graveyard.', {
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      extraGraveyard: [
        { id: 'escape_replay_cost_1', name: 'Card One', type_line: 'Instant', oracle_text: '' },
        { id: 'escape_replay_cost_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: '' },
        { id: 'escape_replay_cost_3', name: 'Card Three', type_line: 'Creature - Human', oracle_text: '' },
      ],
    });

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'escape_replay_1',
      abilityId: 'escape',
      manaCost: '{2}{G}',
      exiledCardIdsFromGraveyardForCost: ['escape_replay_cost_1', 'escape_replay_cost_2', 'escape_replay_cost_3'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.exile || []).map((card: any) => card.id).sort()).toEqual(['escape_replay_cost_1', 'escape_replay_cost_2', 'escape_replay_cost_3']);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('escape_replay_1');
    expect(stack[0]?.card?.castWithAbility).toBe('escape');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });
});