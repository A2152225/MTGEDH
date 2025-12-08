import { describe, it, expect } from 'vitest';
import { canCastAnySpell, canActivateAnyAbility, canRespond } from '../src/state/modules/can-respond';
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
});
