import { describe, expect, it } from 'vitest';

import { recalculatePlayerEffects } from '../src/state/modules/game-state-effects.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const TELEPATHY_ORACLE = 'Your opponents play with their hands revealed.';
const REVELATION_ORACLE = 'Players play with their hands revealed.';
const GLASSES_ORACLE = "{T}: Look at target player's hand.";
const CRUCIBLE_ORACLE = 'You may play lands from your graveyard.';

function ctxFor(battlefield: any[]) {
  return {
    state: {
      players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      battlefield,
    },
    handVisibilityGrants: new Map(),
  } as any;
}

function viewersOf(ctx: any, ownerId: string): string[] {
  return Array.from(ctx.handVisibilityGrants.get(ownerId) ?? []).sort();
}

describe('hand reveal is oracle-only (no HAND_REVEAL_CARDS table)', () => {
  it('grants Telepathy-style visibility from opponents-revealed oracle on an anonymous permanent', () => {
    const ctx = ctxFor([
      {
        id: 'fx1',
        controller: 'p1',
        card: { name: 'Fixture Opponents Revealed', oracle_text: TELEPATHY_ORACLE },
      },
    ]);
    recalculatePlayerEffects(ctx);
    expect(viewersOf(ctx, 'p2')).toEqual(['p1', 'p2', 'p3']);
    expect(viewersOf(ctx, 'p3')).toEqual(['p1', 'p2', 'p3']);
    expect(ctx.handVisibilityGrants.has('p1')).toBe(false);
  });

  it('grants the same visibility from each-player revealed oracle', () => {
    const ctx = ctxFor([
      {
        id: 'fx1',
        controller: 'p1',
        card: { name: 'Fixture All Hands Revealed', oracle_text: REVELATION_ORACLE },
      },
    ]);
    recalculatePlayerEffects(ctx);
    expect(viewersOf(ctx, 'p2')).toEqual(['p1', 'p2', 'p3']);
    expect(viewersOf(ctx, 'p3')).toEqual(['p1', 'p2', 'p3']);
  });

  it('does not treat look-at-hand activations as a static reveal', () => {
    const ctx = ctxFor([
      {
        id: 'fx1',
        controller: 'p1',
        card: { name: 'Glasses of Urza', oracle_text: GLASSES_ORACLE },
      },
    ]);
    recalculatePlayerEffects(ctx);
    expect(ctx.handVisibilityGrants.size).toBe(0);
  });

  it('does not grant visibility from leftover names without reveal oracle', () => {
    const ctx = ctxFor([
      {
        id: 'fx1',
        controller: 'p1',
        card: { name: 'Telepathy', oracle_text: CRUCIBLE_ORACLE },
      },
    ]);
    recalculatePlayerEffects(ctx);
    expect(ctx.handVisibilityGrants.size).toBe(0);
  });
});
