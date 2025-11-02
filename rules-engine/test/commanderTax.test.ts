import { describe, it, expect } from 'vitest';
import type { GameState, PlayerRef, PlayerID } from '../../shared/src';
import { applyCommanderTax } from '../src/commander';

function mkState(): GameState {
  const p1: PlayerRef = { id: 'p1' as PlayerID, name: 'A', seat: 0 };
  return {
    id: 'g1',
    format: 'commander',
    players: [p1],
    startingLife: 40,
    life: { p1: 40 },
    turnPlayer: 'p1' as PlayerID,
    priority: 'p1' as PlayerID,
    stack: [],
    battlefield: [],
    commandZone: { p1: { commanderIds: ['c1'], tax: 0 } },
    phase: 'begin',
    active: true
  };
}

describe('commander tax', () => {
  it('increments by 2 each time', () => {
    const s1 = mkState();
    const s2 = applyCommanderTax(s1, 'p1' as PlayerID, 'c1');
    expect(s2.commandZone['p1'].tax).toBe(2);
    const s3 = applyCommanderTax(s2, 'p1' as PlayerID, 'c1');
    expect(s3.commandZone['p1'].tax).toBe(4);
    // original immutable
    expect(s1.commandZone['p1'].tax).toBe(0);
  });
});