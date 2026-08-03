/**
 * Unit tests for Loop Shortcut self-sustain + compressed state patch.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLoopShortcutStatePatch,
  applyMultipliedSafeDelta,
  canApplyMultipliedSafeDelta,
  captureLoopShortcutStatePatch,
  clampLoopShortcutIterations,
  diffLoopShortcutIterationDelta,
  fastReplayLoopShortcutMills,
  isLoopShortcutSelfSustaining,
  LOOP_SHORTCUT_MAX_ITERATIONS,
  LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS,
  resolveLoopShortcutIterationBudget,
  snapshotLoopShortcutBoard,
  snapshotLoopShortcutResources,
  tryApplyLoopShortcutDeltaMultiply,
  loopShortcutTokenFingerprint,
} from '../src/socket/loopShortcutSustain.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { createContext } from '../src/state/context.js';
import { hasGraveyardMassShuffleIntoLibraryTrigger } from '../src/state/modules/zone-manipulation.js';

function merfolkToken(args: {
  id: string;
  controller?: string;
  tapped?: boolean;
  name?: string;
}): any {
  return {
    id: args.id,
    controller: args.controller || 'p1',
    owner: args.controller || 'p1',
    tapped: !!args.tapped,
    isToken: true,
    basePower: 1,
    baseToughness: 1,
    card: {
      id: `${args.id}_card`,
      name: args.name || 'Merfolk',
      type_line: 'Creature — Merfolk',
      power: '1',
      toughness: '1',
      keywords: [],
    },
  };
}

describe('loopShortcutSustain', () => {
  it('clamps iterations to the sustained hard cap', () => {
    expect(clampLoopShortcutIterations(0)).toBe(1);
    expect(clampLoopShortcutIterations(40)).toBe(40);
    expect(clampLoopShortcutIterations(1000)).toBe(1000);
    expect(clampLoopShortcutIterations(5000)).toBe(LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS);
  });

  it('treats equal-or-growing resources as self-sustaining', () => {
    const before = {
      life: 40,
      creatureCount: 10,
      permanentCount: 12,
      handCount: 2,
      libraryCount: 80,
      graveyardCount: 1,
      exileCount: 0,
      manaTotal: 0,
      floatingMana: 0,
    };
    const after = {
      ...before,
      creatureCount: 32,
      permanentCount: 34,
      manaTotal: 0,
    };
    expect(isLoopShortcutSelfSustaining(before, after)).toBe(true);
  });

  it('allows kickstart mana spend when the creature board does not shrink', () => {
    const before = {
      life: 40,
      creatureCount: 10,
      permanentCount: 14,
      handCount: 2,
      libraryCount: 80,
      graveyardCount: 1,
      exileCount: 0,
      manaTotal: 8, // lands + float before first cast
      floatingMana: 3,
    };
    const after = {
      ...before,
      creatureCount: 32,
      permanentCount: 36,
      manaTotal: 2, // lands tapped / float spent; Altar regenerates from tokens later
      floatingMana: 0,
    };
    expect(isLoopShortcutSelfSustaining(before, after)).toBe(true);
  });

  it('rejects loops that shrink creatures or mana without board growth', () => {
    const before = {
      life: 40,
      creatureCount: 10,
      permanentCount: 12,
      handCount: 2,
      libraryCount: 80,
      graveyardCount: 1,
      exileCount: 0,
      manaTotal: 4,
      floatingMana: 4,
    };
    expect(
      isLoopShortcutSelfSustaining(before, { ...before, creatureCount: 8, permanentCount: 10 }),
    ).toBe(false);
    expect(
      isLoopShortcutSelfSustaining(before, { ...before, manaTotal: 0, floatingMana: 0 }),
    ).toBe(false);
  });

  it('soft-caps non-sustaining requests above 50', () => {
    expect(
      resolveLoopShortcutIterationBudget({ requested: 400, selfSustaining: false }),
    ).toEqual({ maxIterations: LOOP_SHORTCUT_MAX_ITERATIONS, requiresSustain: true });
    expect(
      resolveLoopShortcutIterationBudget({ requested: 400, selfSustaining: true }),
    ).toEqual({ maxIterations: 400, requiresSustain: true });
    expect(
      resolveLoopShortcutIterationBudget({ requested: 20, selfSustaining: null }),
    ).toEqual({ maxIterations: 20, requiresSustain: false });
  });

  it('snapshots controlled creatures and mana', () => {
    const state: any = {
      life: { p1: 37 },
      manaPool: { p1: { colorless: 3, blue: 1 } },
      zones: {
        p1: {
          hand: [{ id: 'h1' }],
          library: [{ id: 'l1' }, { id: 'l2' }],
          graveyard: [{ id: 'g1' }],
          exile: [],
        },
      },
      battlefield: [
        {
          id: 'c1',
          controller: 'p1',
          card: { type_line: 'Creature — Merfolk' },
        },
        {
          id: 'a1',
          controller: 'p1',
          card: { type_line: 'Artifact' },
        },
        {
          id: 'opp',
          controller: 'p2',
          card: { type_line: 'Creature — Elf' },
        },
      ],
    };
    expect(snapshotLoopShortcutResources(state, 'p1')).toMatchObject({
      life: 37,
      creatureCount: 1,
      permanentCount: 2,
      handCount: 1,
      libraryCount: 2,
      graveyardCount: 1,
      exileCount: 0,
      floatingMana: 4,
    });
    // manaTotal includes floating + untapped sources (Island here may add more).
    expect(snapshotLoopShortcutResources(state, 'p1').manaTotal).toBeGreaterThanOrEqual(4);
  });

  it('applies compressed state patch on replay via applyEvent', () => {
    const ctx = createContext('test_loop_shortcut_patch');
    ctx.state.battlefield = [] as any;
    ctx.state.life = { p1: 40 } as any;
    ctx.state.manaPool = { p1: { colorless: 0 } } as any;
    (ctx.state as any).zones = { p1: { hand: [], library: [], graveyard: [], exile: [] } };

    const live: any = {
      battlefield: [
        {
          id: 'token_1',
          controller: 'p1',
          card: { name: 'Merfolk Token', type_line: 'Creature — Merfolk' },
        },
      ],
      life: { p1: 40 },
      manaPool: { p1: { colorless: 2 } },
      zones: {
        p1: {
          hand: [],
          library: [],
          graveyard: [{ id: 'summon', name: 'Summon the School' }],
          exile: [],
        },
      },
      stack: [],
    };

    const patch = captureLoopShortcutStatePatch(live);
    applyEvent(ctx, {
      type: 'loopShortcutBatchApply',
      playerId: 'p1',
      iterationsCompleted: 250,
      selfSustaining: true,
      statePatch: patch,
    } as any);

    expect((ctx.state.battlefield as any[]).map((p) => p.id)).toEqual(['token_1']);
    expect((ctx.state as any).manaPool.p1.colorless).toBe(2);
    expect((ctx.state as any).zones.p1.graveyard[0].name).toBe('Summon the School');
  });

  it('round-trips capture/apply without sharing object identity', () => {
    const state: any = {
      battlefield: [{ id: 'a', controller: 'p1' }],
      life: { p1: 40 },
      stack: [],
    };
    const patch = captureLoopShortcutStatePatch(state);
    (patch.battlefield as any[])[0].id = 'mutated';
    expect(state.battlefield[0].id).toBe('a');

    const target: any = { battlefield: [], life: { p1: 1 }, stack: [{ id: 'old' }] };
    applyLoopShortcutStatePatch(target, patch);
    expect(target.battlefield[0].id).toBe('mutated');
    expect(target.stack).toEqual([]);
  });

  it('diffs and multiplies mana/tokens without ETB, and fast-replays mills', () => {
    const beforeState: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      life: { p1: 40, p2: 40 },
      manaPool: { p1: { white: 1 }, p2: {} },
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [], libraryCount: 0 },
        p2: {
          hand: [],
          library: [],
          graveyard: [],
          exile: [],
          libraryCount: 100,
        },
      },
      battlefield: [
        merfolkToken({ id: 't1', tapped: false }),
        merfolkToken({ id: 't2', tapped: true }),
      ],
    };
    const afterState: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      life: { p1: 40, p2: 40 },
      manaPool: { p1: { white: 2 }, p2: {} },
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [], libraryCount: 0 },
        p2: {
          hand: [],
          library: [],
          graveyard: [],
          exile: [],
          libraryCount: 92,
        },
      },
      battlefield: [
        merfolkToken({ id: 't1', tapped: false }),
        merfolkToken({ id: 't2', tapped: true }),
        merfolkToken({ id: 't3', tapped: false }),
        merfolkToken({ id: 't4', tapped: false }),
        merfolkToken({ id: 't5', tapped: true }),
        merfolkToken({ id: 't6', tapped: true }),
      ],
    };

    const before = snapshotLoopShortcutBoard(beforeState);
    const after = snapshotLoopShortcutBoard(afterState);
    const delta = diffLoopShortcutIterationDelta(before, after);

    expect(delta.floatingManaByPlayer.p1?.white).toBe(1);
    expect(delta.millsByPlayer.p2).toBe(8);
    const tokenDeltas = Object.values(delta.tokensByFingerprint).map((e) => e.count).sort();
    expect(tokenDeltas).toEqual([2, 2]); // +2 untapped, +2 tapped (raw probe delta)

    const live: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        life: { p1: 40, p2: 40 },
        manaPool: { p1: { white: 2 }, p2: {} },
        zones: {
          p1: { hand: [], library: [], graveyard: [], exile: [], libraryCount: 0 },
          p2: { hand: [], library: [], graveyard: [], exile: [], libraryCount: 92 },
        },
        battlefield: [
          merfolkToken({ id: 't1', tapped: false }),
          merfolkToken({ id: 't2', tapped: true }),
          merfolkToken({ id: 't3', tapped: false }),
          merfolkToken({ id: 't4', tapped: false }),
          merfolkToken({ id: 't5', tapped: true }),
          merfolkToken({ id: 't6', tapped: true }),
        ],
      },
      libraries: new Map<string, any[]>([
        ['p1', []],
        [
          'p2',
          Array.from({ length: 92 }, (_, i) => ({
            id: `lib_${i}`,
            name: `Card ${i}`,
            zone: 'library',
          })),
        ],
      ]),
      bumpSeq: () => {},
    };

    expect(canApplyMultipliedSafeDelta(live.state, delta, 3).ok).toBe(true);
    const applied = tryApplyLoopShortcutDeltaMultiply({
      game: live,
      delta,
      remainingIterations: 3,
    });
    expect(applied.ok).toBe(true);
    expect(live.state.manaPool.p1.white).toBe(5); // 2 + 1*3
    // Tap churn is collapsed: net +4 tokens/iter applied as untapped births.
    // Existing tapped tokens stay; new tokens coalesce into the untapped group.
    const tokens = live.state.battlefield.filter((p: any) => p.isToken || p.isGroupedTokens);
    const totalTokenCount = tokens.reduce(
      (sum: number, p: any) => sum + (p.isGroupedTokens ? Number(p.tokenCount) || 0 : 1),
      0,
    );
    expect(totalTokenCount).toBe(6 + 4 * 3);
    const tappedCount = tokens.reduce((sum: number, p: any) => {
      if (!p.tapped) return sum;
      return sum + (p.isGroupedTokens ? Number(p.tokenCount) || 0 : 1);
    }, 0);
    // Probe ended with 3 tapped; multiply must not invent more tapped copies.
    expect(tappedCount).toBe(3);
    expect(live.libraries.get('p2').length).toBe(92 - 8 * 3);
    expect(live.state.zones.p2.graveyard.length).toBe(8 * 3);
    expect(applied.milledTotal).toBe(24);
  });

  it('collapses Summon-style tap-cost churn so multiply adds untapped births only', () => {
    const beforeState: any = {
      players: [{ id: 'p1' }],
      life: { p1: 40 },
      manaPool: { p1: {} },
      zones: { p1: { hand: [], library: [], graveyard: [], exile: [], libraryCount: 0 } },
      battlefield: [
        ...Array.from({ length: 10 }, (_, i) => merfolkToken({ id: `u${i}`, tapped: false })),
        ...Array.from({ length: 4 }, (_, i) => merfolkToken({ id: `t${i}`, tapped: true })),
      ],
    };
    // One iteration without Intruder Alarm: +2 tokens, tap 4 → net -2 untapped / +4 tapped.
    const afterState: any = {
      players: [{ id: 'p1' }],
      life: { p1: 40 },
      manaPool: { p1: {} },
      zones: { p1: { hand: [], library: [], graveyard: [], exile: [], libraryCount: 0 } },
      battlefield: [
        ...Array.from({ length: 8 }, (_, i) => merfolkToken({ id: `u${i}`, tapped: false })),
        ...Array.from({ length: 8 }, (_, i) => merfolkToken({ id: `t${i}`, tapped: true })),
      ],
    };

    const delta = diffLoopShortcutIterationDelta(
      snapshotLoopShortcutBoard(beforeState),
      snapshotLoopShortcutBoard(afterState),
    );
    const raw = Object.values(delta.tokensByFingerprint).map((e) => e.count).sort((a, b) => a - b);
    expect(raw).toEqual([-2, 4]);

    const live: any = {
      state: structuredClone(afterState),
      libraries: new Map(),
      bumpSeq: () => {},
    };
    const applied = tryApplyLoopShortcutDeltaMultiply({
      game: live,
      delta,
      remainingIterations: 50,
    });
    expect(applied.ok).toBe(true);
    const tokens = live.state.battlefield.filter((p: any) => p.isToken || p.isGroupedTokens);
    const total = tokens.reduce(
      (sum: number, p: any) => sum + (p.isGroupedTokens ? Number(p.tokenCount) || 0 : 1),
      0,
    );
    const tapped = tokens.reduce((sum: number, p: any) => {
      if (!p.tapped) return sum;
      return sum + (p.isGroupedTokens ? Number(p.tokenCount) || 0 : 1);
    }, 0);
    expect(total).toBe(16 + 2 * 50);
    expect(tapped).toBe(8);
  });

  it('falls back when multiply would remove more tokens than exist', () => {
    const proto = merfolkToken({ id: 'proto', tapped: false });
    const fp = loopShortcutTokenFingerprint(proto);
    const delta = {
      floatingManaByPlayer: {},
      lifeByPlayer: {},
      millsByPlayer: {},
      tokensByFingerprint: {
        [fp]: { count: -1, prototype: proto },
      },
    };
    const state: any = {
      battlefield: [merfolkToken({ id: 'only', tapped: false })],
      manaPool: {},
      life: {},
    };
    expect(canApplyMultipliedSafeDelta(state, delta, 3).ok).toBe(false);
    applyMultipliedSafeDelta(state, delta, 1);
    expect(state.battlefield.length).toBe(0);
  });

  it('fast-replays mills through Eldrazi graveyard shuffle', () => {
    const titanOracle =
      'When you cast this spell, destroy target permanent.\nWhen Ulamog, the Infinite Gyre is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.';
    expect(
      hasGraveyardMassShuffleIntoLibraryTrigger({
        name: 'Ulamog, the Infinite Gyre',
        oracle_text: titanOracle,
      }),
    ).toBe(true);

    const libraries = new Map<string, any[]>([
      [
        'p2',
        [
          { id: 'c1', name: 'Island', zone: 'library' },
          {
            id: 'ulamog',
            name: 'Ulamog, the Infinite Gyre',
            oracle_text: titanOracle,
            zone: 'library',
          },
          { id: 'c2', name: 'Plains', zone: 'library' },
        ],
      ],
    ]);
    const game: any = {
      state: {
        players: [{ id: 'p2' }],
        zones: {
          p2: {
            hand: [],
            library: [],
            graveyard: [{ id: 'old', name: 'Old Card', zone: 'graveyard' }],
            exile: [],
            libraryCount: 3,
            graveyardCount: 1,
          },
        },
      },
      libraries,
      bumpSeq: () => {},
      rng: () => 0.5,
    };

    const result = fastReplayLoopShortcutMills({
      game,
      millsByPlayer: { p2: 2 },
      remainingIterations: 1,
    });
    expect(result.milledTotal).toBe(2);
    // Titan milled → GY shuffle into library; library should be non-empty again.
    expect(game.libraries.get('p2').length).toBeGreaterThan(0);
    expect(game.state.zones.p2.graveyard.length).toBe(0);
  });
});
