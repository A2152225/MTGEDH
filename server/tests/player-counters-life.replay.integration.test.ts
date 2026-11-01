import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';

/**
 * Reload replays saved events and never re-runs card effects, so every player-level
 * change an effect makes (life, poison, energy) must be saved as its own event.
 * Commander damage is the exception: combat re-runs on replay via nextStep.
 */

const WARSTORM = 'Whenever a creature you control enters, it deals damage equal to its power to any target.';
const usedGameIds = new Set<string>();

function emptyZones() {
  const zone = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 });
  return { p1: zone(), p2: zone() };
}

function setupLiveGame(gameId: string, battlefield: any[] = []) {
  usedGameIds.add(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  const state = game.state as any;
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  state.life = { p1: 40, p2: 40 };
  state.startingLife = 40;
  state.turnPlayer = 'p1';
  state.priority = 'p1';
  state.activePlayer = 'p1';
  state.stack = [];
  state.battlefield = battlefield;
  state.zones = emptyZones();
  return game;
}

function replaySaved(liveGame: any, gameId: string, fromIndex: number) {
  const saved = getEvents(gameId).slice(fromIndex);
  const replayGame = createInitialGameState(`${gameId}_replay`);
  const rs = replayGame.state as any;
  rs.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  rs.life = { p1: 40, p2: 40 };
  rs.startingLife = 40;
  rs.turnPlayer = 'p1';
  rs.priority = 'p1';
  rs.stack = [];
  rs.zones = emptyZones();
  rs.battlefield = JSON.parse(JSON.stringify((liveGame.state as any).battlefield || []));
  replayGame.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);
  return { replayState: rs, saved };
}

function playerTotals(state: any) {
  return {
    life: { p1: state.life?.p1, p2: state.life?.p2 },
    poison: { p1: Number(state.poisonCounters?.p1 || 0), p2: Number(state.poisonCounters?.p2 || 0) },
    energy: { p1: Number(state.energy?.p1 || 0), p2: Number(state.energy?.p2 || 0) },
  };
}

describe('player life and counters survive reload', () => {
  const savedTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {} } as any);
  });

  afterEach(async () => {
    if (savedTriggerPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = savedTriggerPrimary;
    for (const id of usedGameIds) {
      ResolutionQueueManager.removeQueue(id);
      games.delete(id as any);
      await deleteGame(id);
    }
    usedGameIds.clear();
  });

  it('saves poison from infect damage dealt by a triggered ability', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'replay_player_counters_infect';
    await deleteGame(gameId);
    const game = setupLiveGame(gameId, [
      { id: 'surge', controller: 'p1', owner: 'p1', card: { name: 'Warstorm Surge', type_line: 'Enchantment', oracle_text: WARSTORM } },
    ]);
    const start = getEvents(gameId).length;
    const rat = {
      id: 'rat', controller: 'p1', owner: 'p1', counters: {}, summoningSickness: true,
      card: { name: 'Plague Rat', type_line: 'Creature — Phyrexian Rat', power: '3', toughness: '3', oracle_text: 'Infect', keywords: ['Infect'] },
    };
    (game.state as any).battlefield.push(rat);
    triggerETBEffectsForPermanent(game, rat, 'p1' as any);

    const handlers: Record<string, Function> = {};
    const socket = { data: { playerId: 'p1', spectator: false, gameId }, rooms: new Set([gameId]), on: (e: string, fn: Function) => { handlers[e] = fn; }, emit: () => {} } as any;
    registerResolutionHandlers({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s', socket]]) } } as any, socket);
    game.resolveTopOfStack();
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[])[0];
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['p2'] });

    expect(playerTotals(game.state).poison.p2).toBe(3);
    expect(playerTotals(game.state).life.p2).toBe(40);
    const { replayState } = replaySaved(game, gameId, start);
    expect(playerTotals(replayState)).toEqual(playerTotals(game.state));
  });

  it('saves energy from an enters trigger', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 'replay_player_counters_energy';
    await deleteGame(gameId);
    const game = setupLiveGame(gameId);
    const start = getEvents(gameId).length;
    const creature = {
      id: 'eng', controller: 'p1', owner: 'p1', counters: {}, summoningSickness: true,
      card: { name: 'Energy Probe', type_line: 'Creature — Construct', power: '1', toughness: '1', oracle_text: 'When this creature enters, you get {E}{E}.' },
    };
    (game.state as any).battlefield.push(creature);
    triggerETBEffectsForPermanent(game, creature, 'p1' as any);
    game.resolveTopOfStack();

    expect(playerTotals(game.state).energy.p1).toBe(2);
    const { replayState, saved } = replaySaved(game, gameId, start);
    expect(saved.some((event: any) => event.type === 'adjustPlayerCounters')).toBe(true);
    expect(playerTotals(replayState)).toEqual(playerTotals(game.state));
  });

  it('saves damage, poison and energy from an Effect Program that resumes after a choice, without doubling', async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    const gameId = 'replay_player_counters_effect_program';
    usedGameIds.add(gameId);
    ResolutionQueueManager.removeQueue(gameId);
    await deleteGame(gameId);
    const game = createInitialGameState(gameId);
    game.applyEvent!({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    (game.state as any).zones = emptyZones();
    (game as any).gameId = gameId;
    const start = getEvents(gameId).length;

    const outcome = tryResolveTriggerViaOracleIR(game as any, {
      controller: 'p1' as any,
      sourceName: 'Spark Trigger',
      effectText: 'Choose target opponent. Spark Trigger deals 3 damage to that player. That player gets two poison counters. You get {E}{E}.',
      triggerItem: { id: 'spark-1', controller: 'p1' },
    });
    expect(outcome.handled).toBe(true);
    const step = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1')[0];
    expect((step as any)?.effectProgramPrompt).toBe(true);
    const completed = ResolutionQueueManager.completeStep(gameId, String(step.id), {
      stepId: String(step.id), playerId: 'p1', selections: ['p2'], cancelled: false, timestamp: Date.now(),
    } as any);
    const resumed = resumeEffectProgramResolution({ game, gameId, step: completed!, response: completed!.response!, persistPrompt: true });
    expect(resumed.status).toBe('completed');

    const live = playerTotals(game.state);
    expect(live.life.p2).toBe(37);
    expect(live.poison.p2).toBe(2);
    expect(live.energy.p1).toBe(2);

    const saved = getEvents(gameId).slice(start).map((event: any) => ({ type: event.type, ...(event.payload || {}) }));
    const replayGame = createInitialGameState(`${gameId}_replay`);
    replayGame.applyEvent!({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    replayGame.applyEvent!({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    replayGame.replay!(saved as any);
    expect(playerTotals(replayGame.state)).toEqual(live);
  });

  it('rebuilds commander combat damage by replaying combat', () => {
    const seed = (g: any) => {
      const s = g.state as any;
      s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
      s.life = { p1: 40, p2: 40 };
      s.turnPlayer = 'p1'; s.activePlayer = 'p1'; s.priority = 'p1';
      s.phase = 'combat'; s.step = 'DECLARE_BLOCKERS';
      s.commandZone = { p1: { commanderIds: ['cmd_card'], inCommandZone: [] } };
      s.stack = [];
      s.zones = emptyZones();
      s.battlefield = [{
        id: 'cmd', controller: 'p1', owner: 'p1', isCommander: true, attacking: 'p2', tapped: true, counters: {},
        card: { id: 'cmd_card', name: 'Cmdr', type_line: 'Legendary Creature — Human', power: '7', toughness: '7', oracle_text: '' },
      }];
    };
    const live = createInitialGameState('replay_commander_damage_live');
    seed(live);
    live.applyEvent!({ type: 'nextStep' } as any);
    const replayed = createInitialGameState('replay_commander_damage_replay');
    seed(replayed);
    replayed.replay!([{ type: 'nextStep' }] as any);

    expect((live.state as any).commanderDamage).toEqual({ p2: { cmd_card: 7 } });
    expect((replayed.state as any).commanderDamage).toEqual((live.state as any).commanderDamage);
    expect((replayed.state as any).life.p2).toBe(33);
  });
});
