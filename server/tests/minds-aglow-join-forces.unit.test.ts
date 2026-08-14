import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  isOracleIrExecutionHandled,
  tryResolveSpellViaOracleIR,
} from '../src/state/modules/oracleIrSpellExecution.js';
import { maybeResumeOracleIRStepsAfterResolution } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const MINDS_AGLOW_ORACLE =
  'Join forces — Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.';

describe('Minds Aglow Join Forces via Oracle IR', () => {
  const gameId = 'minds_aglow_join_forces';
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    ResolutionQueueManager.removeQueue(gameId);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  function seedGame() {
    const game = createInitialGameState(gameId);
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const makeLibrary = (prefix: string) =>
      Array.from({ length: 6 }, (_, index) => ({
        id: `${prefix}-lib-${index}`,
        name: `Card ${index}`,
        type_line: 'Instant',
        zone: 'library',
      }));

    for (const playerId of [p1, p2]) {
      const library = makeLibrary(playerId);
      const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
      player.hand = [];
      player.library = library;
      (game.state as any).zones = {
        ...((game.state as any).zones || {}),
        [playerId]: {
          hand: [],
          handCount: 0,
          libraryCount: library.length,
          graveyard: [],
          graveyardCount: 0,
        },
      };
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map(
      [p1, p2].map((playerId) => {
        const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
        return [playerId, player.library.map((card: any) => ({ ...card }))];
      }),
    );
    return game;
  }

  it('parses join_forces before the paid-this-way draw', () => {
    const ir = parseOracleTextToIR(MINDS_AGLOW_ORACLE, 'Minds Aglow');
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []);
    expect(steps.map((step: any) => step.kind)).toEqual(['join_forces', 'draw']);
  });

  it('queues JOIN_FORCES without drawing or skipping the mandatory draw', () => {
    const game = seedGame();
    const ctx = game as any;
    const queueBefore = ResolutionQueueManager.getQueue(gameId).steps.length;

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Minds Aglow',
      oracleText: MINDS_AGLOW_ORACLE,
      sourceId: 'minds-aglow-1',
      xValue: 0,
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const joinSteps = queue.steps.filter((step: any) => step.type === ResolutionStepType.JOIN_FORCES);

    expect(outcome.handled).toBe(true);
    expect(joinSteps).toHaveLength(2);
    expect(String(joinSteps[0]?.oracleIrResumeStepsJson || '')).toMatch(/"kind":"draw"/);
    expect((game.state as any).players.find((entry: any) => entry.id === p1).hand).toHaveLength(0);
    expect((game.state as any).players.find((entry: any) => entry.id === p2).hand).toHaveLength(0);
    expect(queue.steps.length).toBeGreaterThan(queueBefore);
  });

  it('resumes the draw with X=0 without treating it as a mandatory skip', () => {
    const game = seedGame();
    const ctx = game as any;
    tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Minds Aglow',
      oracleText: MINDS_AGLOW_ORACLE,
      sourceId: 'minds-aglow-1',
      xValue: 0,
    });

    const joinStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.JOIN_FORCES,
    );
    expect(joinStep).toBeTruthy();

    const resumeResult = maybeResumeOracleIRStepsAfterResolution(ctx, {
      ...joinStep,
      oracleIrXValue: 0,
    });

    expect(resumeResult).toBeTruthy();
    expect(isOracleIrExecutionHandled(resumeResult!, 0, 0, resumeResult!.appliedSteps)).toBe(true);
    expect(resumeResult!.appliedSteps.map((step) => step.kind)).toEqual(['draw']);
    expect(resumeResult!.skippedSteps).toHaveLength(0);
    expect((game.state as any).players.find((entry: any) => entry.id === p1).hand).toHaveLength(0);
    expect((game.state as any).players.find((entry: any) => entry.id === p2).hand).toHaveLength(0);
  });

  it('resumes the draw with the join-forces total, not the spell X', () => {
    const game = seedGame();
    const ctx = game as any;
    tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Minds Aglow',
      oracleText: MINDS_AGLOW_ORACLE,
      sourceId: 'minds-aglow-1',
      xValue: 5,
    });

    const joinStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.JOIN_FORCES,
    );
    const resumeResult = maybeResumeOracleIRStepsAfterResolution(ctx, {
      ...joinStep,
      oracleIrXValue: 2,
    });

    expect(resumeResult!.appliedSteps.map((step) => step.kind)).toEqual(['draw']);
    expect((game.state as any).players.find((entry: any) => entry.id === p1).hand).toHaveLength(2);
    expect((game.state as any).players.find((entry: any) => entry.id === p2).hand).toHaveLength(2);
  });
});
