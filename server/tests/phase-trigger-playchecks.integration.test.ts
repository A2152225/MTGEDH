import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { getBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';
import { getEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';

const WOUND_ORACLE =
  'At the beginning of each end step, each opponent loses life equal to the life they lost this turn.';
const WOUND_EFFECT = 'Each opponent loses life equal to the life they lost this turn';
const HARPY_ORACLE = 'At the beginning of combat on your turn, each player mills three cards.';
const HARPY_EFFECT = 'each player mills three cards';
const CLOSET_ORACLE =
  'At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.';

describe('phase trigger playchecks', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  it('Wound Reflection queues on each end step and drains opponents for their own life lost', () => {
    const wound = {
      id: 'wound_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'wound_card',
        name: 'Wound Reflection',
        type_line: 'Enchantment',
        oracle_text: WOUND_ORACLE,
      },
    };
    const emitCtx = {
      state: {
        battlefield: [wound],
        players: [{ id: 'p1' }, { id: 'p2' }],
        lifeLostThisTurn: { p1: 0, p2: 4 },
      },
    } as any;
    expect(getEndStepTriggers(emitCtx, 'p1').some((t) => t.permanentId === wound.id)).toBe(true);
    expect(getEndStepTriggers(emitCtx, 'p2').some((t) => t.permanentId === wound.id)).toBe(true);

    const game = createInitialGameState('wound_reflection_playcheck');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'P3' } as any);
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
      { id: p3, name: 'P3', life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).lifeLostThisTurn = { [p1]: 1, [p2]: 5, [p3]: 3 };

    executeTriggerEffect(game as any, p1, 'Wound Reflection', WOUND_EFFECT, {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'end_step',
    });

    expect((game.state as any).life[p1]).toBe(40);
    expect((game.state as any).life[p2]).toBe(35);
    expect((game.state as any).life[p3]).toBe(37);
  });

  it('Mindwrack Harpy queues on your combat and mills each player three', () => {
    const harpy = {
      id: 'harpy_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'harpy_card',
        name: 'Mindwrack Harpy',
        type_line: 'Enchantment Creature — Harpy',
        oracle_text: HARPY_ORACLE,
      },
    };
    const emitCtx = {
      state: {
        battlefield: [harpy],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    expect(getBeginningOfCombatTriggers(emitCtx, 'p1').some((t) => t.permanentId === harpy.id)).toBe(true);
    expect(getBeginningOfCombatTriggers(emitCtx, 'p2').some((t) => t.permanentId === harpy.id)).toBe(false);

    const game = createInitialGameState('mindwrack_harpy_playcheck');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const makeLibrary = (prefix: string) =>
      Array.from({ length: 5 }, (_, i) => ({
        id: `${prefix}_lib_${i}`,
        name: `${prefix} Card ${i}`,
        type_line: 'Instant',
        zone: 'library',
      }));

    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p1'), libraryCount: 5 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p2'), libraryCount: 5 },
    };
    const ctx = game as any;
    ctx.libraries = new Map([
      [p1, [...(game.state as any).zones[p1].library]],
      [p2, [...(game.state as any).zones[p2].library]],
    ]);

    executeTriggerEffect(ctx, p1, 'Mindwrack Harpy', HARPY_EFFECT, {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'beginning_of_combat',
    });

    expect((game.state as any).zones[p1].graveyard).toHaveLength(3);
    expect((game.state as any).zones[p2].graveyard).toHaveLength(3);
    expect(ctx.libraries.get(p1)).toHaveLength(2);
    expect(ctx.libraries.get(p2)).toHaveLength(2);
  });

  it("Conjurer's Closet queues an optional flicker on your end step only", () => {
    const closet = {
      id: 'closet_perm',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      card: {
        id: 'closet_card',
        name: "Conjurer's Closet",
        type_line: 'Artifact',
        oracle_text: CLOSET_ORACLE,
      },
    };
    const ctx = {
      state: {
        battlefield: [closet],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;
    const yours = getEndStepTriggers(ctx, 'p1').find((t) => t.permanentId === closet.id);
    expect(yours).toBeTruthy();
    expect(yours?.mandatory).toBe(false);
    expect(getEndStepTriggers(ctx, 'p2').some((t) => t.permanentId === closet.id)).toBe(false);
  });
});
