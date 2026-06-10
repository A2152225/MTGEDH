import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR choose_pile queue adapter', () => {
  it('queues pile choice and resumes the choose_pile step', () => {
    const gameId = 'oracle_ir_choose_pile_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'pile-source-1',
      sourceName: 'Pile Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'choose_pile',
          chooser: { kind: 'you' },
          source: 'last_split_piles',
          chosenDestination: 'hand',
          otherDestination: 'graveyard',
          raw: 'An opponent chooses one of those piles.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const pileStep = steps.find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(pileStep).toBeTruthy();
    expect((pileStep as any)?.oracleIrPlayerChoiceKind).toBe('choose_pile');
    expect((pileStep as any)?.options?.map((option: any) => option.id)).toEqual(['pileA', 'pileB']);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(pileStep!.id), {
      stepId: String(pileStep!.id),
      playerId: p1,
      selections: 'pileB',
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'choose_pile')).toBe(true);
  });

  it('queues TWO_PILE_SPLIT for top_library choose_pile steps', () => {
    const gameId = 'oracle_ir_choose_pile_top_library';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const library = [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
      { id: 'c3', name: 'Card 3', zone: 'library' },
    ];

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = library.map((card) => ({ ...card }));

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, library.map((card) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'split-source-1',
      sourceName: 'Split Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'choose_pile',
          chooser: { kind: 'target_opponent' },
          source: 'top_library',
          chosenDestination: 'hand',
          otherDestination: 'graveyard',
          raw: 'Reveal the top three cards of your library and separate them into two piles.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const splitStep = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .find((step) => step.type === ResolutionStepType.TWO_PILE_SPLIT);
    expect(splitStep).toBeTruthy();
    expect((splitStep as any)?.choosePileFromSplitChoice).toBe(true);
    expect((splitStep as any)?.items?.map((item: any) => item.id)).toEqual(['c1', 'c2', 'c3']);
    expect((game.state as any).zones[p1].library.map((card: any) => card.id)).toEqual([]);
    expect((ctx.libraries.get(p1) || []).map((card: any) => card.id)).toEqual([]);
  });

  it('attaches choosePileFromSplit metadata when last_split_piles state is present', () => {
    const gameId = 'oracle_ir_choose_pile_split_metadata';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).oracleIrLastSplitPiles = {
      pileA: ['c1', 'c3'],
      pileB: ['c2'],
      items: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
        { id: 'c3', name: 'Card 3' },
      ],
      originalOrder: ['c1', 'c2', 'c3'],
      chosenDestination: 'hand',
      otherDestination: 'graveyard',
      movePlayerId: p1,
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'pile-source-2',
      sourceName: 'Pile Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'choose_pile',
          chooser: { kind: 'you' },
          source: 'last_split_piles',
          chosenDestination: 'hand',
          otherDestination: 'graveyard',
          raw: 'Choose one of those piles.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const pileStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect((pileStep as any)?.choosePileFromSplitChoice).toBe(true);
    expect((pileStep as any)?.choosePileFromSplitPileA).toEqual(['c1', 'c3']);
    expect((pileStep as any)?.choosePileFromSplitPileB).toEqual(['c2']);
    expect((pileStep as any)?.oracleIrChoiceStepJson).toBeTruthy();
  });
});
