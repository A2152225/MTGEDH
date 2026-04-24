import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
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