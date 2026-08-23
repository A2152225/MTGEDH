import { describe, it, expect } from 'vitest';
import { canActivateAnyAbility, canAct, canRespond, isPlayerIdleForAutoPass } from '../src/state/modules/can-respond';
import {
  detectActivationTimingRestriction,
  isActivatedAbilityTimingLegal,
} from '../src/state/modules/activation-timing';
import type { GameContext } from '../src/state/context';
import type { PlayerID } from '../../shared/src';

function createTestContext(state: any): GameContext {
  return {
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

const SCOURGLASS_TEXT =
  '{T}, Sacrifice Scourglass: Destroy all permanents except for artifacts and lands. Activate this ability only during your upkeep.';

const TRADING_POST_TEXT =
  '{1}, {T}, Discard a card: Create a 0/0 black Germ creature token and put a +1/+1 counter on it.\\n{1}, {T}, Pay 1 life: Create a Treasure token.\\n{1}, {T}, Sacrifice a creature: You gain 4 life.\\n{1}, {T}, Sacrifice an artifact: Return target artifact card from your graveyard to your hand.';

describe('activation-timing helpers', () => {
  it('detects Scourglass-style upkeep restriction from oracle text', () => {
    expect(detectActivationTimingRestriction(SCOURGLASS_TEXT)).toBe('your_upkeep');
  });

  it('does not invent timing restrictions for Trading Post style always-on activates', () => {
    expect(detectActivationTimingRestriction(TRADING_POST_TEXT)).toBeNull();
  });

  it('marks upkeep-only abilities illegal outside the controller upkeep', () => {
    expect(
      isActivatedAbilityTimingLegal(
        { step: 'MAIN1', phase: 'precombatMain', turnPlayer: 'p1', stack: [] },
        'p1',
        SCOURGLASS_TEXT,
        SCOURGLASS_TEXT,
        0,
      ),
    ).toBe(false);
  });

  it('marks upkeep-only abilities legal during the controller upkeep', () => {
    expect(
      isActivatedAbilityTimingLegal(
        { step: 'UPKEEP', phase: 'upkeep', turnPlayer: 'p1', stack: [] },
        'p1',
        SCOURGLASS_TEXT,
        SCOURGLASS_TEXT,
        0,
      ),
    ).toBe(true);
  });
});

describe('canActivateAnyAbility upkeep-only timing (Scourglass-style)', () => {
  function makeScourglassCtx(overrides: Record<string, unknown> = {}) {
    return createTestContext({
      battlefield: [
        {
          id: 'scourglass1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Scourglass',
            type_line: 'Artifact',
            oracle_text: SCOURGLASS_TEXT,
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: { p1: { hand: [], graveyard: [], exile: [] } },
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
      phase: 'upkeep',
      step: 'UPKEEP',
      ...overrides,
    });
  }

  it('does NOT count as available outside your upkeep (main phase)', () => {
    const ctx = makeScourglassCtx({ phase: 'precombatMain', step: 'MAIN1' });
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
    // Active player with only an illegal-timing activate should be idle for auto-pass
    expect(isPlayerIdleForAutoPass(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('does NOT count as available on an opponent upkeep', () => {
    const ctx = makeScourglassCtx({ turnPlayer: 'p2', priority: 'p1', phase: 'upkeep', step: 'UPKEEP' });
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('DOES count as available during your upkeep', () => {
    const ctx = makeScourglassCtx();
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('Trading Post style always-on activates still block auto-pass when legal', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'trading_post1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Trading Post',
            type_line: 'Artifact',
            oracle_text: TRADING_POST_TEXT,
          },
        },
      ],
      manaPool: {
        // Need {1} for Trading Post abilities; colorless covers generic
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      },
      zones: {
        p1: {
          hand: [{ id: 'spare', name: 'Spare', type_line: 'Creature', oracle_text: '' }],
          graveyard: [],
          exile: [],
        },
      },
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
      phase: 'precombatMain',
      step: 'MAIN1',
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });
});
