import { describe, expect, it } from 'vitest';
import { queueParsedAttacksUnblockedTriggersOnce, claimAttacksUnblockedEmission } from '../src/state/modules/triggers/combatBlockedIrTriggers.js';

function baseState(battlefield: any[]) {
  return { players: [{ id: 'p1' }, { id: 'p2' }], activePlayer: 'p1', turnPlayer: 'p1', turnNumber: 3, battlefield, stack: [] as any[] };
}

describe('attacks_unblocked on auto-skipped block declarations', () => {
  const watcher = { id: 'w', controller: 'p1', owner: 'p1', card: { id: 'wc', name: 'Unblocked Watcher', type_line: 'Creature', oracle_text: 'Whenever a creature you control attacks and isn\'t blocked, draw a card.' } };
  const attacker = { id: 'a', controller: 'p1', owner: 'p1', attacking: 'p2', card: { id: 'ac', name: 'Bear', type_line: 'Creature - Bear', oracle_text: '' } };

  it('fires once and the shared guard blocks a second emission', () => {
    const ctx: any = { gameId: 'unknown', isReplaying: false, state: baseState([watcher, { ...attacker }]) };
    const first = queueParsedAttacksUnblockedTriggersOnce(ctx, 'p2');
    expect(first).toBe(1);
    expect(ctx.state.stack.filter((s: any) => s.type === 'triggered_ability')).toHaveLength(1);
    expect(queueParsedAttacksUnblockedTriggersOnce(ctx, 'p2')).toBe(0);
    // declare-blockers handler path is gated by the same claim
    expect(claimAttacksUnblockedEmission(ctx.state, 'p2')).toBe(false);
    expect(ctx.state.stack).toHaveLength(1);
  });

  it('does nothing while replaying', () => {
    const ctx: any = { gameId: 'unknown', isReplaying: true, state: baseState([watcher, { ...attacker }]) };
    expect(queueParsedAttacksUnblockedTriggersOnce(ctx, 'p2')).toBe(0);
  });
});

// Crime triggers moved to Oracle IR commits_crime: see trigger-ir-round6.regression.test.ts.
