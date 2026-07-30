import { describe, expect, it } from 'vitest';

import { castSpell } from '../src/state/modules/stackCastSpellUtils.js';
import { playLand } from '../src/state/modules/stackPlayLandUtils.js';

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

  it('removes a live-play ghost spell from hand when it is already on the battlefield', () => {
    const card = {
      id: 'sphere_1',
      name: "Commander's Sphere",
      type_line: 'Artifact',
      oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
      mana_cost: '{3}',
    };

    const ctx: any = {
      isReplaying: false,
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
            id: 'perm_sphere',
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

    castSpell(ctx, 'p1', card.id);

    expect((ctx.state.zones.p1.hand || []).map((entry: any) => entry.id)).toEqual([]);
    expect(ctx.state.zones.p1.handCount).toBe(0);
    expect((ctx.state.battlefield || []).map((perm: any) => perm.card?.id)).toEqual(['sphere_1']);
    expect(ctx.state.stack || []).toEqual([]);
  });

  it('repairBattlefieldDualZoneGhosts strips hand copies after undo-style dual zone', async () => {
    const { repairBattlefieldDualZoneGhosts } = await import('../src/state/modules/stackReplayUtils.js');
    const card = {
      id: 'sphere_undo',
      name: "Commander's Sphere",
      type_line: 'Artifact',
    };
    const ctx: any = {
      state: {
        zones: {
          p1: {
            hand: [{ ...card, zone: 'hand' }],
            handCount: 1,
            graveyard: [],
            exile: [],
          },
        },
        battlefield: [
          {
            id: 'perm_1',
            controller: 'p1',
            owner: 'p1',
            card: { ...card, zone: 'battlefield' },
          },
        ],
      },
      libraries: new Map(),
    };

    expect(repairBattlefieldDualZoneGhosts(ctx)).toBe(1);
    expect(ctx.state.zones.p1.hand).toEqual([]);
    expect(ctx.state.zones.p1.handCount).toBe(0);
  });

  it('removes a resolved instant ghost from the battlefield and preserves its graveyard card', async () => {
    const { repairAllDualZoneGhosts } = await import('../src/state/modules/stackReplayUtils.js');
    const card = {
      id: 'guff_1',
      name: 'Guff Rewrites History',
      type_line: 'Instant',
    };
    const ctx: any = {
      state: {
        zones: {
          p1: {
            hand: [],
            graveyard: [{ ...card, zone: 'graveyard' }],
            graveyardCount: 1,
            exile: [],
          },
        },
        battlefield: [{
          id: 'stack_guff',
          controller: 'p1',
          owner: 'p1',
          card: { ...card, zone: 'battlefield' },
        }],
      },
      libraries: new Map(),
    };

    expect(repairAllDualZoneGhosts(ctx)).toBe(1);
    expect(ctx.state.battlefield).toEqual([]);
    expect(ctx.state.zones.p1.graveyard).toEqual([{ ...card, zone: 'graveyard' }]);
  });

  it('repairGraveyardDualZoneGhosts strips hand ghosts for sacrificed fetch lands', async () => {
    const { repairGraveyardDualZoneGhosts } = await import('../src/state/modules/stackReplayUtils.js');
    const card = {
      id: 'delta_1',
      name: 'Polluted Delta',
      type_line: 'Land',
    };
    const ctx: any = {
      state: {
        zones: {
          p1: {
            hand: [{ ...card, zone: 'hand' }],
            handCount: 1,
            graveyard: [{ ...card, zone: 'graveyard' }],
            graveyardCount: 1,
            exile: [],
          },
        },
        battlefield: [],
      },
      libraries: new Map(),
    };

    expect(repairGraveyardDualZoneGhosts(ctx)).toBe(1);
    expect(ctx.state.zones.p1.hand).toEqual([]);
    expect(ctx.state.zones.p1.handCount).toBe(0);
    expect(ctx.state.zones.p1.graveyard.map((entry: any) => entry.id)).toEqual(['delta_1']);
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