import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const ARCHIVE_TRAP_ORACLE =
  "If an opponent searched their library this turn, you may pay {0} rather than pay this spell's mana cost.\nTarget opponent mills thirteen cards.";

describe('Archive Trap live stack resolve', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('mills thirteen from the targeted opponent', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const gameId = 'test_archive_trap_resolve';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent({ type: 'join', playerId: p3, name: 'P3' } as any);

    const makeLibrary = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}_${i}`,
        name: `${prefix} ${i}`,
        type_line: 'Instant',
        zone: 'library',
      }));

    const p2Library = makeLibrary('p2', 15);
    const p3Library = makeLibrary('p3', 15);

    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40, hand: [], library: [], graveyard: [], exile: [] },
      { id: p2, name: 'P2', life: 40, hand: [], library: [...p2Library], graveyard: [], exile: [] },
      { id: p3, name: 'P3', life: 40, hand: [], library: [...p3Library], graveyard: [], exile: [] },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [...p2Library], libraryCount: 15 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [...p3Library], libraryCount: 15 },
    };
    (game as any).libraries = new Map([
      [p2, [...p2Library]],
      [p3, [...p3Library]],
    ]);
    (game.state as any).stack = [
      {
        id: 'stack_archive_1',
        type: 'spell',
        controller: p1,
        owner: p1,
        targets: [p3],
        targetPlayerId: p3,
        card: {
          id: 'archive_1',
          name: 'Archive Trap',
          type_line: 'Instant — Trap',
          oracle_text: ARCHIVE_TRAP_ORACLE,
        },
      },
    ];
    (game as any).gameId = gameId;

    resolveTopOfStack(game as any);

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(stack.map((item: any) => item.id)).toEqual([]);

    const gyOf = (playerId: PlayerID) => {
      const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
      const fromPlayer = Array.isArray(player?.graveyard) ? player.graveyard : [];
      if (fromPlayer.length > 0) return fromPlayer;
      return Array.isArray((game.state as any).zones?.[playerId]?.graveyard)
        ? (game.state as any).zones[playerId].graveyard
        : [];
    };
    const libCount = (playerId: PlayerID) => {
      const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
      if (Array.isArray(player?.library) && player.library.length > 0) return player.library.length;
      const fromZones = (game.state as any).zones?.[playerId]?.library;
      if (Array.isArray(fromZones) && fromZones.length > 0) return fromZones.length;
      const fromMap = (game as any).libraries?.get(playerId);
      return Array.isArray(fromMap) ? fromMap.length : 0;
    };

    expect(gyOf(p3).map((card: any) => card.id)).toHaveLength(13);
    expect(gyOf(p2)).toHaveLength(0);
    expect(libCount(p3)).toBe(2);
    expect(libCount(p2)).toBe(15);
  });
});
