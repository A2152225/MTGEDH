import { describe, expect, it } from 'vitest';

import { calculateAdditionalDraws } from '../src/state/modules/game-state-effects.js';
import { detectDrawStepTriggers } from '../src/state/modules/triggers/turn-phases.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const HOWLING_MINE_ORACLE =
  "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.";
const FONT_ORACLE =
  "At the beginning of each player's draw step, that player draws two additional cards.";
const RITES_DRAW_ORACLE =
  "At the beginning of each player's draw step, that player draws an additional card.\nEach player may play an additional land on each of their turns.";
const YOUR_DRAW_ORACLE = 'At the beginning of your draw step, draw an additional card.';
const WELL_OF_IDEAS_ORACLE =
  "When this enchantment enters, draw two cards.\nAt the beginning of each other player's draw step, that player draws an additional card.\nAt the beginning of your draw step, draw two additional cards.";
const ANVIL_ORACLE =
  "Players have no maximum hand size.\nAt the beginning of each player's draw step, that player draws an additional card, then discards a card.";
const SYLVAN_ORACLE =
  'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.';
const SEIZAN_ORACLE =
  "At the beginning of each player's upkeep, that player loses 2 life and draws two cards.";
const TEMPLE_BELL_ORACLE = '{T}: Each player draws a card.';
const NEKUSAR_ORACLE =
  "At the beginning of each player's draw step, that player draws an additional card.\nWhenever an opponent draws a card, Nekusar deals 1 damage to that player.";

function ctxFor(battlefield: any[]) {
  return { state: { battlefield, players: [{ id: 'p1' }, { id: 'p2' }] } } as any;
}

function perm(id: string, controller: string, name: string, oracleText: string, tapped = false) {
  return {
    id,
    controller,
    tapped,
    card: { name, type_line: 'Enchantment', oracle_text: oracleText },
  };
}

describe('calculateAdditionalDraws is oracle-only (no ADDITIONAL_DRAW_CARDS table)', () => {
  it('grants +1 to every player from Howling Mine oracle when untapped', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Shared Extra Draw', HOWLING_MINE_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(1);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(1);
    ctx.state.battlefield[0].tapped = true;
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(0);
  });

  it('grants +2 to every player from Font of Mythos oracle', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Two Extra Draws', FONT_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(2);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(2);
  });

  it('grants +1 to every player from Rites-style each-player draw-step oracle', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Draw And Land', RITES_DRAW_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(1);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(1);
    expect(
      detectDrawStepTriggers(
        { name: 'Rites of Flourishing', oracle_text: RITES_DRAW_ORACLE },
        { id: 'fx1', controller: 'p1' },
      ),
    ).toHaveLength(0);
  });

  it('grants +1 only to the controller from "your draw step" oracle', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Your Extra Draw', YOUR_DRAW_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(1);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(0);
  });

  it('applies both Well of Ideas draw-step clauses', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Split Extra Draws', WELL_OF_IDEAS_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(2);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(1);
  });

  it('does not auto-apply compound then-discard extra draws', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Draw Then Discard', ANVIL_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(0);
    expect(
      detectDrawStepTriggers(
        { name: 'Fixture Draw Then Discard', oracle_text: ANVIL_ORACLE },
        { id: 'fx1', controller: 'p1' },
      ),
    ).toHaveLength(1);
  });

  it('does not auto-apply optional you-may extra draws', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Optional Extra Draws', SYLVAN_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(0);
    expect(
      detectDrawStepTriggers(
        { name: 'Fixture Optional Extra Draws', oracle_text: SYLVAN_ORACLE },
        { id: 'fx1', controller: 'p1' },
      ),
    ).toHaveLength(1);
  });

  it('does not treat upkeep extra draws as draw-step extras', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Seizan, Perverter of Truth', SEIZAN_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(0);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(0);
  });

  it('does not grant extra draws from leftover names without draw-step oracle', () => {
    const ctx = ctxFor([
      perm('fx1', 'p1', 'Howling Mine', TEMPLE_BELL_ORACLE),
      perm('fx2', 'p1', 'Sylvan Library', TEMPLE_BELL_ORACLE),
    ]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(0);
  });

  it('still grants Nekusar additional-draw sentence without using the damage trigger', () => {
    const ctx = ctxFor([perm('fx1', 'p1', 'Fixture Draw Then Punish', NEKUSAR_ORACLE)]);
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(1);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(1);
  });
});
