import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { handleChooseThenSacrificeRestTargetSelection } from '../src/socket/resolution-handlers/chooseThenSacrificeRestTargetSelection.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const PLANETARY_ANNIHILATION =
  'Each player chooses six lands they control, then sacrifices the rest. Planetary Annihilation deals 6 damage to each creature.';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const p3 = 'p3' as PlayerID;

function land(id: string, controller: string, name = 'Plains') {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}-card`, name, type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.' },
  };
}

function artifactLand(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}-card`, name: 'Ancient Den', type_line: 'Artifact Land', oracle_text: '{T}: Add {W}.' },
  };
}

function artifact(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}-card`, name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
  };
}

function giant(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    damageMarked: 0,
    card: { id: `${id}-card`, name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '7', oracle_text: '' },
  };
}

function ensureZones(game: any, playerId: string) {
  const zones = ((game.state as any).zones = (game.state as any).zones || {});
  zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

describe('Planetary Annihilation', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  it('lets each player keep six lands, sacrifices only the rest, then deals 6 to each creature', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const gameId = 'planetary_annihilation_keep_six';
    const game = createInitialGameState(gameId);
    game.applyEvent!({ type: 'join', playerId: p1, name: 'A2' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'Morpholk' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'C' } as any);
    for (const playerId of [p1, p2, p3]) ensureZones(game, playerId);

    const ctx = game as any;
    ctx.gameId = gameId;
    (ctx.state as any).turnPlayer = p1;
    (ctx.state as any).priority = p1;
    (ctx.state as any)._suppressBroadcastCount = 1;
    ResolutionQueueManager.removeQueue(gameId);

    const p1Lands = [
      ...Array.from({ length: 6 }, (_, index) => land(`p1-land-${index}`, p1)),
      artifactLand('p1-den', p1),
    ];
    const p2Lands = Array.from({ length: 7 }, (_, index) => land(`p2-land-${index}`, p2, 'Island'));
    const p3Lands = [land('p3-land-0', p3), land('p3-land-1', p3)];
    ctx.state.battlefield = [
      ...p1Lands,
      artifact('p1-ring', p1),
      giant('p1-giant', p1),
      ...p2Lands,
      artifact('p2-ring', p2),
      giant('p2-giant', p2),
      ...p3Lands,
      artifact('p3-ring', p3),
      giant('p3-giant', p3),
    ];

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Planetary Annihilation',
      oracleText: PLANETARY_ANNIHILATION,
      sourceId: 'pa-1',
      targets: [],
    } as any);
    expect(outcome.handled).toBe(true);

    const queued = (ResolutionQueueManager.getQueue(gameId).steps || [])
      .filter((step: any) => step.chooseThenSacrificeRestChoice === true);
    expect(queued.map((step: any) => String(step.playerId)).sort()).toEqual([p1, p2]);
    expect(queued.every((step: any) => step.minTargets === 6 && step.maxTargets === 6)).toBe(true);
    expect(ctx.state.battlefield.filter((permanent: any) => String(permanent.card?.type_line || '').toLowerCase().includes('land'))).toHaveLength(16);

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

    const battlefield = ctx.state.battlefield as any[];
    const ids = new Set(battlefield.map((permanent) => String(permanent.id)));
    expect(ids.has('p1-den')).toBe(false);
    expect(ids.has('p2-land-6')).toBe(false);
    expect(battlefield.filter((permanent) => String(permanent.controller) === p1 && /land/i.test(String(permanent.card?.type_line || ''))).map((permanent) => permanent.id).sort())
      .toEqual(['p1-land-0', 'p1-land-1', 'p1-land-2', 'p1-land-3', 'p1-land-4', 'p1-land-5']);
    expect(battlefield.filter((permanent) => String(permanent.controller) === p2 && /land/i.test(permanent.card?.type_line || ''))).toHaveLength(6);
    expect(battlefield.filter((permanent) => String(permanent.controller) === p3 && /land/i.test(permanent.card?.type_line || '')).map((permanent) => permanent.id).sort())
      .toEqual(['p3-land-0', 'p3-land-1']);
    for (const ringId of ['p1-ring', 'p2-ring', 'p3-ring']) {
      expect(ids.has(ringId)).toBe(true);
    }
    for (const giantId of ['p1-giant', 'p2-giant', 'p3-giant']) {
      const permanent = battlefield.find((entry) => entry.id === giantId);
      expect(permanent).toBeTruthy();
      expect(Number(permanent.damageMarked || 0)).toBe(6);
    }

    ResolutionQueueManager.clearAllSteps(gameId);
  });
});
