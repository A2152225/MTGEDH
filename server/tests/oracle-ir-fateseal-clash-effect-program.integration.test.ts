import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  requiresEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from '../src/state/modules/oracleIrEffectProgramServer.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
} from '../src/state/resolution/index.js';
import type { EffectProgramResolutionResult } from '../src/state/effects/effectProgramResolutionService.js';

const fatesealSteps = [
  {
    kind: 'fateseal',
    who: { kind: 'you' },
    target: { kind: 'target_opponent' },
    amount: { kind: 'number', value: 2 },
    raw: 'Fateseal 2.',
  },
] as const;

const clashSteps = [
  {
    kind: 'clash',
    who: { kind: 'you' },
    opponent: { kind: 'target_opponent' },
    raw: 'Clash with an opponent.',
  },
] as const;

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
    { id: 'opp-top-a', name: 'Opponent Top A', zone: 'library' },
    { id: 'opp-top-b', name: 'Opponent Top B', zone: 'library' },
    { id: 'opp-remaining-c', name: 'Opponent Remaining C', zone: 'library' },
  ];
  player2.hand = [];
  player2.graveyard = [];

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

  return { game, ctx, p1, p2, player2 };
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

describe('oracle IR fateseal/clash Effect Program server wiring', () => {
  it('requires Effect Program orchestration for fateseal and clash steps', () => {
    expect(requiresEffectProgramOrchestration(fatesealSteps as any)).toBe(true);
    expect(requiresEffectProgramOrchestration(clashSteps as any)).toBe(true);
    expect(requiresEffectProgramOrchestration([
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Draw a card.',
      },
    ] as any)).toBe(false);
  });

  it('queues opponent choice then fateseal and reorders the opponent library on resume', () => {
    const gameId = 'oracle_ir_fateseal_effect_program';
    const { game, ctx, p1, p2 } = setupTwoPlayerGame(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'fateseal-source-1',
      sourceName: 'Fateseal Source',
      sourceObjectType: 'spell',
    });

    const started = startOracleEffectProgramOnServer(ctx, {
      controller: p1,
      sourceName: 'Fateseal Source',
      sourceId: 'fateseal-source-1',
      steps: fatesealSteps as any,
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'spell:fateseal-source-1',
      metadata: { family: 'spell_resolution' },
    });

    expect(started.handled).toBe(true);
    expect(started.waitingForChoice).toBe(true);

    const opponentChoice = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.PLAYER_CHOICE,
    );
    expect(opponentChoice).toBeTruthy();
    expect((opponentChoice as any)?.effectProgramPrompt).toBe(true);

    const afterOpponent = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.PLAYER_CHOICE,
      p1,
      ['p2'],
    );
    expect(afterOpponent.status).toBe('waiting_for_choice');

    const fatesealStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.FATESEAL,
    );
    expect(fatesealStep).toBeTruthy();
    expect((fatesealStep as any)?.fatesealCount).toBe(2);
    expect((fatesealStep as any)?.opponentId).toBe(p2);
    expect((fatesealStep as any)?.cards?.map((card: any) => card.id)).toEqual(['opp-top-a', 'opp-top-b']);

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

    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect((player2?.library || []).map((card: any) => card.id)).toEqual(libraryIds);
    expect((game.state as any).zones[p2].libraryCount).toBe(3);
  });

  it('queues clash opponent and card choices then completes clash resolution', () => {
    const gameId = 'oracle_ir_clash_effect_program';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);

    player1.library = [
      { id: 'you-high', name: 'Dragon', type_line: 'Creature — Dragon', mana_cost: '{5}{R}', cmc: 6, zone: 'library' },
      { id: 'you-next', name: 'You Next', type_line: 'Instant', cmc: 2, zone: 'library' },
    ];
    player1.hand = [];
    player1.graveyard = [];

    player2.library = [
      { id: 'opp-low', name: 'Shock', type_line: 'Instant', mana_cost: '{R}', cmc: 1, zone: 'library' },
      { id: 'opp-next', name: 'Opponent Next', type_line: 'Land', cmc: 0, zone: 'library' },
    ];
    player2.hand = [];
    player2.graveyard = [];

    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 2 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 2 },
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([
      [p1, player1.library.map((card: any) => ({ ...card }))],
      [p2, player2.library.map((card: any) => ({ ...card }))],
    ]);
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'clash-source-1',
      sourceName: 'Clash Source',
      sourceObjectType: 'ability',
    });

    const started = startOracleEffectProgramOnServer(ctx, {
      controller: p1,
      sourceName: 'Clash Source',
      sourceId: 'clash-source-1',
      steps: clashSteps as any,
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'trigger:clash-source-1',
      metadata: { family: 'trigger_resolution' },
    });

    expect(started.handled).toBe(true);
    expect(started.waitingForChoice).toBe(true);

    const afterOpponent = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.PLAYER_CHOICE,
      p1,
      ['p2'],
    );
    expect(afterOpponent.status).toBe('waiting_for_choice');

    const controllerClash = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.CLASH && String(step.playerId) === p1,
    );
    expect(controllerClash).toBeTruthy();
    expect((controllerClash as any)?.revealedCard?.id).toBe('you-high');

    const afterController = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.CLASH,
      p1,
      { putOnBottom: false },
    );
    expect(afterController.status).toBe('waiting_for_choice');

    const opponentClash = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.CLASH && String(step.playerId) === p2,
    );
    expect(opponentClash).toBeTruthy();
    expect((opponentClash as any)?.revealedCard?.id).toBe('opp-low');

    const completed = completeAndResumeEffectProgramStep(
      ctx,
      gameId,
      ResolutionStepType.CLASH,
      p2,
      { putOnBottom: true },
    );
    expect(completed.status).toBe('completed');

    const p1LibraryIds = (ctx.libraries.get(p1) || []).map((card: any) => card.id);
    const p2LibraryIds = (ctx.libraries.get(p2) || []).map((card: any) => card.id);
    expect(p1LibraryIds).toEqual(['you-high', 'you-next']);
    expect(p2LibraryIds).toEqual(['opp-next', 'opp-low']);
  });
});
