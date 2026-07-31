/**
 * Unit tests for Loop Shortcut self-sustain + compressed state patch.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLoopShortcutStatePatch,
  captureLoopShortcutStatePatch,
  clampLoopShortcutIterations,
  isLoopShortcutSelfSustaining,
  LOOP_SHORTCUT_MAX_ITERATIONS,
  LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS,
  resolveLoopShortcutIterationBudget,
  snapshotLoopShortcutResources,
} from '../src/socket/loopShortcutSustain.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { createContext } from '../src/state/context.js';

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
});
