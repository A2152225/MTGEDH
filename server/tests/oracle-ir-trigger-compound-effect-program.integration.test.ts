import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { collectTriggerExecutionSteps } from '../src/state/modules/oracleIrTriggerExecutionHelpers.js';
import {
  requiresSpellEffectProgramOrchestration,
  requiresTriggerEffectProgramOrchestration,
} from '../src/state/modules/oracleIrEffectProgramServer.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
} from '../src/state/resolution/index.js';
import type { EffectProgramResolutionResult } from '../src/state/effects/effectProgramResolutionService.js';

const CHOOSE_COLOR_MANA_EFFECT = 'Choose a color. Add one mana of the chosen color.';

const OPPONENT_DRAW_EFFECT = 'Choose target opponent. Target player draws a card.';

const FATESEAL_EFFECT = 'Fateseal 2.';

function setupTwoPlayerGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;

  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

  const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
  const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);

  player1.library = [];
  player1.hand = [];
  player1.graveyard = [];

  player2.library = [
    { id: 'opp-draw-card', name: 'Opponent Draw Card', zone: 'library' },
  ];
  player2.hand = [];
  player2.graveyard = [];

  (game.state as any).zones = {
    [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 1 },
  };

  const ctx = game as any;
  ctx.gameId = gameId;
  ctx.libraries = new Map([
    [p1, []],
    [p2, player2.library.map((card: any) => ({ ...card }))],
  ]);
  ResolutionQueueManager.removeQueue(gameId);

  return { game, ctx, p1, p2, player1, player2 };
}

function completeAndResumeEffectProgramStep(
  ctx: any,
  gameId: string,
  stepType: ResolutionStepType,
  playerId: PlayerID,
  selections: unknown,
): EffectProgramResolutionResult {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const step = queue.steps.find((entry) => entry.type === stepType);
  expect(step).toBeTruthy();

  const actingPlayerId = String((step as ResolutionStep).playerId || playerId).trim() as PlayerID;
  const completedStep = ResolutionQueueManager.completeStep(gameId, String(step!.id), {
    stepId: String(step!.id),
    playerId: actingPlayerId,
    selections,
    cancelled: false,
    timestamp: Date.now(),
  });

  return resumeEffectProgramResolution({
    game: ctx,
    gameId,
    step: completedStep!,
    response: completedStep!.response!,
    persistPrompt: false,
  });
}

describe('oracle IR trigger compound Effect Program gate', () => {
  it('requires Effect Program for choose_color, choose_card_name, and choose_opponent compounds', () => {
    const colorSteps = collectTriggerExecutionSteps(CHOOSE_COLOR_MANA_EFFECT, 'Color Trigger');
    expect(colorSteps.map((step) => step.kind)).toEqual(['choose_color', 'add_mana']);
    expect(requiresTriggerEffectProgramOrchestration(colorSteps)).toBe(true);
    expect(requiresSpellEffectProgramOrchestration(colorSteps)).toBe(true);

    const opponentSteps = collectTriggerExecutionSteps(OPPONENT_DRAW_EFFECT, 'Opponent Draw Trigger');
    expect(opponentSteps.map((step) => step.kind)).toEqual(['choose_opponent', 'draw']);
    expect(requiresTriggerEffectProgramOrchestration(opponentSteps)).toBe(true);

    const nameSteps = collectTriggerExecutionSteps(
      'Choose a card name. Spells with the chosen name cost {1} less to cast.',
      'Name Trigger',
    );
    expect(nameSteps.some((step) => step.kind === 'choose_card_name')).toBe(true);
    expect(requiresTriggerEffectProgramOrchestration(nameSteps)).toBe(true);
  });

  it('requires Effect Program for fateseal trigger text', () => {
    const steps = collectTriggerExecutionSteps(FATESEAL_EFFECT, 'Fateseal Trigger');
    expect(steps.map((step) => step.kind)).toEqual(['fateseal']);
    expect(requiresTriggerEffectProgramOrchestration(steps)).toBe(true);
  });
});

describe('oracle IR trigger compound Effect Program live path', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('queues color choice and adds mana via tryResolveTriggerViaOracleIR', () => {
    const gameId = 'oracle_ir_trigger_color_ep';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Color Mana Trigger',
      effectText: CHOOSE_COLOR_MANA_EFFECT,
      triggerItem: { id: 'trigger-color-ep-1', controller: p1 },
    });

    expect(outcome.handled).toBe(true);

    const colorStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.COLOR_CHOICE);
    expect(colorStep).toBeTruthy();
    expect((colorStep as any)?.effectProgramPrompt).toBe(true);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(colorStep!.id), {
      stepId: String(colorStep!.id),
      playerId: p1,
      selections: ['R'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = resumeEffectProgramResolution({
      game: ctx,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: false,
    });

    expect(resumed.status).toBe('completed');
    expect((game.state as any).manaPool?.[p1]?.red).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues opponent choice and completes draw via tryResolveTriggerViaOracleIR', () => {
    const gameId = 'oracle_ir_trigger_opponent_draw_ep';
    const { game, ctx, p1, p2, player2 } = setupTwoPlayerGame(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Opponent Draw Trigger',
      effectText: OPPONENT_DRAW_EFFECT,
      triggerItem: { id: 'trigger-opponent-draw-1', controller: p1 },
    });

    expect(outcome.handled).toBe(true);

    const opponentStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.PLAYER_CHOICE);
    expect(opponentStep).toBeTruthy();
    expect((opponentStep as any)?.effectProgramPrompt).toBe(true);

    const afterOpponent = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.PLAYER_CHOICE,
      p1,
      [p2],
    );
    expect(afterOpponent.status).toBe('completed');

    const p2Hand = ((game.state as any).zones?.[p2]?.hand
      || player2.hand
      || [])
      .map((card: any) => card.id);
    expect(p2Hand).toEqual(['opp-draw-card']);
    expect((ctx.libraries.get(p2) || []).map((card: any) => card.id)).toEqual([]);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues fateseal via tryResolveTriggerViaOracleIR and reorders opponent library on resume', () => {
    const gameId = 'oracle_ir_trigger_fateseal_ep';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    player2.library = [
      { id: 'opp-top-a', name: 'Opponent Top A', zone: 'library' },
      { id: 'opp-top-b', name: 'Opponent Top B', zone: 'library' },
      { id: 'opp-remaining-c', name: 'Opponent Remaining C', zone: 'library' },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 3 },
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([
      [p1, []],
      [p2, player2.library.map((card: any) => ({ ...card }))],
    ]);
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Fateseal Trigger',
      effectText: FATESEAL_EFFECT,
      triggerItem: { id: 'trigger-fateseal-1', controller: p1 },
    });

    expect(outcome.handled).toBe(true);

    const afterOpponent = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.PLAYER_CHOICE,
      p1,
      [p2],
    );
    expect(afterOpponent.status).toBe('waiting_for_choice');

    const fatesealStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.FATESEAL,
    );
    expect(fatesealStep).toBeTruthy();
    expect((fatesealStep as any)?.fatesealCount).toBe(2);

    const completed = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.FATESEAL,
      p1,
      { keepTopOrder: ['opp-top-b'], bottomOrder: ['opp-top-a'] },
    );
    expect(completed.status).toBe('completed');

    const libraryIds = (ctx.libraries.get(p2) || []).map((card: any) => card.id);
    expect(libraryIds).toEqual(['opp-top-b', 'opp-remaining-c', 'opp-top-a']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
