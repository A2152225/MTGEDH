import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const SUMMARY_DISMISSAL_ORACLE = 'Exile all other spells and counter all abilities.';

describe('Summary Dismissal live stack resolve', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('exiles other spells and counters abilities when it actually resolves', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const gameId = 'test_summary_dismissal_resolve';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40, hand: [], library: [], graveyard: [], exile: [] },
      { id: p2, name: 'P2', life: 40, hand: [], library: [], graveyard: [], exile: [] },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    };
    (game.state as any).stack = [
      {
        id: 'stack_warp_1',
        type: 'spell',
        controller: p2,
        owner: p2,
        card: { id: 'warp_world_1', name: 'Warp World', type_line: 'Sorcery' },
      },
      {
        id: 'stack_warp_copy_1',
        type: 'spell',
        controller: p1,
        owner: p2,
        isCopy: true,
        card: { id: 'warp_world_copy_1', name: 'Warp World', type_line: 'Sorcery' },
      },
      {
        id: 'stack_hive_1',
        type: 'triggered_ability',
        controller: p1,
        sourceName: 'Hive Mind',
        description: 'Whenever a player casts an instant or sorcery spell, each other player copies that spell.',
      },
      {
        id: 'stack_summary_1',
        type: 'spell',
        controller: p1,
        owner: p1,
        targets: ['stack_warp_1'],
        card: {
          id: 'summary_1',
          name: 'Summary Dismissal',
          type_line: 'Instant',
          oracle_text: SUMMARY_DISMISSAL_ORACLE,
        },
      },
    ];
    (game as any).gameId = gameId;

    resolveTopOfStack(game as any);

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(stack.map((item: any) => item.id)).toEqual([]);
    const p2Player = (game.state as any).players.find((player: any) => player.id === p2);
    const p2Exile = [
      ...(p2Player?.exile || []),
      ...((game.state as any).zones?.[p2]?.exile || []),
    ];
    expect(p2Exile.map((card: any) => card.id)).toEqual(
      expect.arrayContaining(['warp_world_1', 'warp_world_copy_1']),
    );
    expect((game.state as any).zones?.[p1]?.graveyard || []).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'summary_1' })]),
    );
  });
});
