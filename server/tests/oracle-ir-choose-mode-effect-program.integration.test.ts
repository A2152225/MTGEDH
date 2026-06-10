import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  requiresEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from '../src/state/modules/oracleIrEffectProgramServer.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const modalSteps = [
  {
    kind: 'choose_mode',
    minModes: 1,
    maxModes: 1,
    modes: [
      {
        label: 'Draw',
        raw: 'Draw a card.',
        steps: [
          {
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            raw: 'Draw a card.',
          },
        ],
      },
      {
        label: 'Gain',
        raw: 'You gain 2 life.',
        steps: [
          {
            kind: 'gain_life',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 2 },
            raw: 'You gain 2 life.',
          },
        ],
      },
    ],
    raw: 'Choose one — Draw a card. You gain 2 life.',
  },
] as const;

describe('oracle IR choose_mode Effect Program server wiring', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('requires Effect Program orchestration for unresolved choose_mode steps', () => {
    expect(requiresEffectProgramOrchestration(modalSteps as any, [])).toBe(true);
    expect(requiresEffectProgramOrchestration(modalSteps as any, ['Draw'])).toBe(false);
    expect(requiresEffectProgramOrchestration([
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'Draw a card.',
      },
    ] as any)).toBe(false);
  });

  it('queues MODE_SELECTION and completes draw mode through resumeEffectProgramResolution', () => {
    const gameId = 'oracle_ir_choose_mode_effect_program';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [];
    player.library = [{ id: 'drawn-card', name: 'Drawn Card', zone: 'library' }];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'modal-spell-1',
      sourceName: 'Modal Spell',
      sourceObjectType: 'spell',
    });

    const started = startOracleEffectProgramOnServer(ctx, {
      controller: p1,
      sourceName: 'Modal Spell',
      sourceId: 'modal-spell-1',
      steps: modalSteps as any,
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'spell:modal-spell-1',
      metadata: { family: 'spell_resolution' },
    });

    expect(started.handled).toBe(true);
    expect(started.waitingForChoice).toBe(true);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const modeStep = steps.find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.effectProgramPrompt).toBe(true);
    expect((modeStep as any)?.modes?.map((mode: any) => mode.id)).toEqual(['Draw', 'Gain']);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(modeStep!.id), {
      stepId: String(modeStep!.id),
      playerId: p1,
      selections: [{ id: 'Draw', label: 'Draw' }],
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

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    const handIds = (playerAfter?.hand || (game.state as any).zones?.[p1]?.hand || [])
      .map((card: any) => card.id);
    expect(handIds).toEqual(['drawn-card']);
    expect((ctx.libraries.get(p1) || []).map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).zones[p1].handCount).toBe(1);
  });
});
