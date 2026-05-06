import { describe, expect, it } from 'vitest';

import { castSpell } from '../src/state/modules/stack';
import { nextTurn } from '../src/state/modules/turn';

function createTrackingContext() {
  const state: any = {
    players: [
      { id: 'p1', name: 'P1', hasLost: false },
      { id: 'p2', name: 'P2', hasLost: false },
    ],
    zones: {
      p1: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      p2: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
    battlefield: [],
    stack: [],
    phase: 'precombatMain',
    step: 'MAIN1',
    turnPlayer: 'p1',
    activePlayer: 'p1',
    priority: 'p1',
    manaPool: {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    landsPlayedThisTurn: { p1: 0, p2: 0 },
  };

  return {
    state,
    libraries: new Map<string, any[]>([
      ['p1', []],
      ['p2', []],
    ]),
    inactive: new Set<string>(),
    passesInRow: { value: 0 },
    bumpSeq: () => undefined,
  } as any;
}

describe('graveyard permanent type tracking', () => {
  it('records every permanent type used by a graveyard cast in the live stack path', () => {
    const ctx = createTrackingContext();
    const card = {
      id: 'retriever_1',
      name: 'Myr Retriever',
      type_line: 'Artifact Creature — Myr',
      mana_cost: '{2}',
      oracle_text: 'When Myr Retriever dies, return another target artifact card from your graveyard to your hand.',
    };

    ctx.state.zones.p1.graveyard = [card];
    ctx.state.zones.p1.graveyardCount = 1;

    castSpell(ctx, 'p1', card);

    expect(ctx.state.castFromGraveyardThisTurn?.p1).toBe(true);
    expect(ctx.state.graveyardPermanentTypesCastThisTurn?.p1).toEqual(
      expect.objectContaining({ artifact: true, creature: true }),
    );
  });

  it('clears graveyard permanent type usage when the turn advances', () => {
    const ctx = createTrackingContext();
    ctx.state.graveyardPermanentTypesCastThisTurn = {
      p1: { artifact: true, creature: true },
    };

    nextTurn(ctx);

    expect(ctx.state.graveyardPermanentTypesCastThisTurn).toEqual({});
  });
});