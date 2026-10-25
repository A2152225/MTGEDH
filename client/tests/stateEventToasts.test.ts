import { describe, it, expect } from 'vitest';
import { describeDieRoll, collectStateEventToasts, createStateEventTracker } from '../src/utils/stateEventToasts';
import { getPermanentRulesStatusChips } from '../src/components/PermanentRulesStatusBadges';

const players = [{ id: 'p1', name: 'Alice' }];

describe('die roll text', () => {
  it('plain roll', () => expect(describeDieRoll({ sides: 6, result: 4 }, 'Alice')).toBe('Alice rolled a d6: 4'));
  it('marks dropped dice once each', () => {
    expect(describeDieRoll({ sides: 20, result: 17, rolls: [4, 17, 4], ignored: [4, 4] }, 'Alice'))
      .toBe('Alice rolled 3d20: 4 (dropped), 17, 4 (dropped) \u2192 17');
  });
});

describe('state event toasts', () => {
  it('seeds silently then toasts only new entries', () => {
    const tr = createStateEventTracker();
    const base = { id: 'g', players, lastDieRoll: { playerId: 'p1', sides: 6, result: 2, timestamp: 1 },
      skippedExtraTurns: [{ playerId: 'p1', sourceName: 'Stranglehold', timestamp: 1 }], regenerationLog: [] as any[] };
    expect(collectStateEventToasts(tr, base)).toEqual([]);
    const next = { ...base, lastDieRoll: { playerId: 'p1', sides: 20, result: 9, rolls: [9, 3], ignored: [3], timestamp: 2 },
      skippedExtraTurns: [...base.skippedExtraTurns, { playerId: 'p1', sourceName: 'Ugin\'s Nexus', timestamp: 5 }],
      regenerationLog: [{ permanentId: 'x', cardName: 'Troll', timestamp: 6 }] };
    expect(collectStateEventToasts(tr, next)).toEqual([
      'Alice rolled 2d20: 9, 3 (dropped) \u2192 9',
      "Alice's extra turn was skipped (Ugin's Nexus).",
      'Troll regenerated (tapped, removed from combat).',
    ]);
    expect(collectStateEventToasts(tr, next)).toEqual([]);
  });
  it('a new game reseeds', () => {
    const tr = createStateEventTracker();
    collectStateEventToasts(tr, { id: 'a' });
    expect(collectStateEventToasts(tr, { id: 'b', regenerationLog: [{ permanentId: 'x', timestamp: 1 }] })).toEqual([]);
  });
});

describe('chips', () => {
  it('regenerated and defender-attack chips', () => {
    const keys = getPermanentRulesStatusChips({ regeneratedThisTurn: true, temporaryEffects: [{ description: "can attack this turn as though it didn't have defender" }] }).map(c => c.key);
    expect(keys).toEqual(expect.arrayContaining(['regen', 'nodefender']));
    expect(getPermanentRulesStatusChips({ temporaryEffects: [{ description: 'gets +1/+1' }] })).toEqual([]);
  });
});
