import { describe, expect, it } from 'vitest';

import { isAiContextuallyIdleForAutoPass } from '../src/socket/ai-handlers/aiAutoPassContextualIdle.js';
import { canRespond, getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import type { GameContext } from '../src/state/context.js';
import type { PlayerID } from '../../shared/src/index.js';

function createTestContext(state: any): GameContext {
  return {
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    seq: { value: 0 },
    bumpSeq: () => undefined,
  } as any;
}

const entrapment = {
  id: 'entrapment-1',
  name: 'Entrapment Maneuver',
  type_line: 'Instant',
  mana_cost: '{3}{W}',
  oracle_text: "Target player sacrifices an attacking creature of their choice. You create X 1/1 white Soldier creature tokens, where X is that creature's toughness.",
};

function kingOffTurnState(overrides: Record<string, unknown> = {}) {
  return {
    turnPlayer: 'human',
    priority: 'ai',
    phase: 'combat',
    step: 'END_COMBAT',
    players: [
      { id: 'ai', name: 'King', isAI: true, life: 40 },
      { id: 'human', name: 'Human', isAI: false, life: 40 },
    ],
    battlefield: [],
    stack: [],
    zones: {
      ai: { hand: [entrapment] },
      human: { hand: [] },
    },
    manaPool: {
      ai: { white: 1, blue: 0, black: 0, red: 1, green: 2, colorless: 0 },
    },
    ...overrides,
  };
}

describe('AI contextual auto-pass idle', () => {
  it('treats an AI with only Entrapment Maneuver and no attackers as contextually idle', () => {
    const ctx = createTestContext(kingOffTurnState());
    expect(canRespond(ctx, 'ai' as PlayerID)).toBe(true);
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(true);
  });

  it('does not treat a human with the same Entrapment as contextually idle', () => {
    const ctx = createTestContext(kingOffTurnState({
      players: [
        { id: 'ai', name: 'Human King', isAI: false, life: 40 },
        { id: 'human', name: 'Human', isAI: false, life: 40 },
      ],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  it('keeps thinking when an opponent is attacking (Entrapment has context)', () => {
    const ctx = createTestContext(kingOffTurnState({
      step: 'DECLARE_ATTACKERS',
      battlefield: [{
        id: 'bear',
        controller: 'human',
        attacking: 'ai',
        card: { name: 'Bear', type_line: 'Creature — Bear', toughness: '2' },
      }],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  it('keeps thinking when it can pay {3} to activate an opponent\'s Xantcha', () => {
    const ctx = createTestContext(kingOffTurnState({
      battlefield: [{
        id: 'stack_vzea37q0',
        controller: 'human',
        owner: 'human',
        tapped: false,
        card: {
          id: 'xantcha_card',
          name: 'Xantcha, Sleeper Agent',
          type_line: 'Legendary Creature — Phyrexian Minion',
          oracle_text:
            "Xantcha enters under the control of an opponent of your choice.\n" +
            "Xantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.\n" +
            "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.",
        },
      }],
    }));
    expect(canRespond(ctx, 'ai' as PlayerID)).toBe(true);
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  const elixirPermanent = {
    id: 'stack_elixir',
    controller: 'ai',
    tapped: false,
    card: {
      id: 'elixir_card',
      name: 'Elixir of Immortality',
      type_line: 'Artifact',
      oracle_text: '{2}, {T}: You gain 5 life. Shuffle Elixir of Immortality and your graveyard into your library.',
    },
  };

  it('treats Elixir of Immortality as idle at high life with an empty graveyard and no threat', () => {
    const ctx = createTestContext(kingOffTurnState({
      zones: {
        ai: { hand: [], graveyard: [] },
        human: { hand: [] },
      },
      battlefield: [elixirPermanent],
    }));
    expect(canRespond(ctx, 'ai' as PlayerID)).toBe(true);
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(true);
  });

  it('keeps thinking on Elixir when life gain is needed', () => {
    const ctx = createTestContext(kingOffTurnState({
      players: [
        { id: 'ai', name: 'King', isAI: true, life: 18 },
        { id: 'human', name: 'Human', isAI: false, life: 40 },
      ],
      zones: {
        ai: { hand: [], graveyard: [] },
        human: { hand: [] },
      },
      battlefield: [elixirPermanent],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  it('keeps thinking on Elixir when attackers are coming at it', () => {
    const ctx = createTestContext(kingOffTurnState({
      step: 'DECLARE_ATTACKERS',
      zones: {
        ai: { hand: [], graveyard: [] },
        human: { hand: [] },
      },
      battlefield: [
        elixirPermanent,
        {
          id: 'bear',
          controller: 'human',
          attacking: 'ai',
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  it('keeps thinking on Elixir when the graveyard is worth shuffling back', () => {
    const ctx = createTestContext(kingOffTurnState({
      zones: {
        ai: {
          hand: [],
          graveyard: [
            { id: 'gy1', name: 'Kodama\'s Reach', type_line: 'Sorcery' },
            { id: 'gy2', name: 'Cultivate', type_line: 'Sorcery' },
            { id: 'gy3', name: 'Cyclonic Rift', type_line: 'Instant' },
          ],
        },
        human: { hand: [] },
      },
      battlefield: [elixirPermanent],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  it('keeps thinking on Elixir when it is targeted for destruction', () => {
    const ctx = createTestContext(kingOffTurnState({
      zones: {
        ai: { hand: [], graveyard: [] },
        human: { hand: [] },
      },
      battlefield: [elixirPermanent],
      stack: [{
        id: 'naturalize',
        type: 'spell',
        controller: 'human',
        targets: ['stack_elixir'],
        card: {
          name: 'Naturalize',
          type_line: 'Instant',
          oracle_text: 'Destroy target artifact or enchantment.',
        },
      }],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });

  it('keeps thinking on Elixir when the graveyard is about to be exiled', () => {
    const ctx = createTestContext(kingOffTurnState({
      zones: {
        ai: { hand: [], graveyard: [{ id: 'gy1', name: 'Sol Ring', type_line: 'Artifact' }] },
        human: { hand: [] },
      },
      battlefield: [elixirPermanent],
      stack: [{
        id: 'bojuka',
        type: 'triggered_ability',
        controller: 'human',
        targets: ['ai'],
        card: {
          name: 'Bojuka Bog',
          type_line: 'Land',
          oracle_text: 'When Bojuka Bog enters, exile target player\'s graveyard.',
        },
      }],
    }));
    expect(isAiContextuallyIdleForAutoPass(ctx, 'ai' as PlayerID)).toBe(false);
  });
});

describe('canRespond / spell-candidate cache', () => {
  it('returns the same spell candidates on a repeated call without mutating state', () => {
    const ctx = createTestContext(kingOffTurnState());
    const first = getCastableSpellCandidates(ctx, 'ai' as PlayerID, {
      mode: 'response',
      skipIgnoredCards: true,
      allowAlternateCosts: true,
      allowUnknownCostFallback: true,
      conservativeTargets: false,
    });
    const second = getCastableSpellCandidates(ctx, 'ai' as PlayerID, {
      mode: 'response',
      skipIgnoredCards: true,
      allowAlternateCosts: true,
      allowUnknownCostFallback: true,
      conservativeTargets: false,
    });
    expect(first.map((c) => c.castCard?.name || c.card?.name)).toEqual(['Entrapment Maneuver']);
    expect(second.map((c) => c.castCard?.name || c.card?.name)).toEqual(['Entrapment Maneuver']);
    expect(second).not.toBe(first);
  });

  it('invalidates when the stack gains a spell', () => {
    const state = kingOffTurnState();
    const ctx = createTestContext(state);
    expect(canRespond(ctx, 'ai' as PlayerID)).toBe(true);
    state.stack = [{
      id: 'bolt',
      type: 'spell',
      controller: 'human',
      card: { name: 'Lightning Bolt', type_line: 'Instant' },
    }];
    expect(canRespond(ctx, 'ai' as PlayerID)).toBe(true);
    const names = getCastableSpellCandidates(ctx, 'ai' as PlayerID, {
      mode: 'response',
      skipIgnoredCards: true,
      allowAlternateCosts: true,
      allowUnknownCostFallback: true,
      conservativeTargets: false,
    }).map((c) => c.castCard?.name || c.card?.name);
    expect(names).toContain('Entrapment Maneuver');
  });
});
