import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const searchCreatureStep = {
  kind: 'search_library',
  who: { kind: 'you' },
  criteria: { kind: 'raw', text: 'creature' },
  destination: 'hand',
  revealFound: false,
  shuffle: true,
  maxResults: 1,
  raw: 'Search your library for a creature card, put it into your hand, then shuffle.',
} as const;

function setupSearchGame(gameId: string, library: Array<Record<string, unknown>>) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;

  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

  (game.state as any).zones = {
    [p1]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      libraryCount: library.length,
    },
  };

  const player = (game.state as any).players.find((entry: any) => entry.id === p1);
  player.hand = [];
  player.library = library.map((card) => ({ ...card, zone: 'library' }));

  const ctx = game as any;
  ctx.gameId = gameId;
  ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
  ResolutionQueueManager.removeQueue(gameId);

  return { game, ctx, p1, player };
}

describe('oracle IR search_library queue adapter', () => {
  it('queues library search when multiple cards match and applies the chosen card on resume', () => {
    const { ctx, p1 } = setupSearchGame('oracle_ir_search_library_queue', [
      { id: 'creature-a', name: 'Elves', type_line: 'Creature — Elf' },
      { id: 'creature-b', name: 'Bears', type_line: 'Creature — Bear' },
      { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
    ]);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'search-source-1',
      sourceName: 'Search Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      (ctx as any).state,
      [searchCreatureStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer((ctx as any).gameId, p1);
    const searchStep = steps.find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any)?.availableCards).toHaveLength(2);
    expect((searchStep as any)?.maxSelections).toBe(1);
    expect(String((searchStep as any)?.oracleIrChoiceStepJson || '')).toContain('search_library');

    const completedStep = ResolutionQueueManager.completeStep((ctx as any).gameId, String(searchStep!.id), {
      stepId: String(searchStep!.id),
      playerId: p1,
      selections: ['creature-b'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'search_library')).toBe(true);

    const playerAfter = (ctx as any).state.players.find((entry: any) => entry.id === p1);
    expect((playerAfter?.hand || []).map((card: any) => card.id)).toEqual(['creature-b']);
    const libraryIds = (ctx.libraries.get(p1) || []).map((card: any) => card.id);
    expect(libraryIds).toHaveLength(2);
    expect(libraryIds).toContain('creature-a');
    expect(libraryIds).toContain('bolt');
    expect(libraryIds).not.toContain('creature-b');
  });

  it('auto-applies when only one card matches without queueing a prompt', () => {
    const { ctx, p1 } = setupSearchGame('oracle_ir_search_library_auto', [
      { id: 'creature-a', name: 'Elves', type_line: 'Creature — Elf' },
      { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
    ]);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'search-source-2',
      sourceName: 'Search Source',
    });

    const result = applyOracleIRStepsOnServer(
      ctx,
      (ctx as any).state,
      [searchCreatureStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['search_library']);
    const steps = ResolutionQueueManager.getStepsForPlayer((ctx as any).gameId, p1);
    expect(steps.some((step) => step.type === ResolutionStepType.LIBRARY_SEARCH)).toBe(false);

    const playerAfter = (ctx as any).state.players.find((entry: any) => entry.id === p1);
    expect((playerAfter?.hand || []).map((card: any) => card.id)).toEqual(['creature-a']);
  });
});
