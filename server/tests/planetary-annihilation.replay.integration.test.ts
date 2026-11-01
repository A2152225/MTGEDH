import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { initDb, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { handleChooseThenSacrificeRestTargetSelection } from '../src/socket/resolution-handlers/chooseThenSacrificeRestTargetSelection.js';
import { transformDbEventsForReplay } from '../src/socket/util.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const PLANETARY_ANNIHILATION =
  'Each player chooses six lands they control, then sacrifices the rest. Planetary Annihilation deals 6 damage to each creature.';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function land(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}-card`, name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.' },
  };
}

function giant(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    damageMarked: 0,
    card: { id: `${id}-card`, name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '13', oracle_text: '' },
  };
}

function seedBattlefield() {
  return [
    ...Array.from({ length: 7 }, (_, index) => land(`p1-land-${index}`, p1)),
    giant('p1-giant', p1),
    ...Array.from({ length: 8 }, (_, index) => land(`p2-land-${index}`, p2)),
    giant('p2-giant', p2),
  ];
}

function setupGame(gameId: string) {
  const game = createInitialGameState(gameId);
  game.applyEvent!({ type: 'join', playerId: p1, name: 'A' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'B' } as any);
  const ctx = game as any;
  ctx.gameId = gameId;
  ctx.state.turnPlayer = p1;
  ctx.state.priority = p1;
  ctx.state._suppressBroadcastCount = 1;
  ctx.state.battlefield = seedBattlefield();
  return game;
}

function landIds(game: any, playerId: string): string[] {
  return (game.state.battlefield as any[])
    .filter((permanent) => String(permanent.controller) === playerId && /land/i.test(String(permanent.card?.type_line || '')))
    .map((permanent) => String(permanent.id))
    .sort();
}

function giantDamage(game: any, id: string): number {
  const permanent = (game.state.battlefield as any[]).find((entry) => entry.id === id);
  return Number(permanent?.damageMarked || 0);
}

describe('Planetary Annihilation replay', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  it('replays chooseThenSacrificeRestChoiceResolve and chooseThenSacrificeRestBatchResolve without doubling the damage', async () => {
    await initDb();
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const gameId = 'planetary_annihilation_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = setupGame(gameId);

    const outcome = tryResolveSpellViaOracleIR(game as any, {
      controller: p1,
      spellName: 'Planetary Annihilation',
      oracleText: PLANETARY_ANNIHILATION,
      sourceId: 'pa-1',
      targets: [],
    } as any);
    expect(outcome.handled).toBe(true);

    const queued = (ResolutionQueueManager.getQueue(gameId).steps || [])
      .filter((step: any) => step.chooseThenSacrificeRestChoice === true);
    expect(queued).toHaveLength(2);

    const io = { to: () => ({ emit() {} }) } as any;
    for (const step of [...queued]) {
      const keep = (step.validTargets as any[]).slice(0, 6).map((target) => String(target.id));
      await handleChooseThenSacrificeRestTargetSelection(io, game, gameId, step, {
        stepId: step.id,
        playerId: step.playerId,
        selections: keep,
        cancelled: false,
        timestamp: Date.now(),
      });
    }

    const liveP1Lands = landIds(game, p1);
    const liveP2Lands = landIds(game, p2);
    expect(liveP1Lands).toHaveLength(6);
    expect(liveP2Lands).toHaveLength(6);
    expect(giantDamage(game, 'p1-giant')).toBe(6);
    expect(giantDamage(game, 'p2-giant')).toBe(6);

    const persisted = transformDbEventsForReplay(getEvents(gameId) as any);
    expect(persisted.filter((event: any) => event.type === 'chooseThenSacrificeRestChoiceResolve')).toHaveLength(2);
    expect(persisted.filter((event: any) => event.type === 'chooseThenSacrificeRestBatchResolve')).toHaveLength(1);

    ResolutionQueueManager.removeQueue(gameId);
    const replayGame = setupGame(gameId);
    replayGame.replay!(persisted as any);

    expect(landIds(replayGame, p1)).toEqual(liveP1Lands);
    expect(landIds(replayGame, p2)).toEqual(liveP2Lands);
    expect(giantDamage(replayGame, 'p1-giant')).toBe(6);
    expect(giantDamage(replayGame, 'p2-giant')).toBe(6);
    const pending = (ResolutionQueueManager.getQueue(gameId).steps || [])
      .filter((step: any) => step.chooseThenSacrificeRestChoice === true);
    expect(pending).toHaveLength(0);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
