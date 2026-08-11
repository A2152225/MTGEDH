import { describe, expect, it } from 'vitest';
import { movePermanentToExile } from '../src/state/modules/counters_tokens.js';
import { registerLinkedExile } from '../src/state/modules/triggers/linked-exile.js';
import { processLTBTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';

function makeCtx(state: any) {
  return {
    state,
    gameId: 'exile_ltb_unit',
    bumpSeq: () => {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
    libraries: new Map(),
    commandZone: {},
  } as any;
}

describe('exile LTB + linked exile returns', () => {
  it('fires LTB watchers when a permanent is exiled', () => {
    const leaving = {
      id: 'ring',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'ring_card',
        name: 'Oblivion Ring',
        type_line: 'Enchantment',
        oracle_text:
          'When this enchantment enters, exile another target nonland permanent until this enchantment leaves the battlefield.',
      },
    };
    const watcher = {
      id: 'watcher',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'watcher_card',
        name: 'Leave Watcher',
        type_line: 'Creature — Spirit',
        oracle_text: 'Whenever a permanent leaves the battlefield, you gain 1 life.',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [leaving, watcher],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] },
      },
      players: [{ id: 'p1' }],
      life: { p1: 40 },
    };

    movePermanentToExile(makeCtx(state), 'ring');

    expect(state.battlefield.some((p: any) => p.id === 'ring')).toBe(false);
    expect(state.stack.some((item: any) =>
      String(item.triggerType || '').includes('ltb')
      || String(item.triggerType || '') === 'any_permanent_ltb'
      || String(item.sourceName || '') === 'Leave Watcher',
    )).toBe(true);
  });

  it('returns linked-exiled cards when the exiling permanent is itself exiled', () => {
    const ring = {
      id: 'ring',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'ring_card',
        name: 'Banishing Light',
        type_line: 'Enchantment',
        oracle_text:
          'When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.',
      },
    };
    const exiledCard = {
      id: 'bear_card',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [ring],
      zones: {
        p1: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] },
        p2: {
          hand: [],
          handCount: 0,
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [{ ...exiledCard, zone: 'exile', exiledWithSourceId: 'ring' }],
        },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      linkedExiles: [],
    };
    const ctx = makeCtx(state);
    registerLinkedExile(ctx, 'ring', 'Banishing Light', exiledCard, 'p2', 'p2');

    movePermanentToExile(ctx, 'ring');

    expect(state.battlefield.some((p: any) => p.id === 'ring')).toBe(false);
    expect(state.battlefield.some((p: any) => String(p?.card?.name || '') === 'Grizzly Bears')).toBe(true);
    expect(state.linkedExiles || []).toHaveLength(0);
  });

  it('processLTBTriggers still queues self-LTB text from the leaving permanent snapshot', () => {
    const leaving = {
      id: 'self_ltb',
      controller: 'p1',
      owner: 'p1',
      card: {
        name: 'Self Leave',
        type_line: 'Creature — Spirit',
        oracle_text: 'When Self Leave leaves the battlefield, draw a card.',
      },
    };
    const state: any = {
      seq: 1,
      stack: [],
      battlefield: [],
      players: [{ id: 'p1' }],
    };

    const queued = processLTBTriggers(makeCtx(state), leaving, { cause: 'exile' });
    expect(queued.length).toBeGreaterThan(0);
    expect(state.stack.some((item: any) => item.triggerType === 'ltb')).toBe(true);
  });
});
