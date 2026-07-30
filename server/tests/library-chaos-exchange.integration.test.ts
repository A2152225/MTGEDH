import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { handleAIResolutionStep } from '../src/socket/ai.js';

const GUFF_TEXT =
  "For each player, choose target nonenchantment, nonland permanent that player controls. Those permanents' owners shuffle them into their libraries. Each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland card, then puts the rest on the bottom of their library in a random order. Each player may cast the nonland card they exiled without paying its mana cost.";
const SWAP_TEXT =
  "The owner of target nonenchantment permanent shuffles it into their library, then exiles the top card of their library. If it's a land card, they put it onto the battlefield. Otherwise, they may cast it without paying its mana cost.";

function createNoopIo() {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: () => undefined,
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function setupGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId) as any;
  game.gameId = gameId;
  game.rng = () => 0.99;
  game.state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  game.state.turnOrder = ['p1', 'p2'];
  game.state.zones = {
    p1: { hand: [], graveyard: [], exile: [], exileCount: 0, library: [], libraryCount: 0 },
    p2: { hand: [], graveyard: [], exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  game.state.battlefield = [
    {
      id: 'p1_target',
      owner: 'p1',
      controller: 'p1',
      counters: {},
      card: { id: 'p1_target_card', name: 'P1 Rock', type_line: 'Artifact' },
    },
    {
      id: 'p2_target',
      owner: 'p2',
      controller: 'p2',
      counters: {},
      card: { id: 'p2_target_card', name: 'P2 Bear', type_line: 'Creature — Bear' },
    },
  ];
  return game;
}

describe('generic library chaos exchange', () => {
  const gameId = 'test_library_chaos_exchange';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
  });
  beforeEach(async () => resetGame(gameId));
  afterEach(async () => resetGame(gameId));

  it('resolves a single target and puts an exiled top land onto the battlefield', () => {
    const game = setupGame(gameId);
    const topLand = { id: 'top_land', name: 'Island', type_line: 'Basic Land — Island' };
    game.libraries.set('p2', [topLand]);
    game.state.zones.p2.library = [topLand];
    game.state.zones.p2.libraryCount = 1;

    const steps = parseOracleTextToIR(SWAP_TEXT, 'Single Exchange').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'swap_spell',
        sourceName: 'Single Exchange',
        chosenObjectIds: ['p2_target'],
        selectorContext: { chosenObjectIds: ['p2_target'] },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: 'p1', sourceName: 'Single Exchange', sourceId: 'swap_spell' },
    );

    expect(game.state.battlefield.some((permanent: any) => permanent.id === 'p2_target')).toBe(false);
    expect(game.state.battlefield.some((permanent: any) => permanent.card?.id === 'top_land')).toBe(true);
    expect(game.state.zones.p2.exile).toEqual([]);
  });

  it('uses the owner library after a stolen permanent is swapped', () => {
    const game = setupGame(gameId);
    // p2 controls a permanent owned by p1.
    game.state.battlefield = [{
      id: 'stolen',
      owner: 'p1',
      controller: 'p2',
      counters: {},
      card: { id: 'stolen_card', name: 'Stolen Relic', type_line: 'Artifact' },
    }];
    const ownerTop = { id: 'owner_spell', name: 'Owner Spell', type_line: 'Instant' };
    const controllerTop = { id: 'controller_spell', name: 'Controller Spell', type_line: 'Instant' };
    game.libraries.set('p1', [ownerTop]);
    game.libraries.set('p2', [controllerTop]);
    game.state.zones.p1.library = [ownerTop];
    game.state.zones.p2.library = [controllerTop];

    const steps = parseOracleTextToIR(SWAP_TEXT, 'Single Exchange').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p2',
        sourceId: 'swap_spell',
        sourceName: 'Single Exchange',
        chosenObjectIds: ['stolen'],
        selectorContext: { chosenObjectIds: ['stolen'] },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: 'p2', sourceName: 'Single Exchange', sourceId: 'swap_spell' },
    );

    expect(game.state.battlefield.some((permanent: any) => permanent.id === 'stolen')).toBe(false);
    expect(game.state.zones.p1.exile.map((card: any) => card.id)).toEqual(['owner_spell']);
    expect(game.state.zones.p2.exile).toEqual([]);
    const castPrompt = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.castFromExileCardId === 'owner_spell',
    );
    expect(castPrompt?.playerId).toBe('p1');
  });

  it('chooses one permanent per player, exiles each nonland hit, and queues free-cast prompts', async () => {
    const game = setupGame(gameId);
    const p1Library = [
      { id: 'p1_land', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'p1_spell', name: 'P1 Spell', type_line: 'Sorcery' },
    ];
    const p2Library = [
      { id: 'p2_land', name: 'Mountain', type_line: 'Basic Land — Mountain' },
      { id: 'p2_spell', name: 'P2 Spell', type_line: 'Instant' },
    ];
    game.libraries.set('p1', p1Library);
    game.libraries.set('p2', p2Library);
    game.state.zones.p1.library = p1Library;
    game.state.zones.p2.library = p2Library;

    const steps = parseOracleTextToIR(GUFF_TEXT, 'Each-Player Exchange').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'guff_spell',
        sourceName: 'Each-Player Exchange',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: 'p1', sourceName: 'Each-Player Exchange', sourceId: 'guff_spell' },
    );

    const socketHarness = createMockSocket('p1', gameId);
    registerResolutionHandlers(createNoopIo(), socketHarness.socket);
    const first = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(first.validTargets.map((target: any) => target.id)).toEqual(['p1_target']);
    await socketHarness.handlers.submitResolutionResponse({
      gameId,
      stepId: first.id,
      selections: ['p1_target'],
    });

    const second = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(second.validTargets.map((target: any) => target.id)).toEqual(['p2_target']);
    await socketHarness.handlers.submitResolutionResponse({
      gameId,
      stepId: second.id,
      selections: ['p2_target'],
    });

    expect(game.state.battlefield).toHaveLength(0);
    expect(game.state.zones.p1.exile.map((card: any) => card.id)).toEqual(['p1_spell']);
    expect(game.state.zones.p2.exile.map((card: any) => card.id)).toEqual(['p2_spell']);
    const castPrompts = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (step: any) => step.type === ResolutionStepType.OPTION_CHOICE && step.castFromExileCardId,
    );
    expect(castPrompts.map((step: any) => step.playerId)).toEqual(['p1', 'p2']);
  });

  it('consumes Guff cast-time stack targets without queueing resolution-time target prompts', () => {
    const game = setupGame(gameId);
    const p1Library = [{ id: 'p1_spell', name: 'P1 Spell', type_line: 'Sorcery' }];
    const p2Library = [{ id: 'p2_spell', name: 'P2 Spell', type_line: 'Instant' }];
    game.libraries.set('p1', p1Library);
    game.libraries.set('p2', p2Library);
    game.state.zones.p1.library = p1Library;
    game.state.zones.p2.library = p2Library;

    const steps = parseOracleTextToIR(GUFF_TEXT, 'Each-Player Exchange').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'guff_spell',
        sourceName: 'Each-Player Exchange',
        chosenObjectIds: ['p1_target', 'p2_target'],
        selectorContext: { chosenObjectIds: ['p1_target', 'p2_target'] },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      {
        controller: 'p1',
        sourceName: 'Each-Player Exchange',
        sourceId: 'guff_spell',
        sourceItem: { targets: ['p1_target', 'p2_target'] },
      },
    );

    expect(game.state.battlefield).toHaveLength(0);
    expect(game.state.zones.p1.exile.map((card: any) => card.id)).toEqual(['p1_spell']);
    expect(game.state.zones.p2.exile.map((card: any) => card.id)).toEqual(['p2_spell']);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    )).toBe(false);
  });

  it('applies the each-player exchange when the caster is AI-controlled', async () => {
    const game = setupGame(gameId);
    const p1Library = [{ id: 'p1_spell', name: 'P1 Spell', type_line: 'Sorcery' }];
    const p2Library = [{ id: 'p2_spell', name: 'P2 Spell', type_line: 'Instant' }];
    game.libraries.set('p1', p1Library);
    game.libraries.set('p2', p2Library);
    game.state.zones.p1.library = p1Library;
    game.state.zones.p2.library = p2Library;

    const steps = parseOracleTextToIR(GUFF_TEXT, 'Each-Player Exchange').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'guff_spell',
        sourceName: 'Each-Player Exchange',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: 'p1', sourceName: 'Each-Player Exchange', sourceId: 'guff_spell' },
    );

    const first = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    await handleAIResolutionStep(createNoopIo(), gameId, 'p1' as any, first);
    const second = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    await handleAIResolutionStep(createNoopIo(), gameId, 'p1' as any, second);

    expect(game.state.battlefield).toHaveLength(0);
    expect(game.state.zones.p1.exile).toHaveLength(1);
    expect(game.state.zones.p2.exile).toHaveLength(1);
  });
});
