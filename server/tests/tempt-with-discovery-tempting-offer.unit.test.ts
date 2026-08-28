import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const TEMPT_WITH_DISCOVERY_ORACLE =
  'Tempting offer — Search your library for a land card and put it onto the battlefield. Each opponent may search their library for a land card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.';

describe('Tempt with Discovery Tempting Offer via Oracle IR', () => {
  const gameId = 'tempt_with_discovery_offer';
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const p3 = 'p3' as PlayerID;
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
    game.applyEvent!({ type: 'join', playerId: p1, name: 'AI' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'Human' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'Human2' } as any);

    const makeLibrary = (prefix: string) => [
      { id: `${prefix}-forest-0`, name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: `${prefix}-forest-1`, name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: `${prefix}-bear`, name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'library' },
    ];

    for (const playerId of [p1, p2, p3]) {
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
      [p1, p2, p3].map((playerId) => {
        const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
        return [playerId, player.library.map((card: any) => ({ ...card }))];
      }),
    );
    return game;
  }

  it('parses tempting_offer before any search_library', () => {
    const ir = parseOracleTextToIR(TEMPT_WITH_DISCOVERY_ORACLE, 'Tempt with Discovery');
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []);
    expect(steps[0]?.kind).toBe('tempting_offer');
  });

  it('queues TEMPTING_OFFER for each opponent, not a caster-only library search', () => {
    const game = seedGame();
    const ctx = game as any;

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Tempt with Discovery',
      oracleText: TEMPT_WITH_DISCOVERY_ORACLE,
      sourceId: 'tempt-discovery-1',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const offerSteps = queue.steps.filter((step: any) => step.type === ResolutionStepType.TEMPTING_OFFER);

    expect(outcome.handled).toBe(true);
    expect(offerSteps).toHaveLength(2);
    expect(offerSteps.map((step: any) => step.playerId).sort()).toEqual([p2, p3].sort());
    expect(offerSteps.every((step: any) => step.initiator === p1)).toBe(true);
    expect(queue.steps.some((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH)).toBe(false);
  });
});
