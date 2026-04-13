import { describe, it, expect } from 'vitest';
import { canCastAnySpell, canActivateAnyAbility, canRespond, canAct, canPlayLand } from '../src/state/modules/can-respond';
import type { GameContext } from '../src/state/context';
import type { PlayerID } from '../../shared/src';

/**
 * Helper to create a minimal game context for testing
 */
function createTestContext(state: any): GameContext {
  return {
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {
      // Mock function for testing
    },
  } as any;
}

function createConditionGatedPermanent(id: string, oracleText: string, extras?: Record<string, unknown>) {
  return {
    id,
    controller: 'p1',
    tapped: false,
    card: {
      name: id,
      type_line: 'Creature — Shapeshifter',
      power: '3',
      toughness: '3',
      oracle_text: oracleText,
      ...(extras || {}),
    },
  };
}

describe('canCastAnySpell', () => {
  it('should return false when hand is empty', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return false when hand has only sorceries and no mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'card1', 
              name: 'Giant Growth', 
              type_line: 'Sorcery',
              mana_cost: '{G}',
              oracle_text: 'Target creature gets +3/+3 until end of turn.',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when hand has instant with available mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'card1', 
              name: 'Lightning Bolt', 
              type_line: 'Instant',
              mana_cost: '{R}',
              oracle_text: 'Deal 3 damage to any target.',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when hand has flash creature with available mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'card1', 
              name: 'Ambush Viper', 
              type_line: 'Creature — Snake',
              mana_cost: '{1}{G}',
              oracle_text: 'Flash\nDeathtouch',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when an Adventure instant face is castable from hand', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'adventure1',
              name: 'Storybook Creature',
              layout: 'adventure',
              type_line: 'Creature — Human Wizard',
              mana_cost: '{2}{U}',
              oracle_text: 'Creature face',
              card_faces: [
                {
                  name: 'Storybook Creature',
                  type_line: 'Creature — Human Wizard',
                  mana_cost: '{2}{U}',
                  oracle_text: 'Creature face',
                },
                {
                  name: 'Quick Tale',
                  type_line: 'Instant — Adventure',
                  mana_cost: '{U}',
                  oracle_text: 'Draw a card.',
                },
              ],
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      battlefield: [],
      stack: [],
    });

    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when spell requires a creature target but no creatures exist', () => {
    const ctx = createTestContext({
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [],
      zones: {
        p1: {
          hand: [
            {
              id: 'card1',
              name: 'Murder',
              type_line: 'Instant',
              mana_cost: '{1}{B}{B}',
              oracle_text: 'Destroy target creature.',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 1 },
      },
      stack: [],
    });

    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return false when counterspell has no valid stack targets', () => {
    const ctx = createTestContext({
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [],
      zones: {
        p1: {
          hand: [
            {
              id: 'card1',
              name: 'Counterspell',
              type_line: 'Instant',
              mana_cost: '{U}{U}',
              oracle_text: 'Counter target spell.',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 },
      },
      stack: [],
    });

    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return false when hand has instant but not enough mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'card1', 
              name: 'Counterspell', 
              type_line: 'Instant',
              mana_cost: '{U}{U}',
              oracle_text: 'Counter target spell.',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true for Force of Will with blue card in hand and 1 life', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'fow', 
              name: 'Force of Will', 
              type_line: 'Instant',
              mana_cost: '{3}{U}{U}',
              oracle_text: 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target spell.',
              colors: ['U'],
            },
            { 
              id: 'blue_card', 
              name: 'Brainstorm', 
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.',
              colors: ['U'],
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      life: {
        p1: 20,
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true for Fierce Guardianship when controlling commander', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'fg', 
              name: 'Fierce Guardianship', 
              type_line: 'Instant',
              mana_cost: '{2}{U}',
              oracle_text: 'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
              colors: ['U'],
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'commander1',
          controller: 'p1',
          card: {
            name: 'Atraxa, Praetors\' Voice',
            type_line: 'Legendary Creature — Phyrexian Angel Horror',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
  });
});

describe('canPlayLand', () => {
  it('does not treat transform front-face enchantments as lands in hand', () => {
    const ctx = createTestContext({
      phase: 'precombatMain',
      step: 'MAIN1',
      turnPlayer: 'p1',
      landsPlayedThisTurn: { p1: 0 },
      battlefield: [],
      zones: {
        p1: {
          hand: [
            {
              id: 'growing_rites',
              name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
              layout: 'transform',
              type_line: 'Legendary Enchantment // Legendary Land',
              oracle_text: '',
              card_faces: [
                {
                  name: 'Growing Rites of Itlimoc',
                  type_line: 'Legendary Enchantment',
                  oracle_text: 'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library.',
                  mana_cost: '{2}{G}',
                },
                {
                  name: 'Itlimoc, Cradle of the Sun',
                  type_line: 'Legendary Land',
                  oracle_text: '(Transforms from Growing Rites of Itlimoc.)',
                },
              ],
            },
          ],
          handCount: 1,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
          libraryCount: 0,
        },
      },
    });

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('treats library[0] as the top card when top-of-library land play is allowed', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'future_sight',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Future Sight',
            type_line: 'Enchantment',
            oracle_text: 'Play with the top card of your library revealed. You may play the top card of your library.',
          },
        },
      ],
      landsPlayedThisTurn: { p1: 0 },
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
          libraryCount: 2,
        },
      },
    });

    (ctx as any).libraries = new Map([
      ['p1', [
        { id: 'forest_top', name: 'Forest', type_line: 'Basic Land - Forest' },
        { id: 'opt_bottom', name: 'Opt', type_line: 'Instant' },
      ]],
    ]);

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('does not allow a lower library land when the top card is not a land', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'future_sight',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Future Sight',
            type_line: 'Enchantment',
            oracle_text: 'Play with the top card of your library revealed. You may play the top card of your library.',
          },
        },
      ],
      landsPlayedThisTurn: { p1: 0 },
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
          libraryCount: 2,
        },
      },
    });

    (ctx as any).libraries = new Map([
      ['p1', [
        { id: 'opt_top', name: 'Opt', type_line: 'Instant' },
        { id: 'forest_bottom', name: 'Forest', type_line: 'Basic Land - Forest' },
      ]],
    ]);

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(false);
  });
});

describe('canActivateAnyAbility', () => {
  it('should return false when battlefield is empty', () => {
    const ctx = createTestContext({
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return false when controlling only mana dork (mana abilities dont require priority)', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'creature1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    // Mana abilities don't use the stack and don't require priority (Rule 605)
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when controlling creature with non-mana tap ability', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'creature1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Merfolk Looter',
            type_line: 'Creature — Merfolk Rogue',
            oracle_text: '{T}: Draw a card, then discard a card.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    // Non-mana abilities DO require priority
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when the only activated ability requires metalcraft and metalcraft is inactive', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'argent_sphinx_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Argent Sphinx',
            type_line: 'Artifact Creature — Sphinx',
            oracle_text: 'Flying\nMetalcraft — {U}: Exile Argent Sphinx. Return it to the battlefield under your control at the beginning of the next end step.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when an activated metalcraft ability has three artifacts online', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'argent_sphinx_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Argent Sphinx',
            type_line: 'Artifact Creature — Sphinx',
            oracle_text: 'Flying\nMetalcraft — {U}: Exile Argent Sphinx. Return it to the battlefield under your control at the beginning of the next end step.',
          },
        },
        {
          id: 'artifact_2',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Test Relic',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
        {
          id: 'artifact_3',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Test Bauble',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when a threshold-only activated ability is inactive', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'threshold_tester',
          'Threshold — {1}{G}: Regenerate this creature. Activate only if there are seven or more cards in your graveyard.',
          { type_line: 'Creature — Human Druid', power: '3', toughness: '1' },
        ),
      ],
      zones: {
        p1: { graveyard: [] },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when a threshold-only activated ability is active', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'threshold_tester',
          'Threshold — {1}{G}: Regenerate this creature. Activate only if there are seven or more cards in your graveyard.',
          { type_line: 'Creature — Human Druid', power: '3', toughness: '1' },
        ),
      ],
      zones: {
        p1: {
          graveyard: Array.from({ length: 7 }, (_, index) => ({ id: `grave_${index}`, name: `Card ${index}` })),
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when a delirium-only activated ability is inactive', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'delirium_tester',
          'Delirium — {2}{U}, {T}: Draw a card. Activate only if there are four or more card types among cards in your graveyard.',
          { type_line: 'Creature — Merfolk Wizard', power: '1', toughness: '1' },
        ),
      ],
      zones: {
        p1: { graveyard: [{ id: 'g1', type_line: 'Creature' }, { id: 'g2', type_line: 'Instant' }] },
      },
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when a delirium-only activated ability is active', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'delirium_tester',
          'Delirium — {2}{U}, {T}: Draw a card. Activate only if there are four or more card types among cards in your graveyard.',
          { type_line: 'Creature — Merfolk Wizard', power: '1', toughness: '1' },
        ),
      ],
      zones: {
        p1: {
          graveyard: [
            { id: 'g1', type_line: 'Creature' },
            { id: 'g2', type_line: 'Instant' },
            { id: 'g3', type_line: 'Sorcery' },
            { id: 'g4', type_line: 'Artifact' },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when a ferocious-only activated ability is inactive', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'ferocious_tester',
          'Ferocious — {2}{G}{U}: Draw a card for each creature you control with power 4 or greater.',
          { type_line: 'Creature — Orc Shaman', power: '2', toughness: '2' },
        ),
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 1, colorless: 2 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when a ferocious-only activated ability is active', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'ferocious_tester',
          'Ferocious — {2}{G}{U}: Draw a card for each creature you control with power 4 or greater.',
          { type_line: 'Creature — Orc Shaman', power: '4', toughness: '2' },
        ),
        {
          id: 'powerful_creature',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Powerhouse',
            type_line: 'Creature — Beast',
            power: '4',
            toughness: '4',
            oracle_text: '',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 1, colorless: 2 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when a formidable-only activated ability is inactive', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'formidable_tester',
          'Formidable — {4}{R}{R}: Create a 4/4 red Dragon creature token with flying. Activate only if creatures you control have total power 8 or greater.',
          { type_line: 'Creature — Human Shaman', power: '2', toughness: '2' },
        ),
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 4 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when a formidable-only activated ability is active', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'formidable_tester',
          'Formidable — {4}{R}{R}: Create a 4/4 red Dragon creature token with flying. Activate only if creatures you control have total power 8 or greater.',
          { type_line: 'Creature — Human Shaman', power: '3', toughness: '2' },
        ),
        {
          id: 'big_ally',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Big Ally',
            type_line: 'Creature — Giant',
            power: '5',
            toughness: '5',
            oracle_text: '',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 4 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when a coven-only activated ability is inactive', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'coven_tester',
          'Coven — {1}{W}: Choose a color. This creature gains hexproof from that color until end of turn and can\'t be blocked by creatures of that color this turn. Activate only if you control three or more creatures with different powers.',
          { type_line: 'Creature — Human Soldier', power: '3', toughness: '2' },
        ),
        {
          id: 'same_power_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Soldier A',
            type_line: 'Creature — Human',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
        {
          id: 'same_power_2',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Soldier B',
            type_line: 'Creature — Human',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
      ],
      manaPool: {
        p1: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when a coven-only activated ability is active', () => {
    const ctx = createTestContext({
      battlefield: [
        createConditionGatedPermanent(
          'coven_tester',
          'Coven — {1}{W}: Choose a color. This creature gains hexproof from that color until end of turn and can\'t be blocked by creatures of that color this turn. Activate only if you control three or more creatures with different powers.',
          { type_line: 'Creature — Human Soldier', power: '3', toughness: '2' },
        ),
        {
          id: 'low_power',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Low Power',
            type_line: 'Creature — Human',
            power: '1',
            toughness: '1',
            oracle_text: '',
          },
        },
        {
          id: 'high_power',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'High Power',
            type_line: 'Creature — Human',
            power: '5',
            toughness: '5',
            oracle_text: '',
          },
        },
      ],
      manaPool: {
        p1: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when creature with tap ability is tapped', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'creature1',
          controller: 'p1',
          tapped: true,
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when controlling permanent with activated ability and mana', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'artifact1',
          controller: 'p1',
          card: {
            name: 'Aetherflux Reservoir',
            type_line: 'Artifact',
            oracle_text: 'Whenever you cast a spell, you gain 1 life for each spell you\'ve cast this turn.\n{50}: Aetherflux Reservoir deals 50 damage to any target.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 50 },
      },
    });
    
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when not controlling any permanents', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'creature1',
          controller: 'p2',
          tapped: false,
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when controlling untapped Evolving Wilds (fetchland)', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'fetchland1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Evolving Wilds',
            type_line: 'Land',
            oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    // Fetchlands should be detected - they have tap+sacrifice abilities
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when controlling tapped Evolving Wilds', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'fetchland1',
          controller: 'p1',
          tapped: true,
          card: {
            name: 'Evolving Wilds',
            type_line: 'Land',
            oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    // Tapped fetchlands cannot be activated
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when controlling untapped Polluted Delta with enough life', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'fetchland1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Polluted Delta',
            type_line: 'Land',
            oracle_text: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      life: {
        p1: 20,
      },
    });
    
    // Premium fetchlands should be detected when player has enough life
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when controlling untapped Polluted Delta even with 1 life', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'fetchland1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Polluted Delta',
            type_line: 'Land',
            oracle_text: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      life: {
        p1: 1,
      },
    });
    
    // Fetchland should be detected because sacrifice cost check happens before life cost check
    // Note: The permanment itself can always be sacrificed (it's sacrificing itself)
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when controlling a Station with another untapped creature during a main phase', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'station1',
          controller: 'p1',
          tapped: true,
          card: {
            name: 'Test Spacecraft',
            type_line: 'Artifact - Spacecraft',
            oracle_text: 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It\'s an artifact creature at 8+.)',
            keywords: ['Station'],
          },
        },
        {
          id: 'creature1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Support Creature',
            type_line: 'Creature - Human',
            oracle_text: '',
          },
        },
      ],
      stack: [],
      turnPlayer: 'p1',
      phase: 'PRECOMBAT_MAIN',
      step: 'MAIN_1',
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });
});

describe('canRespond', () => {
  it('should return false when player has no instants and no activatable abilities', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'card1', 
              name: 'Giant Growth', 
              type_line: 'Sorcery',
              mana_cost: '{G}',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when player has instant with mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'card1', 
              name: 'Lightning Bolt', 
              type_line: 'Instant',
              mana_cost: '{R}',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when Split Second is on the stack, even if player has an instant', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'bolt',
              name: 'Lightning Bolt',
              type_line: 'Instant',
              mana_cost: '{R}',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
      stack: [
        {
          id: 'stack_ss',
          type: 'spell',
          controller: 'p2',
          card: {
            name: 'Sudden Shock',
            oracle_text: 'Split second\nSudden Shock deals 2 damage to any target.',
            keywords: ['Split second'],
          },
        },
      ],
    });

    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return false when player only has mana abilities (dont require priority)', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      battlefield: [
        {
          id: 'creature1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'UPKEEP',
      stack: [],
    });
    
    // Mana abilities don't require priority - should auto-pass
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when player has free spell via alternate cost', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { 
              id: 'fg', 
              name: 'Fierce Guardianship', 
              type_line: 'Instant',
              mana_cost: '{2}{U}',
              oracle_text: 'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'commander1',
          controller: 'p1',
          card: {
            name: 'Commander',
            type_line: 'Legendary Creature — Human Wizard',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when player has flashback instant in graveyard with mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'card1',
              name: 'Desperate Ravings',
              type_line: 'Instant',
              mana_cost: '{1}{R}',
              oracle_text: 'Draw two cards, then discard a card at random.\nFlashback {2}{U}',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return false when player has flashback instant in graveyard without mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'card1',
              name: 'Desperate Ravings',
              type_line: 'Instant',
              mana_cost: '{1}{R}',
              oracle_text: 'Draw two cards, then discard a card at random.\nFlashback {2}{U}',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return true when player has foretell instant in exile with mana', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'card1',
            name: 'Saw It Coming',
            type_line: 'Instant',
            mana_cost: '{2}{U}{U}',
            oracle_text: 'Counter target spell.\nForetell {1}{U}',
          },
        ],
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when player has playable instant from exile via impulse draw', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'bolt1',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        ],
      },
      playableFromExile: {
        p1: ['bolt1'], // Card marked as playable from exile (e.g., Light Up the Stage)
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
    });
    
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should honor numeric playable-from-exile entries for the current turn', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'bolt_turn_0',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        ],
      },
      playableFromExile: {
        p1: { bolt_turn_0: 0 },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
      turnNumber: 0,
    });

    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should ignore expired numeric playable-from-exile entries', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'bolt_expired',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        ],
      },
      playableFromExile: {
        p1: { bolt_expired: 4 },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
      turnNumber: 5,
    });

    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });
});

describe('canAct', () => {
  it('should return true when player can cast sorcery from hand in main phase', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'card1',
              name: 'Divination',
              type_line: 'Sorcery',
              mana_cost: '{2}{U}',
              oracle_text: 'Draw two cards.',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
      step: 'MAIN1',
      stack: [],
    });
    
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when a modal DFC has a spell face and a land face in hand', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'mdfc1',
              name: 'Shatterskull Smashing',
              layout: 'modal_dfc',
              type_line: 'Land',
              mana_cost: '',
              oracle_text: '',
              card_faces: [
                {
                  name: 'Shatterskull Smashing',
                  type_line: 'Sorcery',
                  mana_cost: '{X}{R}{R}',
                  oracle_text: 'Shatterskull Smashing deals X damage divided as you choose among up to two target creatures and/or planeswalkers.',
                },
                {
                  name: 'Shatterskull, the Hammer Pass',
                  type_line: 'Land',
                  oracle_text: '{T}: Add {R}.',
                },
              ],
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'target_creature',
          controller: 'p2',
          card: {
            name: 'Runeclaw Bear',
            type_line: 'Creature — Bear',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 1 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when player has flashback sorcery in graveyard with mana in main phase', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'card1',
              name: 'Deep Analysis',
              type_line: 'Sorcery',
              mana_cost: '{3}{U}',
              oracle_text: 'Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
      life: {
        p1: 20,
      },
      step: 'MAIN1',
      stack: [],
    });
    
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when player has foretell creature in exile with mana in main phase', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'card1',
            name: 'Behold the Multiverse',
            type_line: 'Sorcery',
            mana_cost: '{3}{U}',
            oracle_text: 'Scry 2, then draw two cards.\nForetell {1}{U}',
          },
        ],
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
      step: 'MAIN1',
      stack: [],
    });
    
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when player has creature from exile via impulse draw in main phase', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'creature1',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            oracle_text: '',
          },
        ],
      },
      playableFromExile: {
        p1: ['creature1'], // Card marked as playable from exile (e.g., Act on Impulse)
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      },
      step: 'MAIN1',
      stack: [],
    });
    
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should honor numeric playable-from-exile entries in main phase', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'creature_turn_3',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            oracle_text: '',
          },
        ],
      },
      playableFromExile: {
        p1: { creature_turn_3: 3 },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      },
      step: 'MAIN1',
      stack: [],
      turnNumber: 3,
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should ignore expired numeric playable-from-exile entries in main phase', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
        },
      },
      exile: {
        p1: [
          {
            id: 'creature_expired',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            oracle_text: '',
          },
        ],
      },
      playableFromExile: {
        p1: { creature_expired: 2 },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      },
      step: 'MAIN1',
      stack: [],
      turnNumber: 3,
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should ignore expired numeric land permissions from exile', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          exile: [
            {
              id: 'land_expired',
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '',
            },
          ],
        },
      },
      playableFromExile: {
        p1: { land_expired: 2 },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      stack: [],
      turnNumber: 3,
      turnPlayer: 'p1',
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(false);
  });
});
