import { describe, it, expect } from 'vitest';
import { canCastAnySpell, canActivateAnyAbility, canRespond, canAct, canPlayLand, getCastableCommanderCandidates, getCastableSpellCandidates, getPlayableLandCandidates } from '../src/state/modules/can-respond';
import { applyTemporaryGraveyardKeywordGrantFromText, clearTemporaryGraveyardKeywordGrants } from '../src/state/modules/graveyard-permissions';
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

  it('should return true when the active plane reduces a red hand spell by a colored mana symbol', () => {
    const ctx = createTestContext({
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      zones: {
        p1: {
          hand: [
            {
              id: 'lightning_bolt',
              name: 'Lightning Bolt',
              type_line: 'Instant',
              mana_cost: '{R}',
              oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            },
          ],
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      stack: [],
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

      it('should return true when an instant is castable after a non-tap pay-life mana activation', () => {
        const ctx = createTestContext({
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
          ],
          zones: {
            p1: {
              hand: [
                {
                  id: 'opt_hand',
                  name: 'Opt',
                  type_line: 'Instant',
                  mana_cost: '{U}',
                  oracle_text: 'Scry 1, then draw a card.',
                },
              ],
              graveyard: [],
              exile: [],
            },
          },
          battlefield: [
            {
              id: 'pain_cache_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'pain_cache_card_1',
                name: 'Pain Cache',
                type_line: 'Artifact',
                oracle_text: 'Pay 1 life: Add {U}.\n{T}: Add {C}.',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          stack: [
            {
              id: 'spell_on_stack',
              card: {
                id: 'shock_1',
                name: 'Shock',
                type_line: 'Instant',
                mana_cost: '{R}',
                oracle_text: 'Shock deals 2 damage to any target.',
              },
            },
          ],
          turnPlayer: 'p2',
          priority: 'p1',
          step: 'DECLARE_ATTACKERS',
        });

        expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
        expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
      });

      it('should return true when a response requires repeated non-tap pay-life activations from the same source', () => {
        const ctx = createTestContext({
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
          ],
          zones: {
            p1: {
              hand: [
                {
                  id: 'counterspell_hand',
                  name: 'Counterspell',
                  type_line: 'Instant',
                  mana_cost: '{U}{U}',
                  oracle_text: 'Counter target spell.',
                },
              ],
              graveyard: [],
              exile: [],
            },
          },
          battlefield: [
            {
              id: 'pain_cache_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'pain_cache_card_1',
                name: 'Pain Cache',
                type_line: 'Artifact',
                oracle_text: 'Pay 1 life: Add {U}.\n{T}: Add {C}.',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          stack: [
            {
              id: 'spell_on_stack',
              card: {
                id: 'shock_1',
                name: 'Shock',
                type_line: 'Instant',
                mana_cost: '{R}',
                oracle_text: 'Shock deals 2 damage to any target.',
              },
            },
          ],
          turnPlayer: 'p2',
          priority: 'p1',
          step: 'DECLARE_ATTACKERS',
        });

        expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
        expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
      });

      it('should return true when a response is only castable after a non-tap return-to-hand mana activation', () => {
        const ctx = createTestContext({
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
          ],
          zones: {
            p1: {
              hand: [
                {
                  id: 'counterspell_hand',
                  name: 'Counterspell',
                  type_line: 'Instant',
                  mana_cost: '{U}{U}',
                  oracle_text: 'Counter target spell.',
                },
              ],
              graveyard: [],
              exile: [],
            },
          },
          battlefield: [
            {
              id: 'tidal_commons_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'tidal_commons_card_1',
                name: 'Tidal Commons',
                type_line: 'Land',
                oracle_text: "Return another land you control to its owner's hand: Add {U}{U}.",
              },
            },
            {
              id: 'plains_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'plains_card_1',
                name: 'Plains',
                type_line: 'Basic Land - Plains',
                oracle_text: '',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          stack: [
            {
              id: 'spell_on_stack',
              card: {
                id: 'shock_1',
                name: 'Shock',
                type_line: 'Instant',
                mana_cost: '{R}',
                oracle_text: 'Shock deals 2 damage to any target.',
              },
            },
          ],
          turnPlayer: 'p2',
          priority: 'p1',
          step: 'DECLARE_ATTACKERS',
        });

        expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
        expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
      });

      it('should return true when an instant is castable after a non-tap discard mana activation', () => {
        const ctx = createTestContext({
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
          ],
          zones: {
            p1: {
              hand: [
                {
                  id: 'opt_hand',
                  name: 'Opt',
                  type_line: 'Instant',
                  mana_cost: '{U}',
                  oracle_text: 'Scry 1, then draw a card.',
                  cmc: 1,
                },
                {
                  id: 'colossify_hand',
                  name: 'Colossify',
                  type_line: 'Sorcery',
                  mana_cost: '{5}{G}{G}',
                  oracle_text: 'Target creature gets +20/+20 until end of turn.',
                  cmc: 7,
                },
              ],
              graveyard: [],
              exile: [],
            },
          },
          battlefield: [
            {
              id: 'mind_cache_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'mind_cache_card_1',
                name: 'Mind Cache',
                type_line: 'Artifact',
                oracle_text: 'Discard a card: Add {U}.',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          stack: [
            {
              id: 'spell_on_stack',
              card: {
                id: 'shock_1',
                name: 'Shock',
                type_line: 'Instant',
                mana_cost: '{R}',
                oracle_text: 'Shock deals 2 damage to any target.',
              },
            },
          ],
          turnPlayer: 'p2',
          priority: 'p1',
          step: 'DECLARE_ATTACKERS',
        });

        expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
        expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
      });

      it('should return false when the only discard payment would require discarding the spell being cast', () => {
        const ctx = createTestContext({
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
          ],
          zones: {
            p1: {
              hand: [
                {
                  id: 'opt_hand',
                  name: 'Opt',
                  type_line: 'Instant',
                  mana_cost: '{U}',
                  oracle_text: 'Scry 1, then draw a card.',
                  cmc: 1,
                },
              ],
              graveyard: [],
              exile: [],
            },
          },
          battlefield: [
            {
              id: 'mind_cache_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'mind_cache_card_1',
                name: 'Mind Cache',
                type_line: 'Artifact',
                oracle_text: 'Discard a card: Add {U}.',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          stack: [
            {
              id: 'spell_on_stack',
              card: {
                id: 'shock_1',
                name: 'Shock',
                type_line: 'Instant',
                mana_cost: '{R}',
                oracle_text: 'Shock deals 2 damage to any target.',
              },
            },
          ],
          turnPlayer: 'p2',
          priority: 'p1',
          step: 'DECLARE_ATTACKERS',
        });

        expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
        expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
      });

      it('should return false when an alternate-cost improvise line would require discarding the spell being cast', () => {
        const ctx = createTestContext({
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
          ],
          zones: {
            p1: {
              hand: [
                {
                  id: 'rebuke_hand',
                  name: 'Metallic Rebuke Clone',
                  type_line: 'Instant',
                  mana_cost: '{2}{U}',
                  oracle_text: 'Improvise\nCounter target spell unless its controller pays {3}.',
                  cmc: 3,
                },
              ],
              graveyard: [],
              exile: [],
            },
          },
          battlefield: [
            {
              id: 'mind_cache_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'mind_cache_card_1',
                name: 'Mind Cache',
                type_line: 'Artifact',
                oracle_text: 'Discard a card: Add {U}.',
              },
            },
            {
              id: 'ornithopter_1',
              controller: 'p1',
              tapped: false,
              summoningSickness: false,
              card: {
                id: 'ornithopter_card_1',
                name: 'Ornithopter',
                type_line: 'Artifact Creature - Thopter',
                oracle_text: 'Flying',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          stack: [
            {
              id: 'spell_on_stack',
              card: {
                id: 'shock_1',
                name: 'Shock',
                type_line: 'Instant',
                mana_cost: '{R}',
                oracle_text: 'Shock deals 2 damage to any target.',
              },
            },
          ],
          turnPlayer: 'p2',
          priority: 'p1',
          step: 'DECLARE_ATTACKERS',
        });

        expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(false);
        expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
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

  it('should return true when the top card of the library is an instant and a card allows casting it', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
        },
      },
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
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      stack: [],
    });

    (ctx as any).libraries = new Map([
      ['p1', [
        {
          id: 'opt_top',
          name: 'Opt',
          type_line: 'Instant',
          mana_cost: '{U}',
          oracle_text: 'Scry 1. Draw a card.',
        },
      ]],
    ]);

    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when Elsha grants flash timing to a noncreature top card', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
          libraryCount: 1,
        },
      },
      battlefield: [
        {
          id: 'elsha',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Elsha of the Infinite',
            type_line: 'Legendary Creature — Djinn Monk',
            oracle_text: 'You may look at the top card of your library any time. You may cast noncreature spells from the top of your library as though they had flash.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      stack: [],
      step: 'DECLARE_ATTACKERS',
      turnPlayer: 'p2',
      priority: 'p1',
    });

    (ctx as any).libraries = new Map([
      ['p1', [
        {
          id: 'signet_top',
          name: 'Mind Stone',
          type_line: 'Artifact',
          mana_cost: '{2}',
          oracle_text: '{T}: Add {C}.',
          colors: [],
        },
      ]],
    ]);

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

describe('canAct combat blocker checks', () => {
  it('should return false for declare blockers when the only blocker is unleashed with a +1/+1 counter', () => {
    const ctx = createTestContext({
      players: [
        { id: 'p1', life: 40 },
        { id: 'p2', life: 40 },
      ],
      battlefield: [
        {
          id: 'unleash_blocker',
          controller: 'p1',
          tapped: false,
          unleashed: true,
          counters: { '+1/+1': 1 },
          card: {
            name: 'Gore-House Chainwalker',
            type_line: 'Creature — Human Warrior',
            power: '2',
            toughness: '1',
            oracle_text: 'Unleash (You may have this creature enter the battlefield with a +1/+1 counter on it. It can\'t block as long as it has a +1/+1 counter on it.)',
          },
        },
        {
          id: 'attacker',
          controller: 'p2',
          tapped: false,
          attacking: true,
          card: {
            name: 'Attacker',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
      ],
      declaredAttackers: [{ creatureId: 'attacker' }],
      zones: {
        p1: { hand: [], graveyard: [], exile: [] },
        p2: { hand: [], graveyard: [], exile: [] },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      stack: [],
      turnPlayer: 'p2',
      priority: 'p1',
      step: 'DECLARE_BLOCKERS',
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(false);
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

  it('does not treat cast-only top-library permission as permission to play a land', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'melek',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Melek, Izzet Paragon',
            type_line: 'Legendary Creature — Weird Wizard',
            oracle_text: 'Play with the top card of your library revealed. You may cast instant and sorcery spells from the top of your library.',
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
          libraryCount: 1,
        },
      },
    });

    (ctx as any).libraries = new Map([
      ['p1', [
        { id: 'forest_top', name: 'Forest', type_line: 'Basic Land - Forest' },
      ]],
    ]);

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('treats a graveyard land as playable when landPlayPermissions grant graveyard access', () => {
    const ctx = createTestContext({
      landsPlayedThisTurn: { p1: 0 },
      battlefield: [],
      landPlayPermissions: {
        p1: ['graveyard'],
      },
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [
            {
              id: 'wasteland_1',
              name: 'Wasteland',
              type_line: 'Land',
              oracle_text: '{T}: Add {C}.',
            },
          ],
          graveyardCount: 1,
          exile: [],
          exileCount: 0,
          libraryCount: 0,
        },
      },
    });

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('allows another land play when the active plane grants any-number-of-lands permission', () => {
    const ctx = createTestContext({
      activePlane: {
        id: 'naya_plane',
        name: 'Naya',
        oracle_text: 'You may play any number of lands on each of your turns.',
      },
      landsPlayedThisTurn: { p1: 1 },
      zones: {
        p1: {
          hand: [
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
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

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('only surfaces graveyard lands matching subtype-limited replay permissions', () => {
    const ctx = createTestContext({
      landsPlayedThisTurn: { p1: 0 },
      battlefield: [
        {
          id: 'titania_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: "Titania, Nature's Force",
            type_line: 'Legendary Creature — Elemental',
            oracle_text: 'You may play Forests from your graveyard.',
          },
        },
      ],
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
            },
            {
              id: 'wasteland_1',
              name: 'Wasteland',
              type_line: 'Land',
              oracle_text: '{T}: Add {C}.',
            },
          ],
          graveyardCount: 2,
          exile: [],
          exileCount: 0,
          libraryCount: 0,
        },
      },
      step: 'MAIN1',
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    const candidates = getPlayableLandCandidates(ctx, 'p1' as PlayerID);

    expect(candidates).toEqual([
      expect.objectContaining({ card: expect.objectContaining({ id: 'forest_1' }), sourceZone: 'graveyard' }),
    ]);
    expect(candidates.some((candidate) => candidate.card?.id === 'wasteland_1')).toBe(false);
    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('treats a land in exile as playable only when that specific card is marked playableFromExile', () => {
    const ctx = createTestContext({
      landsPlayedThisTurn: { p1: 0 },
      battlefield: [],
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [
            {
              id: 'mountain_exile_1',
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '{T}: Add {R}.',
            },
          ],
          exileCount: 1,
          libraryCount: 0,
        },
      },
      playableFromExile: {
        p1: { mountain_exile_1: 4 },
      },
      turnNumber: 4,
      turnPlayer: 'p1',
    });

    expect(canPlayLand(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('does not treat a land in exile as playable from a generic exile permission without a card-specific marker', () => {
    const ctx = createTestContext({
      landsPlayedThisTurn: { p1: 0 },
      battlefield: [],
      landPlayPermissions: {
        p1: ['exile'],
      },
      zones: {
        p1: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [
            {
              id: 'mountain_exile_2',
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '{T}: Add {R}.',
            },
          ],
          exileCount: 1,
          libraryCount: 0,
        },
      },
      playableFromExile: {
        p1: {},
      },
      turnNumber: 4,
      turnPlayer: 'p1',
    });

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

  it('should return false during untap even when a player has a castable instant', () => {
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
      phase: 'beginning',
      step: 'UNTAP',
      priority: 'p1',
      turnPlayer: 'p2',
      stack: [],
    });

    expect(canCastAnySpell(ctx, 'p1' as PlayerID)).toBe(true);
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

  it('treats emblem-granted instant-speed loyalty activations as a response', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
        },
      },
      battlefield: [
        {
          id: 'teferi_1',
          controller: 'p1',
          tapped: false,
          loyaltyCounters: 4,
          card: {
            name: 'Teferi, Hero of Dominaria',
            type_line: 'Legendary Planeswalker — Teferi',
            loyalty: '4',
            oracle_text: '+1: Draw a card. At the beginning of the next end step, untap two lands.\n-3: Put target nonland permanent into its owner\'s library third from the top.',
          },
        },
      ],
      emblems: [
        {
          id: 'teferi_talent_emblem_1',
          controller: 'p1',
          effect: 'You may activate loyalty abilities of planeswalkers you control on any player\'s turn any time you could cast an instant.',
        },
      ],
      phase: 'upkeep',
      step: 'UPKEEP',
      priority: 'p1',
      turnPlayer: 'p2',
      stack: [],
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

  it('should return false when an ongoing scheme taxes the only castable instant', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'opt_1',
              name: 'Opt',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Scry 1. Draw a card.',
            },
          ],
        },
      },
      activeSchemes: [
        {
          id: 'my_genius_scheme',
          controller: 'p2',
          name: 'My Genius Knows No Bounds',
          oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
        },
      ],
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      stack: [],
    });

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

  it('treats emblem-granted WUBRG alternate costs as a response', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'opportunity_1',
              name: 'Opportunity',
              type_line: 'Instant',
              mana_cost: '{4}{U}{U}',
              oracle_text: 'Target player draws four cards.',
            },
          ],
        },
      },
      battlefield: [],
      emblems: [
        {
          id: 'jodah_emblem_1',
          controller: 'p1',
          effect: 'You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.',
        },
      ],
      manaPool: {
        p1: { white: 1, blue: 1, black: 1, red: 1, green: 1, colorless: 0 },
      },
      step: 'UPKEEP',
      stack: [],
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

  it('surfaces graveyard instants that the active plane grants flashback', () => {
    const ctx = createTestContext({
      activePlane: {
        id: 'otaria_plane',
        name: 'Otaria',
        oracle_text: "Instant and sorcery cards in graveyards have flashback. The flashback cost is equal to the card's mana cost.",
      },
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'opt_1',
              name: 'Opt',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Scry 1. Draw a card.',
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
    });

    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('surfaces graveyard instants that an emblem grants flashback', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'lightning_strike_1',
              name: 'Lightning Strike',
              type_line: 'Instant',
              mana_cost: '{1}{R}',
              oracle_text: 'Lightning Strike deals 3 damage to any target.',
            },
          ],
        },
      },
      battlefield: [],
      emblems: [
        {
          id: 'flashback_emblem_1',
          controller: 'p1',
          effect: 'Each instant and sorcery card in your graveyard has flashback. The flashback cost is equal to its mana cost.',
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
      },
    });

    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('surfaces instant and Lesson cards granted flashback during your turn', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'consider_1',
              name: 'Consider',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Surveil 1, then draw a card.',
            },
            {
              id: 'environmental_sciences_1',
              name: 'Environmental Sciences',
              type_line: 'Sorcery - Lesson',
              mana_cost: '{2}',
              oracle_text: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle. You gain 2 life.',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'iroh_1',
          controller: 'p1',
          card: {
            name: 'Iroh, Grand Lotus',
            type_line: 'Legendary Creature - Human Noble Ally',
            oracle_text: "During your turn, each non-Lesson instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost.\nDuring your turn, each Lesson card in your graveyard has flashback {1}.",
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });
    const considerCandidate = candidates.find((candidate) => candidate.card?.id === 'consider_1');
    const lessonCandidate = candidates.find((candidate) => candidate.card?.id === 'environmental_sciences_1');

    expect(considerCandidate).toEqual(expect.objectContaining({
      sourceZone: 'graveyard',
      castMethod: 'flashback',
      manaCost: '{U}',
    }));
    expect(lessonCandidate).toEqual(expect.objectContaining({
      sourceZone: 'graveyard',
      castMethod: 'flashback',
      manaCost: '{1}',
    }));
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('does not surface during-your-turn flashback grants on an opponent turn', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'consider_1',
              name: 'Consider',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Surveil 1, then draw a card.',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'return_the_past_1',
          controller: 'p1',
          card: {
            name: 'Return the Past',
            type_line: 'Enchantment',
            oracle_text: 'During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p2',
      priority: 'p1',
      stack: [],
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'response' });

    expect(candidates.some((candidate) => candidate.card?.id === 'consider_1')).toBe(false);
    expect(canRespond(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('snapshots each instant and sorcery card that gains flashback until end of turn', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            { id: 'opt_grave_1', name: 'Opt', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Scry 1, then draw a card.' },
            { id: 'divination_grave_1', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: 'Draw two cards.' },
            { id: 'bear_grave_1', name: 'Runeclaw Bear', type_line: 'Creature', mana_cost: '{1}{G}', oracle_text: '' },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const applied = applyTemporaryGraveyardKeywordGrantFromText(
      ctx,
      'p1' as PlayerID,
      'Backdraft Hellkite',
      'Whenever Backdraft Hellkite attacks, each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.',
      { sourceId: 'backdraft_1' },
    );

    expect(applied).toBe(2);
    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ card: expect.objectContaining({ id: 'opt_grave_1' }), castMethod: 'flashback', manaCost: '{U}' }),
      expect.objectContaining({ card: expect.objectContaining({ id: 'divination_grave_1' }), castMethod: 'flashback', manaCost: '{2}{U}' }),
    ]));
    expect(candidates.some((candidate) => candidate.card?.id === 'bear_grave_1')).toBe(false);
  });

  it('only grants temporary flashback to the chosen target card in the graveyard', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            { id: 'chosen_instant_1', name: 'Consider', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Surveil 1, then draw a card.' },
            { id: 'unchosen_sorcery_1', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: 'Draw two cards.' },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const applied = applyTemporaryGraveyardKeywordGrantFromText(
      ctx,
      'p1' as PlayerID,
      'Sphinx of Forgotten Lore',
      "Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to that card's mana cost.",
      { sourceId: 'sphinx_1', targets: ['chosen_instant_1'] },
    );

    expect(applied).toBe(1);
    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ card: expect.objectContaining({ id: 'chosen_instant_1' }), castMethod: 'flashback' }),
    ]));
    expect(candidates.some((candidate) => candidate.card?.id === 'unchosen_sorcery_1')).toBe(false);
  });

  it('surfaces artifact creatures that temporarily gain unearth from a crewed Vehicle trigger', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            { id: 'artifact_creature_grave_1', name: 'Circuit Mender', type_line: 'Artifact Creature — Insect', mana_cost: '{3}', oracle_text: '' },
            { id: 'plain_artifact_grave_1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}', oracle_text: '' },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const applied = applyTemporaryGraveyardKeywordGrantFromText(
      ctx,
      'p1' as PlayerID,
      'Ghost Ark',
      'Whenever this Vehicle becomes crewed, each artifact creature card in your graveyard gains unearth {3} until end of turn.',
      { sourceId: 'ghost_ark_1' },
    );

    expect(applied).toBe(1);
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('enforces temporary escape additional exile costs and clears the grant at cleanup', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            { id: 'creature_escape_1', name: 'Persistent Specimen', type_line: 'Creature — Skeleton', mana_cost: '{1}{B}', oracle_text: '' },
            { id: 'other_escape_1', name: 'Other One', type_line: 'Instant', oracle_text: '' },
            { id: 'other_escape_2', name: 'Other Two', type_line: 'Sorcery', oracle_text: '' },
            { id: 'other_escape_3', name: 'Other Three', type_line: 'Creature', oracle_text: '' },
            { id: 'other_escape_4', name: 'Other Four', type_line: 'Land', oracle_text: '' },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 3 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const applied = applyTemporaryGraveyardKeywordGrantFromText(
      ctx,
      'p1' as PlayerID,
      "The Grim Captain's Locker",
      'Until end of turn, each creature card in your graveyard gains "Escape—{3}{B}, Exile four other cards from your graveyard."',
      { sourceId: 'locker_1' },
    );

    expect(applied).toBe(2);
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ card: expect.objectContaining({ id: 'creature_escape_1' }), castMethod: 'escape', manaCost: '{3}{B}' }),
    ]));

    expect(clearTemporaryGraveyardKeywordGrants((ctx as any).state)).toBe(2);
    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' }).some((candidate) => candidate.card?.id === 'creature_escape_1')).toBe(false);
  });

  it('surfaces a targeted creature card that temporarily gains embalm', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            { id: 'embalm_target_1', name: 'Supply Runner', type_line: 'Creature — Dog', mana_cost: '{2}{W}', oracle_text: '' },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const applied = applyTemporaryGraveyardKeywordGrantFromText(
      ctx,
      'p1' as PlayerID,
      'Cursecloth Wrappings',
      'Target creature card in your graveyard gains embalm until end of turn. The embalm cost is equal to its mana cost.',
      { sourceId: 'cursecloth_1', targets: ['embalm_target_1'] },
    );

    expect(applied).toBe(1);
    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
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
  it('should return false during untap even when the turn player has a castable instant', () => {
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
      phase: 'beginning',
      step: 'UNTAP',
      priority: 'p1',
      turnPlayer: 'p1',
      stack: [],
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should return shared castable commander candidates with per-commander tax and cost adjustment applied', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'ruby_medallion_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Ruby Medallion',
            type_line: 'Artifact',
            oracle_text: 'Red spells you cast cost {1} less to cast.',
          },
        },
      ],
      commandZone: {
        p1: {
          commanderIds: ['cmd_red', 'cmd_taxed'],
          commanderCards: [
            {
              id: 'cmd_red',
              name: 'Red Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
            {
              id: 'cmd_taxed',
              name: 'Taxed Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{2}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red', 'cmd_taxed'],
          taxById: {
            cmd_red: 0,
            cmd_taxed: 4,
          },
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      stack: [],
    });

    const candidates = getCastableCommanderCandidates(ctx, 'p1' as PlayerID);

    expect(candidates.map((candidate) => candidate.commanderId)).toEqual(['cmd_red']);
    expect(candidates[0]?.cost.generic).toBe(0);
    expect(candidates[0]?.cost.colors.R).toBe(1);
  });

  it('should return true when a commander is only affordable through a shared command-zone cost adjustment', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'ruby_medallion_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Ruby Medallion',
            type_line: 'Artifact',
            oracle_text: 'Red spells you cast cost {1} less to cast.',
          },
        },
      ],
      commandZone: {
        p1: {
          commanderIds: ['cmd_red'],
          commanderCards: [
            {
              id: 'cmd_red',
              name: 'Red Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red'],
          taxById: {
            cmd_red: 0,
          },
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when an emblem is the only source of a shared command-zone cost adjustment', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
      ],
      emblems: [
        {
          id: 'ruby_emblem_1',
          controller: 'p1',
          effect: 'Red spells you cast cost {1} less to cast.',
        },
      ],
      commandZone: {
        p1: {
          commanderIds: ['cmd_red'],
          commanderCards: [
            {
              id: 'cmd_red',
              name: 'Red Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red'],
          taxById: {
            cmd_red: 0,
          },
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when the active plane is the only source of a shared command-zone cost adjustment', () => {
    const ctx = createTestContext({
      activePlane: {
        id: 'turri_island_plane',
        name: 'Turri Island',
        oracle_text: 'Creature spells cost {2} less to cast.',
      },
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
      ],
      commandZone: {
        p1: {
          commanderIds: ['cmd_red_creature'],
          commanderCards: [
            {
              id: 'cmd_red_creature',
              name: 'Plane Discount Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{2}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red_creature'],
          taxById: {
            cmd_red_creature: 0,
          },
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should return true when the active plane reduces a red commander by a colored mana symbol', () => {
    const ctx = createTestContext({
      activePlane: {
        id: 'feeding_grounds_plane',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
      zones: {
        p1: {
          hand: [],
          graveyard: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      battlefield: [],
      commandZone: {
        p1: {
          commanderIds: ['cmd_red_one_drop'],
          commanderCards: [
            {
              id: 'cmd_red_one_drop',
              name: 'One-Drop Commander',
              type_line: 'Legendary Creature — Goblin',
              mana_cost: '{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red_one_drop'],
          taxById: {
            cmd_red_one_drop: 0,
          },
        },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

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

  it('should surface permanent spells whose later abilities target after a second land drop', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'bloodthirsty_blade',
              name: 'Bloodthirsty Blade',
              type_line: 'Artifact — Equipment',
              mana_cost: '{2}',
              oracle_text: 'Equipped creature gets +2/+0 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)\n{2}: Attach Bloodthirsty Blade to target creature an opponent controls. Activate only as a sorcery.',
            },
            {
              id: 'grenzo_havoc_raiser',
              name: 'Grenzo, Havoc Raiser',
              type_line: 'Legendary Creature — Goblin Rogue',
              mana_cost: '{R}{R}',
              oracle_text: "Whenever a creature you control deals combat damage to a player, choose one —\n• Goad target creature that player controls.\n• Exile the top card of that player's library. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'fire_nation_palace_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Fire Nation Palace',
            type_line: 'Land',
            oracle_text: 'This land enters tapped unless you control a basic land.\n{T}: Add {R}.\n{1}{R}, {T}: Target creature you control gains firebending 4 until end of turn. (Whenever it attacks, add {R}{R}{R}{R}. This mana lasts until end of combat.)',
          },
        },
      ],
      players: [{ id: 'p1' }, { id: 'p2' }],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });
    const candidateNames = candidates.map(candidate => String(candidate.castCard?.name || candidate.card?.name || ''));

    expect(candidateNames).toContain('Bloodthirsty Blade');
    expect(candidateNames).toContain('Grenzo, Havoc Raiser');
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should treat a creature equipped by Bloodthirsty Blade as goaded during its controller combat step', () => {
    const ctx = createTestContext({
      battlefield: [
        {
          id: 'bloodthirsty_blade_1',
          controller: 'p1',
          owner: 'p1',
          attachedTo: 'opponent_creature_1',
          card: {
            id: 'bloodthirsty_blade_card_1',
            name: 'Bloodthirsty Blade',
            type_line: 'Artifact — Equipment',
            oracle_text: 'Equipped creature gets +2/+0 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\n{1}: Attach this Equipment to target creature an opponent controls. Activate only as a sorcery.',
          },
        },
        {
          id: 'opponent_creature_1',
          controller: 'p2',
          owner: 'p2',
          tapped: false,
          enteredThisTurn: false,
          basePower: 3,
          baseToughness: 3,
          attachedEquipment: ['bloodthirsty_blade_1'],
          isEquipped: true,
          card: {
            id: 'opponent_creature_card_1',
            name: 'Opposition Bruiser',
            type_line: 'Creature — Ogre Warrior',
            power: '3',
            toughness: '3',
            oracle_text: '',
          },
        },
      ],
      players: [{ id: 'p1' }, { id: 'p2' }],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'BEGIN_COMBAT',
      turn: 5,
      turnPlayer: 'p2',
      priority: 'p2',
      stack: [],
    });

    expect(canAct(ctx, 'p2' as PlayerID)).toBe(true);
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

  it('should return true when a battlefield permanent grants unearth to a graveyard creature', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'cleric_grave_1',
              name: 'A-Blood Artist',
              type_line: 'Creature — Vampire Cleric',
              mana_cost: '{1}{B}',
              oracle_text: 'Whenever another creature dies, target player loses 1 life.',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'solemn_doomguide_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Solemn Doomguide',
            type_line: 'Creature — Human Cleric',
            oracle_text: "Each creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}.",
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
      },
      step: 'MAIN1',
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(true);
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should not surface granted unearth outside its sorcery-speed window', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'artifact_grave_1',
              name: 'Servo Schematic',
              type_line: 'Artifact',
              mana_cost: '{2}',
              oracle_text: 'When this artifact enters, create a 1/1 colorless Servo artifact creature token.',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'mishra_grant_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Mishra, Tamer of Mak Fawa',
            type_line: 'Legendary Creature — Human Artificer',
            oracle_text: 'Each artifact card in your graveyard has unearth {1}{B}{R}.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 1, red: 1, green: 0, colorless: 1 },
      },
      step: 'MAIN1',
      stack: [
        {
          id: 'spell_on_stack',
          type: 'spell',
          controller: 'p2',
          card: { id: 'shock_1', name: 'Shock', type_line: 'Instant' },
        },
      ],
      turnPlayer: 'p1',
      priority: 'p1',
    });

    expect(canActivateAnyAbility(ctx, 'p1' as PlayerID)).toBe(false);
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(false);
  });

  it('should surface exact-two-color cards granted jump-start when discard fodder is available', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            { id: 'discard_1', name: 'Spare Card', type_line: 'Creature', oracle_text: '' },
          ],
          graveyard: [
            {
              id: 'helix_grave_1',
              name: 'Prismari Insight',
              type_line: 'Instant',
              mana_cost: '{R}{W}',
              oracle_text: 'Draw a card.',
              colors: ['R', 'W'],
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'niv_mizzet_supreme_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Niv-Mizzet, Supreme',
            type_line: 'Legendary Creature — Dragon Avatar',
            oracle_text: "Flying, hexproof from monocolored\nEach instant and sorcery card in your graveyard that's exactly two colors has jump-start.",
          },
        },
      ],
      manaPool: {
        p1: { white: 1, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ castMethod: 'jump-start' }),
    ]));
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('should surface enchantments granted escape when the graveyard exile cost is payable', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'sentinel_eyes_1',
              name: "Sentinel's Eyes",
              type_line: 'Enchantment — Aura',
              mana_cost: '{W}',
              oracle_text: 'Enchant creature',
            },
            { id: 'other_1', name: 'Other Card 1', type_line: 'Creature', oracle_text: '' },
            { id: 'other_2', name: 'Other Card 2', type_line: 'Instant', oracle_text: '' },
            { id: 'other_3', name: 'Other Card 3', type_line: 'Sorcery', oracle_text: '' },
          ],
        },
      },
      battlefield: [
        {
          id: 'master_of_keys_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'The Master of Keys',
            type_line: 'Legendary Enchantment Creature — Horror',
            oracle_text: "Each enchantment card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.",
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          tapped: false,
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
      manaPool: {
        p1: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      step: 'MAIN1',
      stack: [],
      turnPlayer: 'p1',
      priority: 'p1',
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ castMethod: 'escape' }),
    ]));
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('surfaces Kess-style once-per-turn graveyard instant and sorcery permissions', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'consider_1',
              name: 'Consider',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Surveil 1, then draw a card.',
            },
            {
              id: 'runeclaw_1',
              name: 'Runeclaw Bear',
              type_line: 'Creature — Bear',
              mana_cost: '{1}{G}',
              oracle_text: '',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'kess_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Kess, Dissident Mage',
            type_line: 'Legendary Creature — Human Wizard',
            oracle_text: 'Flying\nOnce during each of your turns, you may cast an instant or sorcery spell from your graveyard.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'consider_1' }),
        sourceZone: 'graveyard',
      }),
    ]));
    expect(candidates.some((candidate) => candidate.card?.id === 'runeclaw_1')).toBe(false);
    expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
  });

  it('filters Muldrotha-style graveyard permanent casts by unused permanent types', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'mind_stone_1',
              name: 'Mind Stone',
              type_line: 'Artifact',
              mana_cost: '{2}',
              oracle_text: '{T}: Add {C}.',
            },
            {
              id: 'runeclaw_1',
              name: 'Runeclaw Bear',
              type_line: 'Creature — Bear',
              mana_cost: '{1}{G}',
              oracle_text: '',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'muldrotha_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Muldrotha, the Gravetide',
            type_line: 'Legendary Creature — Elemental Avatar',
            oracle_text: 'During each of your turns, you may play up to one permanent card of each permanent type from your graveyard.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
      graveyardPermanentTypesCastThisTurn: {
        p1: { artifact: true },
      },
    });

    const candidates = getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' });

    expect(candidates.some((candidate) => candidate.card?.id === 'mind_stone_1')).toBe(false);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'runeclaw_1' }),
        sourceZone: 'graveyard',
      }),
    ]));
  });

  it('allows a Muldrotha-style graveyard land play until the land type has been used', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
            },
          ],
        },
      },
      battlefield: [
        {
          id: 'muldrotha_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Muldrotha, the Gravetide',
            type_line: 'Legendary Creature — Elemental Avatar',
            oracle_text: 'During each of your turns, you may play up to one permanent card of each permanent type from your graveyard.',
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      landsPlayedThisTurn: { p1: 0 },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'forest_1' }),
        sourceZone: 'graveyard',
      }),
    ]));

    (ctx.state as any).playedLandFromGraveyardThisTurn = { p1: true };

    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID).some((candidate) => candidate.card?.id === 'forest_1')).toBe(false);
  });

  it('surfaces graveyard cards marked playable by effect-program permissions', () => {
    const ctx = createTestContext({
      turnNumber: 4,
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'consider_1',
              name: 'Consider',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Draw a card.',
              canBePlayedBy: 'p1',
              playableUntilTurn: 4,
            },
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
              canBePlayedBy: 'p1',
              playableUntilTurn: 4,
            },
          ],
        },
      },
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      playableFromGraveyard: {
        p1: {
          consider_1: 4,
          forest_1: 4,
        },
      },
      landsPlayedThisTurn: { p1: 0 },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'consider_1' }),
        sourceZone: 'graveyard',
      }),
    ]));

    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'forest_1' }),
        sourceZone: 'graveyard',
      }),
    ]));
  });

  it('surfaces graveyard land and spell permissions granted by an emblem', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [],
          graveyard: [
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
            },
            {
              id: 'consider_1',
              name: 'Consider',
              type_line: 'Instant',
              mana_cost: '{U}',
              oracle_text: 'Draw a card.',
            },
          ],
        },
      },
      emblems: [
        {
          id: 'wrenn_emblem_1',
          controller: 'p1',
          effect: 'You may play lands and cast spells from your graveyard.',
        },
      ],
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      landsPlayedThisTurn: { p1: 0 },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(getPlayableLandCandidates(ctx, 'p1' as PlayerID)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'forest_1' }),
        sourceZone: 'graveyard',
      }),
    ]));

    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'consider_1' }),
        sourceZone: 'graveyard',
      }),
    ]));
  });

  it('surfaces hand spells that an emblem lets you cast for free', () => {
    const ctx = createTestContext({
      zones: {
        p1: {
          hand: [
            {
              id: 'divination_1',
              name: 'Divination',
              type_line: 'Sorcery',
              mana_cost: '{2}{U}',
              oracle_text: 'Draw two cards.',
            },
          ],
        },
      },
      emblems: [
        {
          id: 'omniscience_emblem_1',
          controller: 'p1',
          effect: 'You may cast nonland cards from your hand without paying their mana costs.',
        },
      ],
      battlefield: [],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
    });

    expect(getCastableSpellCandidates(ctx, 'p1' as PlayerID, { mode: 'main' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: 'divination_1' }),
        sourceZone: 'hand',
        payability: 'alternate',
      }),
    ]));
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

      it('should return true when a sorcery-speed spell is castable from the top of the library in main phase', () => {
        const ctx = createTestContext({
          zones: {
            p1: {
              hand: [],
              graveyard: [],
              exile: [],
              handCount: 0,
              graveyardCount: 0,
              exileCount: 0,
              libraryCount: 1,
            },
          },
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
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
          },
          step: 'MAIN1',
          stack: [],
          turnPlayer: 'p1',
          priority: 'p1',
        });

        (ctx as any).libraries = new Map([
          ['p1', [
            {
              id: 'bears_top',
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
              mana_cost: '{1}{G}',
              oracle_text: '',
            },
          ]],
        ]);

        expect(canAct(ctx, 'p1' as PlayerID)).toBe(true);
      });

      it('should not claim a top-library land is playable during main phase when the effect only allows casting spells', () => {
        const ctx = createTestContext({
          zones: {
            p1: {
              hand: [],
              graveyard: [],
              exile: [],
              handCount: 0,
              graveyardCount: 0,
              exileCount: 0,
              libraryCount: 1,
            },
          },
          battlefield: [
            {
              id: 'melek',
              controller: 'p1',
              tapped: false,
              card: {
                name: 'Melek, Izzet Paragon',
                type_line: 'Legendary Creature — Weird Wizard',
                oracle_text: 'Play with the top card of your library revealed. You may cast instant and sorcery spells from the top of your library.',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          step: 'MAIN1',
          stack: [],
          turnPlayer: 'p1',
          priority: 'p1',
        });

        (ctx as any).libraries = new Map([
          ['p1', [
            {
              id: 'forest_top',
              name: 'Forest',
              type_line: 'Basic Land - Forest',
              oracle_text: '',
            },
          ]],
        ]);

        expect(canAct(ctx, 'p1' as PlayerID)).toBe(false);
      });

      it('should return true when Mystic Forge allows a colorless nonland card from the top of the library', () => {
        const ctx = createTestContext({
          zones: {
            p1: {
              hand: [],
              graveyard: [],
              exile: [],
              handCount: 0,
              graveyardCount: 0,
              exileCount: 0,
              libraryCount: 1,
            },
          },
          battlefield: [
            {
              id: 'mystic_forge',
              controller: 'p1',
              tapped: false,
              card: {
                name: 'Mystic Forge',
                type_line: 'Artifact',
                oracle_text: 'You may look at the top card of your library any time. You may cast the top card of your library if it\'s an artifact card or a colorless nonland card.',
              },
            },
          ],
          manaPool: {
            p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 6 },
          },
          step: 'MAIN1',
          stack: [],
          turnPlayer: 'p1',
          priority: 'p1',
        });

        (ctx as any).libraries = new Map([
          ['p1', [
            {
              id: 'ugin_top',
              name: 'Ugin, the Ineffable',
              type_line: 'Legendary Planeswalker — Ugin',
              mana_cost: '{6}',
              oracle_text: 'Colorless spells you cast cost {2} less to cast.',
              colors: [],
            },
          ]],
        ]);

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
