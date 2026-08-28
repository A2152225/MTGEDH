import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { queuePermanentEntersBattlefieldTriggerStackItems } from '../src/state/modules/stackResolvePermanentEtbTriggerUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const GHALTA_ORACLE =
  'Trample\nWhen Ghalta enters, put any number of creature cards from your hand onto the battlefield.';
const GHALTA_THIS_CREATURE_ORACLE =
  'Trample\nWhen this creature enters, put any number of creature cards from your hand onto the battlefield.';
const SAVAGE_ORDER_EFFECT =
  'Search your library for a Dinosaur creature card, put it onto the battlefield, then shuffle. It gains indestructible until your next turn.';

describe('Ghalta, Stampede Tyrant ETB — any-number creatures from hand', () => {
  const gameId = 'ghalta_stampede_tyrant_etb';
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

    const handCards = [
      { id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'hand' },
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', zone: 'hand' },
      { id: 'elf-1', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'hand' },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: handCards,
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = handCards.map((card) => ({ ...card }));
    (game.state as any).battlefield = [{
      id: 'ghalta-1',
      controller: p1,
      owner: p1,
      card: {
        id: 'ghalta-card',
        name: 'Ghalta, Stampede Tyrant',
        type_line: 'Legendary Creature — Elder Dinosaur',
        oracle_text: GHALTA_ORACLE,
      },
    }];
    (game as any).gameId = gameId;
    return game;
  }

  it('detects the self-ETB for both named and this-creature templates', () => {
    const named = detectETBTriggers({
      name: 'Ghalta, Stampede Tyrant',
      oracle_text: GHALTA_ORACLE,
    }, { id: 'ghalta-1' });
    const templated = detectETBTriggers({
      name: 'Ghalta, Stampede Tyrant',
      oracle_text: GHALTA_THIS_CREATURE_ORACLE,
    }, { id: 'ghalta-1' });

    expect(named.some((trigger) => trigger.triggerType === 'etb')).toBe(true);
    expect(String(named.find((trigger) => trigger.triggerType === 'etb')?.effect || '')).toMatch(
      /put any number of creature cards from your hand onto the battlefield/i,
    );
    expect(templated.some((trigger) => trigger.triggerType === 'etb')).toBe(true);
  });

  it('queues a from-hand library-search prompt instead of auto-putting creatures', () => {
    const game = seedGame();
    const ir = parseOracleTextToIR(GHALTA_ORACLE, 'Ghalta, Stampede Tyrant');
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'move_zone',
    );
    expect(step).toBeTruthy();

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'ghalta-1',
      sourceName: 'Ghalta, Stampede Tyrant',
    });
    applyOracleIRStepsOnServer(game as any, game.state as any, [step!], irCtx, { allowOptional: false }, { controller: p1 });

    expect((game.state as any).players[0].hand.map((card: any) => card.id)).toEqual(['bear-1', 'bolt-1', 'elf-1']);
    expect((game.state as any).battlefield.filter((perm: any) => perm?.id !== 'ghalta-1')).toHaveLength(0);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any;
    expect(searchStep).toBeTruthy();
    expect(searchStep.minSelections).toBe(0);
    expect(searchStep.maxSelections).toBe(2);
    expect(searchStep.destination).toBe('battlefield');
    expect(searchStep.remainderDestination).toBe('none');
    expect(searchStep.searchZone).toBe('hand');
    expect((searchStep.availableCards || []).map((card: any) => card.id).sort()).toEqual(['bear-1', 'elf-1']);
  });

  it('queues the hand prompt from the ETB trigger effect', () => {
    const game = seedGame();
    executeTriggerEffect(
      game as any,
      p1,
      'Ghalta, Stampede Tyrant',
      'put any number of creature cards from your hand onto the battlefield',
      {
        id: 'ghalta_etb',
        source: 'ghalta-1',
        sourceId: 'ghalta-1',
        permanentId: 'ghalta-1',
        triggerType: 'etb',
        interveningIfSubjectPermanentId: 'ghalta-1',
      },
    );

    expect((game.state as any).players[0].hand.map((card: any) => card.id)).toEqual(['bear-1', 'bolt-1', 'elf-1']);
    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any;
    expect(searchStep).toBeTruthy();
    expect(searchStep.minSelections).toBe(0);
    expect(searchStep.maxSelections).toBe(2);
    expect(searchStep.destination).toBe('battlefield');
  });

  it('queues the self-ETB from the live creature-spell path', () => {
    const game = seedGame();
    const ghalta = (game.state as any).battlefield.find((perm: any) => perm.id === 'ghalta-1');
    queuePermanentEntersBattlefieldTriggerStackItems(game as any, {
      controller: p1,
      card: ghalta.card,
      effectiveCard: ghalta.card,
      newPermanent: ghalta,
      newPermId: ghalta.id,
      isCreature: true,
    });
    const stacked = ((game.state as any).stack || []).find(
      (item: any) => item?.sourceName === 'Ghalta, Stampede Tyrant' && item?.triggerType === 'etb',
    );
    expect(stacked).toBeTruthy();
    expect(String(stacked?.effect || '')).toMatch(/put any number of creature cards from your hand/i);
  });

  it('puts every selected hand creature onto the battlefield when the ETB prompt confirms', () => {
    const game = seedGame();
    const ir = parseOracleTextToIR(GHALTA_ORACLE, 'Ghalta, Stampede Tyrant');
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'move_zone',
    );
    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'ghalta-1',
      sourceName: 'Ghalta, Stampede Tyrant',
    });
    applyOracleIRStepsOnServer(game as any, game.state as any, [step!], irCtx, { allowOptional: false }, { controller: p1 });

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    );
    expect(searchStep).toBeTruthy();

    const completed = ResolutionQueueManager.completeStep(gameId, String(searchStep!.id), {
      stepId: String(searchStep!.id),
      playerId: p1,
      selections: ['bear-1', 'elf-1'],
      cancelled: false,
      timestamp: Date.now(),
    });
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(game as any, completed, completed!.response!);
    expect(resumed?.appliedSteps?.some((entry) => entry.kind === 'move_zone')).toBe(true);

    const names = ((game.state as any).battlefield || []).map((perm: any) => perm?.card?.name);
    expect(names).toEqual(expect.arrayContaining([
      'Ghalta, Stampede Tyrant',
      'Grizzly Bears',
      'Llanowar Elves',
    ]));
    expect((game.state as any).players[0].hand.map((card: any) => card.id)).toEqual(['bolt-1']);
  });

  it('queues Ghalta ETB after Savage Order puts it onto the battlefield from the library', () => {
    const game = createInitialGameState(gameId);
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ghaltaCard = {
      id: 'ghalta-stampede',
      name: 'Ghalta, Stampede Tyrant',
      type_line: 'Legendary Creature — Elder Dinosaur',
      oracle_text: GHALTA_ORACLE,
      power: '12',
      toughness: '12',
      zone: 'library',
    };
    const library = [
      ghaltaCard,
      { id: 'bolt-lib', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
    ];
    const handCards = [
      { id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'hand' },
      { id: 'elf-1', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'hand' },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: handCards,
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
        library,
        libraryCount: library.length,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = handCards.map((card) => ({ ...card }));
    player.library = library.map((card) => ({ ...card }));
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game as any).gameId = gameId;
    (game as any).libraries = new Map([[p1, library.map((card) => ({ ...card }))]]);

    const ir = parseOracleTextToIR(SAVAGE_ORDER_EFFECT, 'Savage Order');
    const searchStep = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'search_library',
    );
    expect(searchStep).toBeTruthy();
    expect((searchStep as any).destination).toBe('battlefield');

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'savage-order-1',
      sourceName: 'Savage Order',
    });
    applyOracleIRStepsOnServer(game as any, game.state as any, [searchStep!], irCtx, { allowOptional: false }, { controller: p1 });

    const queued = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    );
    expect(queued).toBeTruthy();

    const completed = ResolutionQueueManager.completeStep(gameId, String(queued!.id), {
      stepId: String(queued!.id),
      playerId: p1,
      selections: ['ghalta-stampede'],
      cancelled: false,
      timestamp: Date.now(),
    });
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(game as any, completed, completed!.response!);
    expect(resumed?.appliedSteps?.some((entry) => entry.kind === 'search_library')).toBe(true);

    const ghalta = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Ghalta, Stampede Tyrant',
    );
    expect(ghalta).toBeTruthy();

    const stacked = ((game.state as any).stack || []).find(
      (item: any) => item?.sourceName === 'Ghalta, Stampede Tyrant' && item?.triggerType === 'etb',
    );
    expect(stacked).toBeTruthy();
    expect(String(stacked?.effect || '')).toMatch(/put any number of creature cards from your hand/i);
    expect(String(stacked?.interveningIfSubjectPermanentId || '')).toBe(String(ghalta.id));

    executeTriggerEffect(
      game as any,
      p1,
      String(stacked.sourceName),
      String(stacked.effect),
      stacked,
    );

    expect((game.state as any).players[0].hand.map((card: any) => card.id).sort()).toEqual(['bear-1', 'elf-1']);
    const handPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH && (entry as any).searchZone === 'hand',
    ) as any;
    expect(handPrompt).toBeTruthy();
    expect(handPrompt.minSelections).toBe(0);
    expect(handPrompt.maxSelections).toBe(2);
    expect((handPrompt.availableCards || []).map((card: any) => card.id).sort()).toEqual(['bear-1', 'elf-1']);
  });
});
