import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { clearTemporaryGraveyardKeywordGrants } from '../src/state/modules/graveyard-permissions.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: {
      sockets: new Map(),
    },
  } as any;
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

async function seedDesdemonaGame(gameId: string) {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  const effectText = "target creature card in your graveyard that's an artifact or that has mana value 3 or less gains escape until end of turn. The escape cost is equal to its mana cost plus exile two other cards from your graveyard.";
  const desdemonaCard = {
    id: 'desdemona_card_1',
    name: "Desdemona, Freedom's Edge",
    type_line: 'Legendary Creature — Human Rogue',
    mana_cost: '{2}{R}{W}',
    manaCost: '{2}{R}{W}',
    power: '3',
    toughness: '4',
    oracle_text: "Vigilance\nWhenever Desdemona attacks, target creature card in your graveyard that's an artifact or that has mana value 3 or less gains escape until end of turn. The escape cost is equal to its mana cost plus exile two other cards from your graveyard. (You may cast it from your graveyard for its escape cost this turn.)",
  };

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnNumber = 9;
  (game.state as any).turn = 9;
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).step = 'DECLARE_ATTACKERS';
  (game.state as any).phase = 'combat';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 5 },
  };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        {
          id: 'artifact_target_1',
          name: 'Scrapwork Titan',
          type_line: 'Artifact Creature — Golem',
          mana_cost: '{5}',
          manaCost: '{5}',
          oracle_text: '',
          zone: 'graveyard',
        },
        {
          id: 'cheap_target_1',
          name: 'Quick Scout',
          type_line: 'Creature — Human Scout',
          mana_cost: '{2}{R}',
          manaCost: '{2}{R}',
          oracle_text: '',
          zone: 'graveyard',
        },
        {
          id: 'invalid_target_1',
          name: 'Hill Ogre Deluxe',
          type_line: 'Creature — Ogre',
          mana_cost: '{4}{R}',
          manaCost: '{4}{R}',
          oracle_text: '',
          zone: 'graveyard',
        },
        { id: 'filler_1', name: 'Filler One', type_line: 'Instant', mana_cost: '{U}', manaCost: '{U}', oracle_text: '', zone: 'graveyard' },
        { id: 'filler_2', name: 'Filler Two', type_line: 'Sorcery', mana_cost: '{B}', manaCost: '{B}', oracle_text: '', zone: 'graveyard' },
        { id: 'filler_3', name: 'Filler Three', type_line: 'Artifact', mana_cost: '{1}', manaCost: '{1}', oracle_text: '', zone: 'graveyard' },
      ],
      graveyardCount: 6,
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).battlefield = [
    {
      id: 'desdemona_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      attacking: true,
      card: desdemonaCard,
    },
  ];

  const metadata = inferTriggeredAbilityTargetMetadata(effectText);
  (game.state as any).stack.push({
    id: 'trigger_desdemona_attack_1',
    type: 'triggered_ability',
    controller: playerId,
    source: 'desdemona_1',
    sourceName: "Desdemona, Freedom's Edge",
    description: effectText,
    effect: effectText,
    triggerType: 'attacks',
    card: desdemonaCard,
    ...(metadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
    ...(metadata.targetType ? { targetType: metadata.targetType } : null),
    ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
    ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
    ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
    ...(Array.isArray((metadata as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (metadata as any).targetFilterRequiredTypeWords } : null),
    ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
    ...(typeof (metadata as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (metadata as any).targetFilterExactManaValue } : null),
    ...(typeof (metadata as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (metadata as any).targetFilterMinManaValue } : null),
    ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
  });

  return { game, playerId };
}

describe("Desdemona, Freedom's Edge", () => {
  const baseGameId = 'test_desdemona_freedoms_edge';
  const trackedGameIds = [
    `${baseGameId}_grant`,
    `${baseGameId}_escape`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
  });

  it('targets artifact creatures over mana value 3 and grants escape only to the chosen card', async () => {
    const gameId = `${baseGameId}_grant`;
    const { game, playerId } = await seedDesdemonaGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    game.resolveTopOfStack();

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0] as any;
    expect(targetStep?.type).toBe(ResolutionStepType.GRAVEYARD_SELECTION);
    expect((targetStep.validTargets || []).map((target: any) => String(target.id)).sort()).toEqual([
      'artifact_target_1',
      'cheap_target_1',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['artifact_target_1'],
      cancelled: false,
    });

    const candidates = getCastableSpellCandidates({ state: (game.state as any) } as any, playerId as any, { mode: 'main' });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'artifact_target_1' }),
        castMethod: 'escape',
        manaCost: '{5}',
      }),
    ]));
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'cheap_target_1')).toBe(false);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'invalid_target_1')).toBe(false);

    expect(clearTemporaryGraveyardKeywordGrants((game.state as any))).toBe(1);
    expect(
      getCastableSpellCandidates({ state: (game.state as any) } as any, playerId as any, { mode: 'main' })
        .some((candidate: any) => candidate?.card?.id === 'artifact_target_1')
    ).toBe(false);
  });

  it('casts the chosen artifact creature with escape by exiling two other cards from your graveyard', async () => {
    const gameId = `${baseGameId}_escape`;
    const { game, playerId } = await seedDesdemonaGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    game.resolveTopOfStack();

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0] as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['artifact_target_1'],
      cancelled: false,
    });

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'artifact_target_1',
      abilityId: 'escape',
    });

    const exileStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => step.type === ResolutionStepType.GRAVEYARD_SELECTION && (step as any).graveyardCastExileAsCost === true) as any;
    expect(exileStep).toBeDefined();
    expect((exileStep.validTargets || []).map((target: any) => String(target.id)).sort()).toEqual([
      'cheap_target_1',
      'filler_1',
      'filler_2',
      'filler_3',
      'invalid_target_1',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(exileStep.id),
      selections: ['filler_1', 'filler_2'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('artifact_target_1');
    expect(stack[0]?.card?.castWithAbility).toBe('escape');

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id).sort()).toEqual(['filler_1', 'filler_2']);
    expect((zones?.graveyard || []).map((card: any) => card.id).sort()).toEqual([
      'cheap_target_1',
      'filler_3',
      'invalid_target_1',
    ]);
    expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
  });
});