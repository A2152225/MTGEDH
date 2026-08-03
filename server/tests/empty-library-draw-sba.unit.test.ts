import { describe, expect, it } from 'vitest';
import { drawCards } from '../src/state/modules/zones.js';
import { runSBA } from '../src/state/modules/counters_tokens.js';

function makeCtx(overrides: {
  playerId?: string;
  libraryCards?: any[];
  cantLose?: boolean;
  labMan?: boolean;
} = {}) {
  const playerId = overrides.playerId || 'ai1';
  const libraryCards = overrides.libraryCards ?? [];
  const libraries = new Map<string, any[]>([[playerId, libraryCards.slice()]]);
  const state: any = {
    players: [{ id: playerId, hasLost: false, life: 40 }],
    life: { [playerId]: 40 },
    battlefield: [],
    zones: {
      [playerId]: {
        hand: [],
        handCount: 0,
        libraryCount: libraryCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    },
  };

  if (overrides.cantLose) {
    state.battlefield.push({
      id: 'angel',
      controller: playerId,
      card: {
        name: 'Platinum Angel',
        oracle_text: 'You can\'t lose the game and your opponents can\'t win the game.',
      },
    });
  }

  if (overrides.labMan) {
    state.battlefield.push({
      id: 'lab',
      controller: playerId,
      card: {
        name: 'Laboratory Maniac',
        oracle_text: 'If you would draw a card while your library has no cards in it, you win the game instead.',
      },
    });
  }

  return {
    state,
    libraries,
    bumpSeq: () => {},
  } as any;
}

describe('empty library draw (Rule 704.5b)', () => {
  it('marks the player as lost immediately on any mandatory empty draw', () => {
    const ctx = makeCtx({ libraryCards: [] });
    // Spell/ability forced draw — not draw step
    drawCards(ctx, 'ai1', 1);

    expect(ctx.state.players[0].hasLost).toBe(true);
    expect(String(ctx.state.players[0].lostReason || '')).toMatch(/empty library/i);
  });

  it('applies loss when drawing more cards than remain in library', () => {
    const ctx = makeCtx({
      libraryCards: [{ id: 'c1', name: 'Solo' }],
    });
    drawCards(ctx, 'ai1', 2);

    expect(ctx.state.zones.ai1.handCount).toBe(1);
    expect(ctx.state.players[0].hasLost).toBe(true);
  });

  it('does not lose when Platinum Angel is on the battlefield', () => {
    const ctx = makeCtx({ libraryCards: [], cantLose: true });
    drawCards(ctx, 'ai1', 1);

    expect(ctx.state.players[0].hasLost).toBe(false);
  });

  it('wins instead when Laboratory Maniac is on the battlefield', () => {
    const ctx = makeCtx({ libraryCards: [], labMan: true });
    drawCards(ctx, 'ai1', 1);

    expect(ctx.state.players[0].hasLost).toBe(false);
    expect(ctx.state.gameOver).toBe(true);
    expect(ctx.state.winner).toBe('ai1');
  });

  it('still reconciles pending flags via runSBA', () => {
    const ctx = makeCtx({ libraryCards: [] });
    ctx.state.attemptedEmptyLibraryDraw = { ai1: true };
    runSBA(ctx);

    expect(ctx.state.players[0].hasLost).toBe(true);
  });
});
