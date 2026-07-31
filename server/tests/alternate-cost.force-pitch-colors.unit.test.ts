import { describe, expect, it } from 'vitest';
import {
  cardIsBlueForPitchCost,
  getCardColorSymbolsForPitchCost,
  getForceOfWillAlternateCost,
} from '../src/state/modules/alternate-costs.js';

describe('Force pitch-cost blue card detection', () => {
  it('treats explicit colors as authoritative (including empty colorless)', () => {
    expect(cardIsBlueForPitchCost({ colors: ['U'], mana_cost: '{U}' })).toBe(true);
    expect(cardIsBlueForPitchCost({ colors: ['blue'], mana_cost: '{U}' })).toBe(true);
    expect(cardIsBlueForPitchCost({ colors: [], mana_cost: '{U}', color_identity: ['U'] })).toBe(false);
  });

  it('derives blue from mana cost when colors are missing (common hand-card gap)', () => {
    expect(cardIsBlueForPitchCost({
      name: 'Counterspell',
      mana_cost: '{U}{U}',
      // colors intentionally omitted — matches live Force of Negation pendingCast shape
    })).toBe(true);
    expect(getCardColorSymbolsForPitchCost({ mana_cost: '{2}{U/R}' })).toEqual(['U', 'R']);
  });

  it('does not treat Islands / color identity alone as blue cards', () => {
    expect(cardIsBlueForPitchCost({
      name: 'Island',
      type_line: 'Basic Land — Island',
      colors: [],
      color_identity: ['U'],
      mana_cost: '',
    })).toBe(false);
    expect(cardIsBlueForPitchCost({
      name: 'Island',
      type_line: 'Basic Land — Island',
      color_identity: ['U'],
      mana_cost: '',
    })).toBe(false);
  });

  it('offers Force of Negation alt cost when pitch card lacks colors but has {U} mana cost', () => {
    const playerId = 'p1';
    const opponentId = 'p2';
    const force = {
      id: 'fon_1',
      name: 'Force of Negation',
      mana_cost: '{1}{U}{U}',
      oracle_text:
        "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target noncreature spell.",
    };
    const pitch = {
      id: 'ponder_1',
      name: 'Ponder',
      mana_cost: '{U}',
      // no colors field
    };
    const ctx = {
      state: {
        turnPlayer: opponentId,
        life: { [playerId]: 40 },
        zones: {
          [playerId]: {
            hand: [force, pitch],
          },
        },
      },
      bumpSeq: () => {},
      rng: Math.random,
    } as any;

    const info = getForceOfWillAlternateCost(ctx, playerId as any, force);
    expect(info).toMatchObject({
      available: true,
      requiresLifePayment: false,
      requiresNotYourTurn: true,
    });
  });
});
