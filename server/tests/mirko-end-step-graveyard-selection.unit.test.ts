/**
 * Mirko-family end-step GY return must queue GRAVEYARD_SELECTION (not library_search).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { maybeApplyOracleIrChoiceStepFromResolution } from '../src/state/modules/oracleIrServerZoneSync.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const MIRKO_EFFECT =
  "you may return target creature card with power less than Mirko's from your graveyard to the battlefield with a finality counter on it.";

describe('Mirko end-step GY return prompt typing', () => {
  const gameId = 'mirko_end_step_gy_prompt_typing';
  const p1 = 'p1' as PlayerID;

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    ResolutionQueueManager.removeQueue(gameId);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  function seedGame() {
    const game = createInitialGameState(gameId);
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const graveyard = [
      {
        id: 'gy-creature-1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
        zone: 'graveyard',
      },
      {
        id: 'gy-creature-2',
        name: 'Memnite',
        type_line: 'Artifact Creature — Construct',
        oracle_text: '',
        power: '1',
        toughness: '1',
        zone: 'graveyard',
      },
      {
        id: 'gy-land-1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '',
        zone: 'graveyard',
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard,
        graveyardCount: graveyard.length,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.graveyard = graveyard.map((card) => ({ ...card }));
    (game.state as any).battlefield = [
      {
        id: 'mirko-1',
        controller: p1,
        owner: p1,
        power: 4,
        toughness: 6,
        counters: { '+1/+1': 3 },
        card: {
          id: 'mirko-card',
          name: 'Mirko, Obsessive Theorist',
          type_line: 'Legendary Creature — Vampire Detective',
          power: '1',
          toughness: '3',
          oracle_text:
            "Flying, vigilance\nWhenever you surveil, put a +1/+1 counter on Mirko.\nAt the beginning of your end step, you may return target creature card with power less than Mirko's from your graveyard to the battlefield with a finality counter on it.",
        },
      },
    ];
    (game as any).gameId = gameId;
    return game;
  }

  function executeAcceptedMirkoTrigger(game: ReturnType<typeof seedGame>) {
    executeTriggerEffect(
      game as any,
      p1,
      'Mirko, Obsessive Theorist',
      MIRKO_EFFECT,
      {
        id: 'mirko_end',
        source: 'mirko-1',
        sourceId: 'mirko-1',
        permanentId: 'mirko-1',
        triggerType: 'end_step',
        interveningIfSubjectPermanentId: 'mirko-1',
        optionalTriggeredAbilityDecisionApplied: true,
        effect: MIRKO_EFFECT,
        description: MIRKO_EFFECT,
      },
    );
  }

  it('queues GRAVEYARD_SELECTION for the optional GY return (not library_search)', () => {
    const game = seedGame();
    executeAcceptedMirkoTrigger(game);

    const gyStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.GRAVEYARD_SELECTION,
    ) as any;
    const libraryStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    );
    expect(gyStep).toBeTruthy();
    expect(libraryStep).toBeFalsy();
    expect(gyStep.destination).toBe('battlefield');
    const ids = (gyStep.validTargets || []).map((card: any) => String(card?.id || ''));
    expect(ids).toContain('gy-creature-1');
    expect(ids).toContain('gy-creature-2');
    expect(ids).not.toContain('gy-land-1');
  });

  it('applies the GY return through oracle-IR choice resume with a finality counter', () => {
    const game = seedGame();
    executeAcceptedMirkoTrigger(game);

    const gyStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.GRAVEYARD_SELECTION,
    ) as any;
    expect(gyStep).toBeTruthy();
    expect(String(gyStep.oracleIrChoiceStepJson || '')).toBeTruthy();

    const completed = ResolutionQueueManager.completeStep(gameId, String(gyStep.id), {
      stepId: String(gyStep.id),
      playerId: p1,
      selections: ['gy-creature-1'],
      cancelled: false,
      timestamp: Date.now(),
    });
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(game as any, completed, completed!.response!);
    expect(resumed?.appliedSteps?.some((entry) => entry.kind === 'move_zone')).toBe(true);

    const returned = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '') === 'Grizzly Bears',
    );
    expect(returned).toBeTruthy();
    expect((returned?.counters || {}).finality).toBe(1);
  });
});
