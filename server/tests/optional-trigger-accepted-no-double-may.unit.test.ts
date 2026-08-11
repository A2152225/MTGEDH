import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { startOracleEffectProgramOnServer } from '../src/state/modules/oracleIrEffectProgramServer.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('optional trigger accepted — single may prompt', () => {
  const gameId = 'optional_accepted_no_double_may';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('does not queue a second you-may option_choice when optionalOfferAccepted', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game as any).gameId = gameId;

    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'hand-1', name: 'Island', type_line: 'Basic Land — Island', zone: 'hand' }],
        handCount: 1,
        library: [
          { id: 'lib-1', name: 'Drawn', type_line: 'Instant', zone: 'library' },
          { id: 'lib-2', name: 'Spare', type_line: 'Instant', zone: 'library' },
        ],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [...(game.state as any).zones[p1].hand];
    player.library = [...(game.state as any).zones[p1].library];
    (game as any).libraries = new Map([[p1, [...player.library]]]);

    const effectText = 'you may draw a card. If you do, discard a card.';
    const steps = collectOracleEffectSteps(effectText, 'Baral, Chief of Compliance');
    expect(steps.length).toBeGreaterThan(0);

    const irCtx = {
      ...buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'baral',
        sourceName: 'Baral, Chief of Compliance',
        sourceObjectType: 'ability',
      }),
      optionalOfferAccepted: true,
    };

    const started = startOracleEffectProgramOnServer(game as any, {
      controller: p1,
      sourceName: 'Baral, Chief of Compliance',
      sourceId: 'baral',
      steps,
      irCtx: irCtx as any,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'trigger:baral',
      metadata: {
        family: 'triggered_ability',
        triggerItem: { optionalTriggeredAbilityDecisionApplied: true },
      },
    });

    expect(started.handled).toBe(true);

    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const mayPrompt = pending.find((step: any) =>
      step.type === ResolutionStepType.OPTION_CHOICE
      && /you may draw a card/i.test(String(step.description || ''))
    );
    expect(mayPrompt).toBeUndefined();

    const discardPrompt = pending.find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION);
    const hand = (game.state as any).zones?.[p1]?.hand || [];
    expect(Boolean(discardPrompt) || hand.some((card: any) => String(card?.id || '') === 'lib-1')).toBe(true);
  });
});
