import { describe, expect, it } from 'vitest';

import {
  checkLoseConditions,
  hasCantLoseEffect,
  hasDrawWinReplacement,
} from '../src/state/modules/game-state-effects.js';
import { collectOraclePatternLoseGameReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecLoseGameOracleTemplates.js';

// Oracle text copied from oracle-cards.jsonl / mtg_data.db (is_token = 0).
const PLATINUM_ANGEL_ORACLE =
  "Flying\nYou can't lose the game and your opponents can't win the game.";
const ANGELS_GRACE_ORACLE =
  "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nYou can't lose the game this turn and your opponents can't win the game this turn. Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead.";
const ABYSSAL_PERSECUTOR_ORACLE =
  "Flying, trample\nYou can't win the game and your opponents can't lose the game.";
const JACE_WOM_ORACLE =
  'If you would draw a card while your library has no cards in it, you win the game instead.\n[+1]: Target player mills two cards. Draw a card.\n[−8]: Draw seven cards. Then if your library has no cards in it, you win the game.';

describe('oracle-pattern can\'t-lose ReplacementEffectSpec', () => {
  it('Platinum Angel: controller can\'t lose; opponents are not protected', () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', life: 0 }, { id: 'p2', life: 40 }],
        life: { p1: 0, p2: 40 },
        battlefield: [{
          id: 'angel_1',
          controller: 'p1',
          card: { name: 'Platinum Angel', oracle_text: PLATINUM_ANGEL_ORACLE },
        }],
      },
    } as any;

    expect(hasCantLoseEffect(ctx, 'p1')).toEqual({ cantLose: true, reason: 'Platinum Angel' });
    expect(hasCantLoseEffect(ctx, 'p2')).toEqual({ cantLose: false });
    expect(checkLoseConditions(ctx, 'p1').lost).toBe(false);
    expect(
      collectOraclePatternLoseGameReplacementSpecsFromState(ctx.state).some(
        (spec) => spec.instead.loseGame?.controllerCantLose === true,
      ),
    ).toBe(true);
  });

  it("Angel's Grace oracle text grants can't-lose without a name table", () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
        battlefield: [{
          id: 'grace_1',
          controller: 'p1',
          card: { name: "Angel's Grace", oracle_text: ANGELS_GRACE_ORACLE },
        }],
      },
    } as any;

    expect(hasCantLoseEffect(ctx, 'p1').cantLose).toBe(true);
    expect(hasCantLoseEffect(ctx, 'p2').cantLose).toBe(false);
  });

  it("Abyssal Persecutor: opponents can't lose; controller can", () => {
    const ctx = {
      state: {
        players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 0 }],
        life: { p1: 40, p2: 0 },
        battlefield: [{
          id: 'abyssal_1',
          controller: 'p2',
          card: { name: 'Abyssal Persecutor', oracle_text: ABYSSAL_PERSECUTOR_ORACLE },
        }],
      },
    } as any;

    expect(hasCantLoseEffect(ctx, 'p1')).toEqual({
      cantLose: true,
      reason: 'Abyssal Persecutor (controlled by opponent)',
    });
    expect(hasCantLoseEffect(ctx, 'p2').cantLose).toBe(false);
    expect(checkLoseConditions(ctx, 'p2').lost).toBe(true);
  });

  it('Jace, Wielder of Mysteries is an empty-library draw win, not a name-table card', () => {
    const ctx = {
      state: {
        battlefield: [{
          id: 'jace_1',
          controller: 'p1',
          card: { name: 'Jace, Wielder of Mysteries', oracle_text: JACE_WOM_ORACLE },
        }],
      },
    } as any;

    expect(hasDrawWinReplacement(ctx, 'p1')).toBe(true);
    expect(hasDrawWinReplacement(ctx, 'p2')).toBe(false);
    expect(hasCantLoseEffect(ctx, 'p1').cantLose).toBe(false);
  });
});
