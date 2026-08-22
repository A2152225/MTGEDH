import { describe, expect, it } from 'vitest';
import { passPriority } from '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/ResolutionQueueManager.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  const gameId = String(overrides.gameId || 'game_declare_attackers_stack');
  ResolutionQueueManager.clearQueue?.(gameId);
  const state: any = {
    players: [
      { id: 'p1', seat: 0 },
      { id: 'p2', seat: 1 },
    ],
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'combat',
    step: 'DECLARE_ATTACKERS',
    stack: overrides.stack ?? [],
    battlefield: overrides.battlefield ?? [
      {
        id: 'c1',
        controller: 'p1',
        tapped: false,
        card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ],
    attackersDeclaredBy: [],
    ...overrides.state,
  };
  return {
    gameId,
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

describe('passPriority during DECLARE_ATTACKERS', () => {
  it('blocks the turn player when the stack is empty and attackers are undeclared', () => {
    const ctx = makeCtx({ stack: [] });
    const result = passPriority(ctx, 'p1' as any, true);
    expect(result.changed).toBe(false);
  });

  it('allows the turn player to pass when the stack is non-empty so abilities can resolve', () => {
    const ctx = makeCtx({
      stack: [{
        id: 'equip_ability_1',
        type: 'ability',
        controller: 'p1',
        source: 'sword_1',
        abilityType: 'equip',
      }],
    });
    const result = passPriority(ctx, 'p1' as any, true);
    expect(result.changed).toBe(true);
  });
});
