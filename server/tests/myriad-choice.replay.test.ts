import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent';

describe('myriadChoice replay', () => {
  it('replays myriadChoice by rebuilding the selected token copies from the saved source snapshot', () => {
    const ctx: any = {
      state: {
        players: [
          { id: 'p1', name: 'P1', spectator: false, life: 40 },
          { id: 'p2', name: 'P2', spectator: false, life: 40 },
          { id: 'p3', name: 'P3', spectator: false, life: 40 },
        ],
        battlefield: [],
        stack: [],
        zones: {},
        phase: 'combat',
        step: 'declareAttackers',
        turn: 1,
        turnNumber: 1,
        pendingExileAtEndOfCombat: [],
        tokensCreatedThisTurn: { p1: 0 },
        tokenCreatedThisTurn: { p1: 0 },
        createdTokenThisTurn: { p1: 0 },
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'myriadChoice',
      playerId: 'p1',
      permanentId: 'myriad_attacker',
      sourceName: 'Myriad Attacker',
      sourcePermanentSnapshot: {
        id: 'myriad_attacker',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'myriad_attacker_card',
          name: 'Myriad Attacker',
          type_line: 'Creature - Warrior',
          oracle_text:
            "Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token that's a copy of this creature that's tapped and attacking that player. Exile the tokens at end of combat.)",
          keywords: ['Myriad'],
          power: '3',
          toughness: '3',
        },
      },
      selectedOpponentIds: ['p2', 'p3'],
      createdPermanentIds: ['myriad_live_token_1', 'myriad_live_token_2'],
    } as any);

    const battlefield = (ctx.state.battlefield || []) as any[];
    const delayed = (ctx.state.pendingExileAtEndOfCombat || []) as any[];

    expect(battlefield.map((permanent: any) => permanent.id)).toEqual(['myriad_live_token_1', 'myriad_live_token_2']);
    expect(battlefield.map((permanent: any) => permanent.attacking).sort()).toEqual(['p2', 'p3']);
    expect(battlefield.every((permanent: any) => permanent.isToken === true)).toBe(true);
    expect(delayed.map((entry: any) => entry.permanentId)).toEqual(['myriad_live_token_1', 'myriad_live_token_2']);
    expect(ctx.state.tokensCreatedThisTurn?.p1).toBe(2);
  });
});
