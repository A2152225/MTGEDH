import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { lookupLocalCardByNameSync, ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import { isSpellEffectFullyIrWired } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { maybeResumeDeferredOracleIrStackSpellOnGame } from '../src/state/modules/oracleIrDeferredStackFinalize.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { sanitizeStepForClient } from '../src/socket/resolution.js';

const REVERSE_THE_SANDS_TEXT =
  "Redistribute any number of players' life totals. (Each of those players gets one life total back.)";

function joinPlayer(game: ReturnType<typeof createInitialGameState>, playerId: PlayerID, name: string) {
  game.applyEvent!({ type: 'join', playerId, name } as any);
}

describe('Reverse the Sands life redistribution integration', () => {
  it('queues LIFE_REDISTRIBUTION and applies chosen totals on resume', () => {
    const gameId = 'reverse_the_sands_life_redistribution';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    joinPlayer(game, p1, 'Alice');
    joinPlayer(game, p2, 'Bob');
    joinPlayer(game, p3, 'Carol');

    (game.state as any).life = { p1: 20, p2: 30, p3: 40 };
    for (const player of (game.state as any).players) {
      player.life = (game.state as any).life[player.id];
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(REVERSE_THE_SANDS_TEXT, 'Reverse the Sands').abilities?.[0]?.steps || [];
    expect(steps.some((step: any) => step?.kind === 'redistribute_life_totals')).toBe(true);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'reverse-the-sands-1',
      sourceName: 'Reverse the Sands',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    const queueSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const redistributionStep = queueSteps.find((step) => step.type === ResolutionStepType.LIFE_REDISTRIBUTION);
    expect(redistributionStep).toBeTruthy();
    expect((redistributionStep as any)?.players).toEqual([
      { id: 'p1', name: 'Alice', life: 20 },
      { id: 'p2', name: 'Bob', life: 30 },
      { id: 'p3', name: 'Carol', life: 40 },
    ]);

    const clientStep = sanitizeStepForClient(gameId, redistributionStep!);
    expect(clientStep.type).toBe('life_redistribution');
    expect(clientStep.players).toHaveLength(3);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(redistributionStep!.id), {
      stepId: String(redistributionStep!.id),
      playerId: p1,
      selections: {
        lifeByPlayerId: {
          p1: 40,
          p2: 30,
          p3: 20,
        },
      },
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'redistribute_life_totals')).toBe(true);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    expect((game.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
  });

  it('does not auto-apply life totals without player choice', () => {
    const gameId = 'reverse_the_sands_requires_choice';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    joinPlayer(game, p1, 'Alice');
    joinPlayer(game, p2, 'Bob');
    (game.state as any).life = { p1: 25, p2: 35 };
    for (const player of (game.state as any).players) {
      player.life = (game.state as any).life[player.id];
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(REVERSE_THE_SANDS_TEXT, 'Reverse the Sands').abilities?.[0]?.steps || [];
    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'reverse-the-sands-2',
      sourceName: 'Reverse the Sands',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    expect((game.state as any).life).toEqual({ p1: 25, p2: 35 });
    expect(
      ResolutionQueueManager.getStepsForPlayer(gameId, p1).some(
        (step) => step.type === ResolutionStepType.LIFE_REDISTRIBUTION,
      ),
    ).toBe(true);
  });
});

describe('Reverse the Sands live stack path', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  beforeEach(() => {
    ensureLocalCardLookupIndexSync();
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
    if (previousLegacy === undefined) {
      delete process.env.ORACLE_IR_SPELL_LEGACY;
    } else {
      process.env.ORACLE_IR_SPELL_LEGACY = previousLegacy;
    }
  });

  it('reports Reverse the Sands as fully IR-wired', () => {
    const card = lookupLocalCardByNameSync('Reverse the Sands');
    expect(card?.oracle_text).toContain("Redistribute any number of players' life totals");
    expect(isSpellEffectFullyIrWired(String(card!.oracle_text), 'Reverse the Sands')).toBe(true);
  });

  it('defers stack finalize until life redistribution completes', () => {
    const card = lookupLocalCardByNameSync('Reverse the Sands');
    const gameId = 'reverse_the_sands_deferred_finalize';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    joinPlayer(game, p1, 'Alice');
    joinPlayer(game, p2, 'Bob');
    joinPlayer(game, p3, 'Carol');

    (game.state as any).life = { p1: 20, p2: 30, p3: 40 };
    for (const player of (game.state as any).players) {
      player.life = (game.state as any).life[player.id];
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const deckCard: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'reverse-the-sands-stack',
      name: card!.name,
      type_line: card!.type_line,
      oracle_text: card!.oracle_text,
      mana_cost: card!.mana_cost,
    };

    game.importDeckResolved(p1, [deckCard] as any);
    game.drawCards(p1, 1);

    (game.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    game.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: deckCard.id,
      targets: [],
    });

    game.resolveTopOfStack();

    const redistributionStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIFE_REDISTRIBUTION);
    expect(redistributionStep).toBeTruthy();

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect((stack[0] as any)?.oracleIrDeferredFinalize).toBe(true);
    expect((game.state as any).life).toEqual({ p1: 20, p2: 30, p3: 40 });

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(redistributionStep!.id), {
      stepId: String(redistributionStep!.id),
      playerId: p1,
      selections: {
        lifeByPlayerId: {
          p1: 40,
          p2: 30,
          p3: 20,
        },
      },
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);
    maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);

    expect((game.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
    expect((game.state as any).stack || []).toHaveLength(0);

    const graveyard = (game.state as any).zones?.[p1]?.graveyard || [];
    expect(graveyard.some((entry: any) => entry?.name === 'Reverse the Sands')).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
