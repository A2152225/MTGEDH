import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const EMERIA_EFFECT =
  'if you control seven or more Plains, you may return target creature card from your graveyard to the battlefield';

describe('Emeria, the Sky Ruin upkeep reanimate', () => {
  const gameId = 'emeria_sky_ruin_upkeep_reanimate';
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

    const gyCreatures = [
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
        name: 'Serra Angel',
        type_line: 'Creature — Angel',
        oracle_text: 'Flying, vigilance',
        power: '4',
        toughness: '4',
        zone: 'graveyard',
      },
    ];
    const gyLand = {
      id: 'gy-land-1',
      name: 'Plains',
      type_line: 'Basic Land — Plains',
      oracle_text: '{T}: Add {W}.',
      zone: 'graveyard',
    };
    const graveyard = [...gyCreatures, gyLand];

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

    const plains = Array.from({ length: 7 }, (_, index) => ({
      id: `plains-${index}`,
      controller: p1,
      owner: p1,
      card: {
        id: `plains-card-${index}`,
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '{T}: Add {W}.',
      },
    }));
    (game.state as any).battlefield = [
      {
        id: 'emeria-1',
        controller: p1,
        owner: p1,
        card: {
          id: 'emeria-card',
          name: 'Emeria, the Sky Ruin',
          type_line: 'Land',
          oracle_text:
            'Emeria, the Sky Ruin enters tapped.\n' +
            'At the beginning of your upkeep, if you control seven or more Plains, you may return target creature card from your graveyard to the battlefield.\n' +
            '{T}: Add {W}.',
        },
      },
      ...plains,
    ];
    (game as any).gameId = gameId;
    return game;
  }

  function executeAcceptedEmeriaTrigger(game: ReturnType<typeof seedGame>) {
    executeTriggerEffect(
      game as any,
      p1,
      'Emeria, the Sky Ruin',
      EMERIA_EFFECT,
      {
        id: 'emeria_upkeep',
        source: 'emeria-1',
        sourceId: 'emeria-1',
        permanentId: 'emeria-1',
        triggerType: 'upkeep',
        interveningIfSubjectPermanentId: 'emeria-1',
        optionalTriggeredAbilityDecisionApplied: true,
        effect: EMERIA_EFFECT,
        description: EMERIA_EFFECT,
      },
    );
  }

  it('queues a graveyard creature pick after the optional trigger is accepted', () => {
    const game = seedGame();
    executeAcceptedEmeriaTrigger(game);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH || entry.type === ResolutionStepType.GRAVEYARD_SELECTION,
    ) as any;
    expect(searchStep).toBeTruthy();
    expect(searchStep.destination).toBe('battlefield');
    expect(searchStep.searchZone === 'graveyard' || searchStep.type === ResolutionStepType.GRAVEYARD_SELECTION).toBe(true);
    const availableIds = (searchStep.availableCards || searchStep.validTargets || [])
      .map((card: any) => String(card?.id || ''))
      .filter(Boolean);
    expect(availableIds).toContain('gy-creature-1');
    expect(availableIds).toContain('gy-creature-2');
    expect(availableIds).not.toContain('gy-land-1');
  });

  it('puts the chosen graveyard creature onto the battlefield and does not re-queue the search', () => {
    const game = seedGame();
    executeAcceptedEmeriaTrigger(game);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH || entry.type === ResolutionStepType.GRAVEYARD_SELECTION,
    ) as any;
    expect(searchStep).toBeTruthy();

    const completed = ResolutionQueueManager.completeStep(gameId, String(searchStep.id), {
      stepId: String(searchStep.id),
      playerId: p1,
      selections: ['gy-creature-1'],
      cancelled: false,
      timestamp: Date.now(),
    });
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(game as any, completed, completed!.response!);
    expect(resumed?.appliedSteps?.some((entry) => entry.kind === 'move_zone')).toBe(true);

    const names = ((game.state as any).battlefield || []).map((perm: any) => perm?.card?.name);
    expect(names).toContain('Grizzly Bears');
    const gyIds = ((game.state as any).zones?.[p1]?.graveyard || []).map((card: any) => card.id);
    expect(gyIds).not.toContain('gy-creature-1');

    const leftover = ResolutionQueueManager.getStepsForPlayer(gameId, p1).filter(
      (entry) =>
        (entry.type === ResolutionStepType.LIBRARY_SEARCH || entry.type === ResolutionStepType.GRAVEYARD_SELECTION)
        && String(entry.status || '').toLowerCase() !== 'completed'
        && String(entry.status || '').toLowerCase() !== 'cancelled',
    );
    expect(leftover).toHaveLength(0);
  });
});
