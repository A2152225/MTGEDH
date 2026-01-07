import { describe, it, expect } from 'vitest';
import { canAct } from '../src/state/modules/can-respond';
import type { GameContext } from '../src/state/context';

/**
 * Test suite for Issue: Arcane Signet not detected by canAct after playing
 * 
 * Issue: After playing Arcane Signet (while still untapped), canAct doesn't detect
 * it as a possible mana source for casting another spell, causing the game to
 * auto-pass to the next phase even when the player has spells they could cast.
 */
describe('Arcane Signet - canAct Detection After Playing', () => {
  it('should detect available mana from Arcane Signet after playing it', () => {
    // Set up game state after playing Arcane Signet
    const state: any = {
      battlefield: [
        {
          id: 'perm_signet',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          summoningSickness: false, // Artifacts don't have summoning sickness
          card: {
            name: 'Arcane Signet',
            type_line: 'Artifact',
            oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
          },
        },
      ],
      commandZone: {
        player1: {
          commanderCards: [
            {
              id: 'commander1',
              name: 'Aurelia, the Warleader',
              color_identity: ['W', 'R'],
            },
          ],
        },
      },
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 }, // 1 colorless floating
      },
      zones: {
        player1: {
          hand: [
            {
              id: 'card_in_hand',
              name: 'Lightning Bolt',
              type_line: 'Instant',
              mana_cost: '{R}',
              oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            },
          ],
        },
      },
      stack: [],
      step: 'MAIN1',
      turnPlayer: 'player1',
      players: ['player1', 'player2'],
    };

    const ctx: GameContext = {
      state,
      libraries: new Map(),
      rng: () => 0.5,
    };

    // canAct should return TRUE because:
    // 1. Player has 1 colorless floating + Arcane Signet (which can produce {W} or {R})
    // 2. Player has Lightning Bolt in hand which costs {R}
    // 3. Player can tap Arcane Signet for {R} and cast Lightning Bolt
    const result = canAct(ctx, 'player1');
    
    expect(result).toBe(true);
  });

  it('should detect sorcery-speed spells castable with Arcane Signet', () => {
    const state: any = {
      battlefield: [
        {
          id: 'perm_signet',
          controller: 'player1',
          owner: 'player1',
          tapped: false,
          summoningSickness: false,
          card: {
            name: 'Arcane Signet',
            type_line: 'Artifact',
            oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
          },
        },
      ],
      commandZone: {
        player1: {
          commanderCards: [
            {
              id: 'commander1',
              name: 'Meren of Clan Nel Toth',
              color_identity: ['B', 'G'],
            },
          ],
        },
      },
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 }, // 2 colorless floating
      },
      zones: {
        player1: {
          hand: [
            {
              id: 'card_sakura',
              name: 'Sakura-Tribe Elder',
              type_line: 'Creature — Snake Shaman',
              mana_cost: '{1}{G}',
              oracle_text: 'Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
            },
          ],
        },
      },
      stack: [],
      step: 'MAIN1',
      turnPlayer: 'player1',
      players: ['player1', 'player2'],
    };

    const ctx: GameContext = {
      state,
      libraries: new Map(),
      rng: () => 0.5,
    };

    // canAct should return TRUE because:
    // 1. Player has 2 colorless floating + Arcane Signet (can produce {B} or {G})
    // 2. Player has Sakura-Tribe Elder in hand which costs {1}{G}
    // 3. Player can pay {1} from floating + {G} from Arcane Signet
    const result = canAct(ctx, 'player1');
    
    expect(result).toBe(true);
  });
});
