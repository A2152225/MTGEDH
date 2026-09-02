import { describe, expect, it } from 'vitest';

import {
  buildCommanderFreeCastPaymentExtras,
  canUseFreeAlternateCost,
  getOmniscienceSource,
  hasCommanderFreeAlternateCost,
} from '../src/state/modules/alternate-costs.js';
import { sanitizeStepForClient } from '../src/socket/resolution.js';
import { getOracleTextFromResolutionStep } from '../src/utils/oraclePromptContext.js';
import { ResolutionStepType } from '../src/state/resolution/index.js';
import type { GameContext } from '../src/state/context';
import type { PlayerID } from '../../shared/src';

const FG_ORACLE =
  'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.';

const MULTI_ALT_ORACLE = [
  'Warp {2}{U}',
  'Dash {1}{R}',
  'Blitz {2}{B}',
  'Mutate {2}{G}{G}',
  'Overload {6}{R}',
  'Spectacle {R}',
  'You may cast this spell without paying its mana cost.',
].join('\n');

function createTestContext(state: any, commandZone: any = {}): GameContext {
  return {
    state,
    commandZone,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

describe('alternate-cost payment presentation', () => {
  it('detects free cast when controlling a legendary creature commander', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'cmd',
          controller: 'p1',
          isCommander: true,
          card: {
            id: 'cmd_card',
            name: 'Atraxa, Praetors\' Voice',
            type_line: 'Legendary Creature — Phyrexian Angel Horror',
          },
        },
      ],
    });

    expect(hasCommanderFreeAlternateCost(ctx, 'p1' as PlayerID, {
      name: 'Fierce Guardianship',
      oracle_text: FG_ORACLE,
    })).toBe(true);
  });

  it('detects free cast when controlling a legendary planeswalker commander', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'cmd',
          controller: 'p1',
          isCommander: true,
          card: {
            id: 'cmd_card',
            name: 'Aminatou, the Fateshifter',
            type_line: 'Legendary Planeswalker — Aminatou',
          },
        },
      ],
    });

    expect(hasCommanderFreeAlternateCost(ctx, 'p1' as PlayerID, {
      name: 'Fierce Guardianship',
      oracle_text: FG_ORACLE,
    })).toBe(true);

    const extras = buildCommanderFreeCastPaymentExtras(ctx, 'p1' as PlayerID, {
      name: 'Fierce Guardianship',
      oracle_text: FG_ORACLE,
    });
    expect(extras?.preferredAlternateCostId).toBe('free');
    expect(extras?.extraAlternateCosts).toEqual([
      expect.objectContaining({ id: 'free', manaCost: '{0}' }),
    ]);
  });

  it('does not offer free cast without a commander on the battlefield', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'bear',
          controller: 'p1',
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
          },
        },
      ],
    });

    expect(hasCommanderFreeAlternateCost(ctx, 'p1' as PlayerID, {
      name: 'Fierce Guardianship',
      oracle_text: FG_ORACLE,
    })).toBe(false);
    expect(buildCommanderFreeCastPaymentExtras(ctx, 'p1' as PlayerID, {
      name: 'Fierce Guardianship',
      oracle_text: FG_ORACLE,
    })).toBeNull();
  });

  it('reads top-level oracleText from payment steps for prompt context', () => {
    expect(getOracleTextFromResolutionStep({
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      oracleText: FG_ORACLE,
    })).toBe(FG_ORACLE);
  });

  it('preserves all alternate-cost presentation fields on sanitized mana payment steps', () => {
    const extraAlternateCosts = [
      {
        id: 'warp',
        label: 'Warp',
        description: 'Cast for warp cost; exile at the beginning of the next end step',
        manaCost: '{2}{U}',
      },
      {
        id: 'sneak',
        label: 'Sneak',
        description: 'Declare blockers step: return an unblocked attacker to hand',
        manaCost: '{1}{R}',
      },
      {
        id: 'free',
        label: 'Free Cast',
        description: 'Cast for free (you control a commander)',
        manaCost: '{0}',
      },
      {
        id: 'wubrg_self',
        label: 'WUBRG Cost',
        description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
        manaCost: '{W}{U}{B}{R}{G}',
      },
    ];

    const sanitized = sanitizeStepForClient('test-game', {
      id: 'step_1',
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1',
      description: 'Pay costs to cast Test Spell.',
      mandatory: true,
      createdAt: Date.now(),
      spellPaymentRequired: true,
      cardId: 'card_1',
      cardName: 'Test Spell',
      manaCost: '{3}{U}',
      effectId: 'effect_1',
      oracleText: MULTI_ALT_ORACLE,
      preferredAlternateCostId: 'free',
      extraAlternateCosts,
      fromZone: 'hand',
      xValue: 2,
      castWithoutPayingManaCost: false,
      convokeOptions: {
        availableCreatures: [{ id: 'c1', name: 'Elf', colors: ['G'], canTapFor: ['G', '1'] }],
        messages: ['Convoke available'],
      },
      sneakOptions: {
        availableCreatures: [{ id: 'a1', name: 'Goblin', attackTarget: 'p2' }],
        messages: ['Sneak available'],
      },
      harmonizeOptions: [{ id: 'h1', name: 'Bird' }],
      costAdjustment: {
        originalManaCost: '{3}{U}',
        adjustedManaCost: '{2}{U}',
        genericTax: 0,
        genericReduction: 1,
        messages: ['Cost reduction'],
      },
    } as any);

    expect(sanitized.oracleText).toBe(MULTI_ALT_ORACLE);
    expect(sanitized.preferredAlternateCostId).toBe('free');
    expect(sanitized.fromZone).toBe('hand');
    expect(sanitized.xValue).toBe(2);
    expect(sanitized.extraAlternateCosts).toEqual(extraAlternateCosts);
    expect(sanitized.convokeOptions?.availableCreatures?.[0]?.id).toBe('c1');
    expect(sanitized.sneakOptions?.availableCreatures?.[0]?.id).toBe('a1');
    expect(sanitized.harmonizeOptions?.[0]?.id).toBe('h1');
    expect(sanitized.costAdjustment?.adjustedManaCost).toBe('{2}{U}');
    expect(sanitized.spellPaymentRequired).toBe(true);
  });

  it('preserves graveyard flashback payment presentation fields', () => {
    const flashbackOracle = 'Draw two cards.\nFlashback {3}{U}';
    const sanitized = sanitizeStepForClient('test-game', {
      id: 'step_gy',
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1',
      description: 'Pay {3}{U} to cast Think Twice using flashback.',
      mandatory: true,
      createdAt: Date.now(),
      spellPaymentRequired: true,
      graveyardSpellCastManaPayment: true,
      cardId: 'tt',
      cardName: 'Think Twice',
      manaCost: '{3}{U}',
      fromZone: 'graveyard',
      abilityId: 'flashback',
      oracleText: flashbackOracle,
    } as any);

    expect(sanitized.oracleText).toBe(flashbackOracle);
    expect(sanitized.fromZone).toBe('graveyard');
    expect(sanitized.graveyardSpellCastManaPayment).toBe(true);
    expect(sanitized.abilityId).toBe('flashback');
  });
});

const POSSIBILITY_STORM_ORACLE =
  'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with this enchantment on the bottom of their library in a random order.';

describe('canUseFreeAlternateCost', () => {
  it('does not treat Possibility Storm trigger text as a self Free Cast', () => {
    const ctx = createTestContext({ battlefield: [] });
    expect(canUseFreeAlternateCost(ctx, 'p1' as PlayerID, {
      name: 'Possibility Storm',
      oracle_text: POSSIBILITY_STORM_ORACLE,
    })).toBe(false);
  });

  it('allows Omniscience and stamped without-paying casts', () => {
    const omniscienceCtx = createTestContext({
      battlefield: [{
        id: 'omni_1',
        controller: 'p1',
        card: {
          name: 'Omniscience',
          oracle_text: 'You may cast spells from your hand without paying their mana costs.',
        },
      }],
    });
    expect(canUseFreeAlternateCost(omniscienceCtx, 'p1' as PlayerID, {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    })).toBe(true);

    const emptyCtx = createTestContext({ battlefield: [] });
    expect(canUseFreeAlternateCost(emptyCtx, 'p1' as PlayerID, {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      castWithoutPayingManaCost: true,
    })).toBe(true);
  });

  it("does not treat Yusri's five-flip rider as battlefield Omniscience", () => {
    const yusriOracle =
      'Flying\nWhenever Yusri attacks, choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. For each flip you lose, Yusri deals 2 damage to you. If you won five flips this way, you may cast spells from your hand this turn without paying their mana costs.';
    const yusriCtx = createTestContext({
      battlefield: [{
        id: 'yusri_1',
        controller: 'p1',
        card: {
          name: "Yusri, Fortune's Flame",
          oracle_text: yusriOracle,
        },
      }],
    });
    expect(getOmniscienceSource(yusriCtx, 'p1' as PlayerID)).toBeNull();
    expect(canUseFreeAlternateCost(yusriCtx, 'p1' as PlayerID, {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    })).toBe(false);
  });

  it('allows free hand casts from a this-turn lasting grant', () => {
    const grantCtx = createTestContext({
      battlefield: [],
      lastingEffects: [{
        type: 'freeHandCastsThisTurn',
        duration: 'this_turn',
        controllerId: 'p1',
        sourceId: 'yusri_1',
        sourceName: "Yusri, Fortune's Flame",
      }],
    });
    expect(getOmniscienceSource(grantCtx, 'p1' as PlayerID)).toEqual({
      sourceId: 'yusri_1',
      sourceName: "Yusri, Fortune's Flame",
    });
    expect(canUseFreeAlternateCost(grantCtx, 'p1' as PlayerID, {
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    })).toBe(true);
  });
});
