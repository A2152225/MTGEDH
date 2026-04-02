import { describe, expect, it } from 'vitest';

import { castSpell, playLand } from '../src/state/modules/stack';

describe('replay idempotency repairs stale source zones', () => {
  it('removes a replayed land from hand when it is already on the battlefield', () => {
    const card = {
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '',
    };

    const ctx: any = {
      isReplaying: true,
      state: {
        players: [{ id: 'p1', name: 'P1' }],
        zones: {
          p1: {
            hand: [{ ...card, zone: 'hand' }],
            handCount: 1,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          },
        },
        battlefield: [
          {
            id: 'perm_1',
            controller: 'p1',
            owner: 'p1',
            tapped: false,
            counters: {},
            card: { ...card, zone: 'battlefield' },
          },
        ],
        stack: [],
      },
      bumpSeq: () => undefined,
    };

    playLand(ctx, 'p1', card.id);

    expect((ctx.state.zones.p1.hand || []).map((entry: any) => entry.id)).toEqual([]);
    expect(ctx.state.zones.p1.handCount).toBe(0);
    expect((ctx.state.battlefield || []).map((perm: any) => perm.card?.id)).toEqual(['forest_1']);
  });

  it('removes a replayed spell from hand when it is already on the stack', () => {
    const card = {
      id: 'spell_1',
      name: 'Cultivate',
      type_line: 'Sorcery',
      oracle_text: '',
      mana_cost: '{2}{G}',
    };

    const ctx: any = {
      isReplaying: true,
      state: {
        players: [{ id: 'p1', name: 'P1' }],
        zones: {
          p1: {
            hand: [{ ...card, zone: 'hand' }],
            handCount: 1,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          },
        },
        battlefield: [],
        stack: [
          {
            id: 'stack_1',
            controller: 'p1',
            card: { ...card, zone: 'stack' },
            targets: [],
          },
        ],
      },
      bumpSeq: () => undefined,
    };

    castSpell(ctx, 'p1', card.id);

    expect((ctx.state.zones.p1.hand || []).map((entry: any) => entry.id)).toEqual([]);
    expect(ctx.state.zones.p1.handCount).toBe(0);
    expect((ctx.state.stack || []).map((entry: any) => entry.card?.id)).toEqual(['spell_1']);
  });
});