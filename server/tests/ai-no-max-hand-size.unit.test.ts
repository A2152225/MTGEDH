import { describe, expect, it } from 'vitest';

import { chooseCardsToDiscard } from '../src/socket/ai.js';
import { chooseAIPlayableLandCandidate } from '../src/socket/ai-handlers/aiLandAuraCommander.js';
import { calculateSpellPriority } from '../src/socket/ai-handlers/aiSpellPriority.js';
import { cardGrantsNoMaximumHandSize } from '../src/state/modules/handSizeUtils.js';

const RELIQUARY_TOWER = {
  id: 'tower-1',
  name: 'Reliquary Tower',
  type_line: 'Land',
  oracle_text: 'You have no maximum hand size.\n{T}: Add {C}.',
};

const ISLAND = {
  id: 'island-1',
  name: 'Island',
  type_line: 'Basic Land — Island',
  oracle_text: '',
};

const THOUGHT_VESSEL = {
  id: 'vessel-1',
  name: 'Thought Vessel',
  type_line: 'Artifact',
  mana_cost: '{2}',
  oracle_text: 'You have no maximum hand size.\n{T}: Add {C}.',
};

const CHEAP_REMOVAL = {
  id: 'path-1',
  name: 'Path to Exile',
  type_line: 'Instant',
  mana_cost: '{W}',
  oracle_text: 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
};

function landCandidate(card: any) {
  return { card, sourceZone: 'hand' as const };
}

function discardGame(hand: any[]) {
  return {
    state: {
      players: [{ id: 'ai' }],
      battlefield: [],
      zones: {
        ai: { hand, handCount: hand.length },
      },
      manaPool: {
        ai: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    },
  } as any;
}

describe('no maximum hand size AI', () => {
  it('detects Reliquary Tower and Thought Vessel', () => {
    expect(cardGrantsNoMaximumHandSize(RELIQUARY_TOWER)).toBe(true);
    expect(cardGrantsNoMaximumHandSize(THOUGHT_VESSEL)).toBe(true);
    expect(cardGrantsNoMaximumHandSize(ISLAND)).toBe(false);
  });

  it('plays Reliquary Tower before a colored land even if that land would enable a spell', () => {
    const chosen = chooseAIPlayableLandCandidate([
      landCandidate(ISLAND),
      landCandidate(RELIQUARY_TOWER),
    ]);
    expect(chosen?.card?.name).toBe('Reliquary Tower');
  });

  it('keeps Reliquary Tower instead of discarding it over cheap interaction', () => {
    const game = discardGame([RELIQUARY_TOWER, CHEAP_REMOVAL, ISLAND]);
    const discarded = chooseCardsToDiscard(game, 'ai' as any, 1);
    expect(discarded).not.toContain('tower-1');
  });

  it('scores Thought Vessel above a typical creature when the hand is already full', () => {
    const creature = {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      mana_cost: '{1}{G}',
      oracle_text: '',
    };
    const game = discardGame([
      THOUGHT_VESSEL,
      creature,
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `filler-${index}`,
        name: 'Island',
        type_line: 'Basic Land — Island',
      })),
    ]);
    expect(calculateSpellPriority(THOUGHT_VESSEL, game, 'ai' as any))
      .toBeGreaterThan(calculateSpellPriority(creature, game, 'ai' as any));
  });
});
