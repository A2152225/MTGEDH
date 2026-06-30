import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { playLand } from '../src/state/modules/stackPlayLandUtils.js';
import {
  parseLandWouldEnterNamedSacrificeReplacement,
  parseLandWouldEnterSacrificeReplacement,
  parseWouldEnterDiscardLandFromHandReplacement,
  hasWouldEnterDiscardLandReplacement,
  queueWouldEnterDiscardLandChoiceForStackItem,
  resolveLandWouldEnterSacrificeChoice,
  resolveWouldEnterDiscardLandChoice,
} from '../src/state/modules/land-would-enter-replacement.js';
import type { PlayerID } from '../../shared/src';

const LOTUS_VALE_ORACLE =
  "If this land would enter, sacrifice two untapped lands instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add three mana of any one color.";

function setupLotusValeGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

  (game.state as any).battlefield = [
    {
      id: 'land_a',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { id: 'plains_a', name: 'Plains', type_line: 'Basic Land — Plains' },
    },
    {
      id: 'land_b',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { id: 'forest_b', name: 'Forest', type_line: 'Basic Land — Forest' },
    },
  ];

  (game.state as any).zones = {
    [p1]: {
      hand: [
        {
          id: 'lotus_vale_1',
          name: 'Lotus Vale',
          type_line: 'Land',
          oracle_text: LOTUS_VALE_ORACLE,
        },
      ],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
    },
  };

  return { game, p1 };
}

describe('Land would-enter sacrifice replacement (Lotus Vale)', () => {
  it('defers battlefield entry and queues sacrifice choice', () => {
    const gameId = 'test_lotus_vale_defer';
    const { game, p1 } = setupLotusValeGame(gameId);
    ResolutionQueueManager.removeQueue(gameId);

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
    } as any;

    playLand(ctx, p1, 'lotus_vale_1');

    expect((game.state as any).battlefield).toHaveLength(2);
    expect((game.state as any).zones?.[p1]?.hand).toHaveLength(0);
    expect(game.state.landsPlayedThisTurn?.[p1]).toBe(1);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const choiceStep = steps.find((step: any) => step.landWouldEnterSacrificeChoice === true) as any;
    expect(choiceStep).toBeTruthy();
    expect(choiceStep.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(choiceStep.sacrificeCount).toBe(2);
    expect(choiceStep.options?.some((option: any) => option.id === 'land_a')).toBe(true);
    expect(choiceStep.options?.some((option: any) => option.id === 'land_b')).toBe(true);
    expect(choiceStep.options?.some((option: any) => option.id === 'decline_land_would_enter')).toBe(true);
  });

  it('enters the battlefield after sacrificing two untapped lands', () => {
    const gameId = 'test_lotus_vale_accept';
    const { game, p1 } = setupLotusValeGame(gameId);
    ResolutionQueueManager.removeQueue(gameId);

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
    } as any;

    playLand(ctx, p1, 'lotus_vale_1');

    const resolved = resolveLandWouldEnterSacrificeChoice(ctx, p1, ['land_a', 'land_b'], false);
    expect(resolved).toBe(true);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.name).toBe('Lotus Vale');
    const graveyard = (game.state as any).zones?.[p1]?.graveyard || [];
    expect(graveyard.map((card: any) => card.id)).toEqual(['plains_a', 'forest_b']);
  });

  it('puts the land into the graveyard when the player declines', () => {
    const gameId = 'test_lotus_vale_decline';
    const { game, p1 } = setupLotusValeGame(gameId);
    ResolutionQueueManager.removeQueue(gameId);

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
    } as any;

    playLand(ctx, p1, 'lotus_vale_1');

    const resolved = resolveLandWouldEnterSacrificeChoice(ctx, p1, ['decline_land_would_enter'], false);
    expect(resolved).toBe(true);

    expect((game.state as any).battlefield).toHaveLength(2);
    const graveyard = (game.state as any).zones?.[p1]?.graveyard || [];
    expect(graveyard).toHaveLength(1);
    expect(graveyard[0]?.name).toBe('Lotus Vale');
  });
});

const SHELTERED_VALLEY_ORACLE =
  "If this land would enter, instead sacrifice each other permanent named Sheltered Valley you control, then put this land onto the battlefield.\nAt the beginning of your upkeep, if you control three or fewer lands, you gain 1 life.\n{T}: Add {C}.";
describe('Would-enter discard land from hand (Mox Diamond pattern)', () => {
  const GENERIC_ARTIFACT_ORACLE =
    "If this artifact would enter the battlefield, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.";

  it('parses generic artifact discard-land replacement text', () => {
    expect(parseWouldEnterDiscardLandFromHandReplacement(GENERIC_ARTIFACT_ORACLE)).toBe(true);
    expect(hasWouldEnterDiscardLandReplacement({ oracle_text: GENERIC_ARTIFACT_ORACLE })).toBe(true);
  });

  it('queues discard choice and resolves accept through shared module', () => {
    const gameId = 'test_would_enter_discard_land';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (game.state as any).stack = [
      {
        id: 'stack_artifact_1',
        controller: p1,
        card: {
          id: 'gem_1',
          name: 'Test Relic',
          type_line: 'Artifact',
          oracle_text: GENERIC_ARTIFACT_ORACLE,
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
    } as any;

    expect(queueWouldEnterDiscardLandChoiceForStackItem(ctx, (game.state as any).stack[0])).toBe(true);

    const resolved = resolveWouldEnterDiscardLandChoice(ctx, p1, 'stack_artifact_1', 'plains_1', false);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.cardName).toBe('Test Relic');
      expect(resolved.discardedLandName).toBe('Plains');
    }

    expect((game.state as any).battlefield).toHaveLength(1);
    expect((game.state as any).battlefield[0]?.card?.name).toBe('Test Relic');
    expect((game.state as any).zones?.[p1]?.graveyard?.[0]?.name).toBe('Plains');
  });
});

describe('Land would-enter named sacrifice replacement (Sheltered Valley)', () => {
  it('parses the named-sacrifice replacement pattern', () => {
    expect(parseLandWouldEnterNamedSacrificeReplacement(SHELTERED_VALLEY_ORACLE)).toBe(true);
    expect(parseLandWouldEnterSacrificeReplacement(SHELTERED_VALLEY_ORACLE)).toBeNull();
  });

  it('enters immediately when no other copy is on the battlefield', () => {
    const gameId = 'test_sheltered_valley_solo';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'sheltered_valley_1',
            name: 'Sheltered Valley',
            type_line: 'Land',
            oracle_text: SHELTERED_VALLEY_ORACLE,
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).battlefield = [];

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
    } as any;

    playLand(ctx, p1, 'sheltered_valley_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.name).toBe('Sheltered Valley');
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('sacrifices other copies with the same name before entering', () => {
    const gameId = 'test_sheltered_valley_sacrifice';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (game.state as any).battlefield = [
      {
        id: 'sv_perm_old',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'sheltered_valley_old',
          name: 'Sheltered Valley',
          type_line: 'Land',
          oracle_text: SHELTERED_VALLEY_ORACLE,
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'sheltered_valley_new',
            name: 'Sheltered Valley',
            type_line: 'Land',
            oracle_text: SHELTERED_VALLEY_ORACLE,
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => game.bumpSeq?.(),
      gameId,
    } as any;

    playLand(ctx, p1, 'sheltered_valley_new');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.id).toBe('sheltered_valley_new');

    const graveyard = (game.state as any).zones?.[p1]?.graveyard || [];
    expect(graveyard.map((card: any) => card.id)).toEqual(['sheltered_valley_old']);
  });
});
