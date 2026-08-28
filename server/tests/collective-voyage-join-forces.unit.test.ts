import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { maybeResumeOracleIRStepsAfterResolution } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const COLLECTIVE_VOYAGE_ORACLE =
  'Join forces — Starting with you, each player may pay any amount of mana. Each player searches their library for up to X basic land cards, where X is the total amount of mana paid this way, puts them onto the battlefield tapped, then shuffles.';

describe('Collective Voyage Join Forces via Oracle IR', () => {
  const gameId = 'collective_voyage_join_forces';
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

    const makeLibrary = (prefix: string) => [
      { id: `${prefix}-forest-0`, name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: `${prefix}-forest-1`, name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: `${prefix}-bear`, name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'library' },
    ];

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

  it('parses join_forces before the paid-this-way basic-land search', () => {
    const ir = parseOracleTextToIR(COLLECTIVE_VOYAGE_ORACLE, 'Collective Voyage');
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []);
    expect(steps.map((step: any) => step.kind)).toEqual(['join_forces', 'search_library']);
    expect(steps[1]).toMatchObject({
      kind: 'search_library',
      who: { kind: 'each_player' },
      destination: 'battlefield',
      entersTapped: true,
    });
  });

  it('queues JOIN_FORCES with search_library resume metadata', () => {
    const game = seedGame();
    const ctx = game as any;

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Collective Voyage',
      oracleText: COLLECTIVE_VOYAGE_ORACLE,
      sourceId: 'collective-voyage-1',
      xValue: 0,
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const joinSteps = queue.steps.filter((step: any) => step.type === ResolutionStepType.JOIN_FORCES);

    expect(outcome.handled).toBe(true);
    expect(joinSteps).toHaveLength(2);
    expect(String(joinSteps[0]?.oracleIrResumeStepsJson || '')).toMatch(/"kind":"search_library"/);
    expect(queue.steps.some((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH)).toBe(false);
  });

  it('resumes the join-forces total as per-player LIBRARY_SEARCH, not auto-ETB', () => {
    const game = seedGame();
    const ctx = game as any;
    tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Collective Voyage',
      oracleText: COLLECTIVE_VOYAGE_ORACLE,
      sourceId: 'collective-voyage-1',
      xValue: 0,
    });

    const joinStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.JOIN_FORCES,
    );
    expect(joinStep).toBeTruthy();

    const resumeResult = maybeResumeOracleIRStepsAfterResolution(ctx, {
      ...joinStep,
      oracleIrXValue: 2,
    });

    expect(resumeResult).toBeTruthy();
    expect((resumeResult!.automationGaps || []).some(
      (gap: any) => gap.classification === 'player_choice' && gap.stepKind === 'search_library',
    )).toBe(true);

    const searches = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH,
    );
    expect(searches).toHaveLength(2);
    expect(searches.map((step: any) => step.playerId).sort()).toEqual([p1, p2].sort());
    expect(searches.every((step: any) => step.maxSelections === 2)).toBe(true);
    expect(searches.every((step: any) => step.destination === 'battlefield')).toBe(true);
    expect(searches.every((step: any) => step.entersTapped === true)).toBe(true);
    expect((game.state as any).battlefield || []).toHaveLength(0);
  });
});
