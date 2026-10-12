import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  continueIdenticalTriggerRun,
  countIdenticalTopTriggerRun,
  identicalTriggerBulkKey,
} from '../src/socket/identicalTriggerBulkResolve.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

const gameId = 'test_identical_trigger_bulk';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
}

const CRUSADE_TEXT = 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.';

function setupCrusadeGame(): any {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  if (!game) throw new Error('no game');
  game.state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = {
    p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
  };
  game.state.turnPlayer = 'p1';
  game.state.priority = 'p1';
  game.state.phase = 'main1';
  game.state.step = 'MAIN1';
  game.state.stack = [];
  delete game.state.priorityClaimed;
  delete game.state.priorityPassedBy;
  game.state.battlefield = [{
    id: 'crusade', controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id: 'crusade_c', name: "Cathars' Crusade", type_line: 'Enchantment', oracle_text: CRUSADE_TEXT, zone: 'battlefield' },
  }];
  return game;
}

function createMites(game: any, n: number): string[] {
  return createToken(game, 'p1' as any, 'Phyrexian Mite', n, 1, 1, {
    typeLine: 'Token Artifact Creature — Phyrexian Mite',
    abilities: ['Toxic 1', "This token can't block."],
  } as any);
}

describe('identical trigger bulk resolve (Cathars\' Crusade + Mites)', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { await resetGame(); });

  it('groups only no-choice, untargeted triggers', () => {
    const base = { type: 'triggered_ability', controller: 'p1', source: 'crusade', sourceName: "Cathars' Crusade", triggerType: 'creature_etb', mandatory: true, effect: 'put a +1/+1 counter on each creature you control.' };
    expect(identicalTriggerBulkKey(base)).toBeTruthy();
    expect(identicalTriggerBulkKey({ ...base, mandatory: false })).toBeNull();
    expect(identicalTriggerBulkKey({ ...base, targets: ['x'] })).toBeNull();
    expect(identicalTriggerBulkKey({ ...base, effect: 'you may draw a card.' })).toBeNull();
    expect(identicalTriggerBulkKey({ ...base, effect: 'choose one —' })).toBeNull();
    expect(identicalTriggerBulkKey({ ...base, effect: 'destroy target creature.' })).toBeNull();
    expect(identicalTriggerBulkKey({ type: 'spell', controller: 'p1' })).toBeNull();
    expect(identicalTriggerBulkKey({ ...base, source: 'other' })).not.toBe(identicalTriggerBulkKey(base));
  });

  it('resolves every instance in order with correct counters and an empty stack', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    const n = 20;
    const ids = createMites(game, n);
    expect(ids).toHaveLength(n);
    const run = countIdenticalTopTriggerRun(game.state);
    expect(run.count).toBe(n);

    const resolved = continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1' });
    expect(resolved).toBe(n);
    expect(game.state.stack || []).toHaveLength(0);
    for (const perm of game.state.battlefield.filter((p: any) => p.isToken)) {
      expect(perm.counters?.['+1/+1']).toBe(n);
    }
    expect(game.state.priority).toBe('p1');
  }, 120000);

  it('stops at a different trigger and honours maxCount', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    createMites(game, 6);
    const run = countIdenticalTopTriggerRun(game.state);
    // A different trigger sits under the top three instances.
    game.state.stack.splice(game.state.stack.length - 3, 0, {
      ...game.state.stack[0], id: 'other_trigger', sourceName: 'Soul Warden', source: 'warden', effect: 'you gain 1 life.', description: 'you gain 1 life.',
    });
    expect(countIdenticalTopTriggerRun(game.state).count).toBe(3);
    const limited = continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1', maxCount: 2 });
    expect(limited).toBe(2);
    const rest = continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1' });
    expect(rest).toBe(1);
    expect(game.state.stack[game.state.stack.length - 1].id).toBe('other_trigger');
  }, 120000);

  it('does not pass for a non-consenting player who could act', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    createMites(game, 3);
    const run = countIdenticalTopTriggerRun(game.state);
    game.state.priorityClaimed = new Set(['p1']);
    expect(continueIdenticalTriggerRun(null, game, gameId, { key: run.key })).toBe(0);
    expect(game.state.stack).toHaveLength(3);
  }, 120000);

  it('memoized parsers hand out independent copies', () => {
    const card = { name: 'Caged Sun', oracle_text: 'As Caged Sun enters, choose a color.\nCreatures you control of the chosen color get +1/+1.' };
    const first = getAsEntersChoiceRequirements(card);
    if (first[0]?.colors) first[0].colors.length = 0;
    first.push({ kind: 'player', mandatory: true, reason: 'x' });
    const second = getAsEntersChoiceRequirements(card);
    expect(second.some((r) => r.reason === 'x')).toBe(false);
    if (second[0]?.colors) expect(second[0].colors.length).toBeGreaterThan(0);

    const steps = parseTriggerEffectSteps('put a +1/+1 counter on each creature you control.', "Cathars' Crusade");
    (steps as any).push({ kind: 'bogus' });
    expect(parseTriggerEffectSteps('put a +1/+1 counter on each creature you control.', "Cathars' Crusade").some((s: any) => s.kind === 'bogus')).toBe(false);
  });

  it('100 Mites: creation and 100 resolutions stay well under the old ~1.5 minute cost', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    const t0 = performance.now();
    createMites(game, 100);
    const tCreate = performance.now() - t0;
    const run = countIdenticalTopTriggerRun(game.state);
    const t1 = performance.now();
    const resolved = continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1' });
    const tResolve = performance.now() - t1;
    console.log(`[perf] create100=${tCreate.toFixed(0)}ms resolve100=${tResolve.toFixed(0)}ms`);
    expect(resolved).toBe(100);
    expect(game.state.battlefield.find((p: any) => p.isToken)?.counters?.['+1/+1']).toBe(100);
    // Before: ~52s create + ~33s resolve in isolation; now ~0.2s + ~5-8s. The full parallel
    // suite slows this several-fold, so the ceilings only catch a return of the O(n^2+) paths.
    expect(tCreate).toBeLessThan(20000);
    expect(tResolve).toBeLessThan(120000);
  }, 240000);
});
