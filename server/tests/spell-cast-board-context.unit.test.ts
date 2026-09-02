import { describe, expect, it } from 'vitest';

import { isAISpellContextuallyUseful } from '../src/socket/ai.js';
import {
  getSpellCastBoardGaps,
  isSpellCastBoardContextUseful,
  provisionSpellCastBoardContext,
} from '../src/socket/spellCastBoardContext.js';

const pathToExile = {
  name: 'Path to Exile',
  type_line: 'Instant',
  oracle_text: "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
};

const forceSpike = {
  name: 'Force Spike',
  type_line: 'Instant',
  oracle_text: 'Counter target spell unless its controller pays {1}.',
};

const counterspell = {
  name: 'Counterspell',
  type_line: 'Instant',
  oracle_text: 'Counter target spell.',
};

const windfall = {
  id: 'windfall-1',
  name: 'Windfall',
  type_line: 'Sorcery',
  oracle_text: 'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
};

function buildGame(overrides: { battlefield?: any[]; stack?: any[]; hands?: Record<string, any[]> } = {}) {
  const hands = overrides.hands || { ai: [], p2: [] };
  return {
    state: {
      players: [
        { id: 'ai', name: 'AI', life: 40, hand: hands.ai || [] },
        { id: 'p2', name: 'P2', life: 40, hand: hands.p2 || [] },
      ],
      battlefield: overrides.battlefield || [],
      stack: overrides.stack || [],
      zones: {
        ai: { hand: hands.ai || [], handCount: (hands.ai || []).length },
        p2: { hand: hands.p2 || [], handCount: (hands.p2 || []).length },
      },
    },
  } as any;
}

describe('spell cast board context (AI + soak)', () => {
  it('skips Path / Force Spike / Windfall when the board cannot support them', () => {
    const empty = buildGame();
    expect(isAISpellContextuallyUseful(empty, 'ai' as any, pathToExile)).toBe(false);
    expect(isAISpellContextuallyUseful(empty, 'ai' as any, forceSpike)).toBe(false);
    expect(isAISpellContextuallyUseful(empty, 'ai' as any, windfall)).toBe(false);
    expect(getSpellCastBoardGaps(empty, 'ai', pathToExile)).toContain('no_creature_target');
    expect(getSpellCastBoardGaps(empty, 'ai', forceSpike)).toContain('no_stack_spell_target');
    expect(getSpellCastBoardGaps(empty, 'ai', windfall, { excludeCardId: 'windfall-1' })).toContain('no_hand_cards');
  });

  it('allows those spells once the matching board pieces exist', () => {
    const withCreature = buildGame({
      battlefield: [{
        id: 'bear',
        controller: 'p2',
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      }],
    });
    expect(isSpellCastBoardContextUseful(withCreature, 'ai', pathToExile)).toBe(true);

    const withStack = buildGame({
      stack: [{
        id: 'bolt',
        type: 'spell',
        controller: 'p2',
        card: { name: 'Lightning Bolt', type_line: 'Instant' },
      }],
    });
    expect(isSpellCastBoardContextUseful(withStack, 'ai', forceSpike)).toBe(true);

    const withHands = buildGame({
      hands: {
        ai: [{ id: 'windfall-1', name: 'Windfall' }, { id: 'island', name: 'Island' }],
        p2: [{ id: 'p2-card', name: 'Mountain' }],
      },
    });
    expect(isSpellCastBoardContextUseful(withHands, 'ai', windfall, { excludeCardId: 'windfall-1' })).toBe(true);
  });

  it('does not treat the AI countering its own stack spell as useful context', () => {
    const ownTithe = buildGame({
      stack: [{
        id: 'tithe',
        type: 'spell',
        controller: 'ai',
        card: { name: 'Smothering Tithe', type_line: 'Enchantment' },
      }],
    });
    expect(isAISpellContextuallyUseful(ownTithe, 'ai' as any, counterspell)).toBe(false);
    expect(isAISpellContextuallyUseful(ownTithe, 'ai' as any, forceSpike)).toBe(false);
    expect(getSpellCastBoardGaps(ownTithe, 'ai', counterspell)).toContain('no_stack_spell_target');

    const mixed = buildGame({
      stack: [
        {
          id: 'tithe',
          type: 'spell',
          controller: 'ai',
          card: { name: 'Smothering Tithe', type_line: 'Enchantment' },
        },
        {
          id: 'bolt',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
        },
      ],
    });
    expect(isSpellCastBoardContextUseful(mixed, 'ai', counterspell)).toBe(true);
  });

  it('provisions the same gaps the AI would skip', () => {
    const game = buildGame();
    const remaining = provisionSpellCastBoardContext(game, 'ai', pathToExile, { opponentIds: ['p2'] });
    expect(remaining).toEqual([]);
    expect(isSpellCastBoardContextUseful(game, 'ai', pathToExile)).toBe(true);
    expect(String(game.state.battlefield[0]?.card?.type_line || '')).toMatch(/creature/i);

    const spikeGame = buildGame();
    provisionSpellCastBoardContext(spikeGame, 'ai', forceSpike, { opponentIds: ['p2'] });
    expect(isSpellCastBoardContextUseful(spikeGame, 'ai', forceSpike)).toBe(true);
    expect(spikeGame.state.stack[0]?.card?.type_line).toMatch(/instant/i);

    const windGame = buildGame({ hands: { ai: [windfall], p2: [] } });
    provisionSpellCastBoardContext(windGame, 'ai', windfall, { excludeCardId: 'windfall-1', opponentIds: ['p2'] });
    expect(isSpellCastBoardContextUseful(windGame, 'ai', windfall, { excludeCardId: 'windfall-1' })).toBe(true);
  });

  it('skips empty-stack Summary Dismissal and off-turn Flash creatures that are not combat tricks', () => {
    const summaryDismissal = {
      name: 'Summary Dismissal',
      type_line: 'Instant',
      oracle_text: 'Exile all other spells and counter all abilities.',
    };
    const horizonChimera = {
      name: 'Horizon Chimera',
      type_line: 'Creature — Chimera',
      oracle_text: 'Flash\nFlying, trample\nWhenever you draw a card, you gain 1 life.',
      keywords: ['Flash', 'Flying', 'Trample'],
    };

    const empty = buildGame();
    empty.state.turnPlayer = 'p2';
    expect(isAISpellContextuallyUseful(empty, 'ai' as any, summaryDismissal)).toBe(false);
    expect(getSpellCastBoardGaps(empty, 'ai', summaryDismissal)).toContain('no_stack_spell_target');
    expect(isAISpellContextuallyUseful(empty, 'ai' as any, horizonChimera)).toBe(false);
    expect(getSpellCastBoardGaps(empty, 'ai', horizonChimera)).toContain('off_turn_flash_permanent');

    empty.state.turnPlayer = 'ai';
    expect(isAISpellContextuallyUseful(empty, 'ai' as any, horizonChimera)).toBe(true);

    const withStack = buildGame({
      stack: [{
        id: 'bolt',
        type: 'spell',
        controller: 'p2',
        card: { name: 'Lightning Bolt', type_line: 'Instant' },
      }],
    });
    expect(isSpellCastBoardContextUseful(withStack, 'ai', summaryDismissal)).toBe(true);

    const ownSpellOnly = buildGame({
      stack: [{
        id: 'tithe',
        type: 'spell',
        controller: 'ai',
        card: { name: 'Smothering Tithe', type_line: 'Enchantment' },
      }],
    });
    expect(isAISpellContextuallyUseful(ownSpellOnly, 'ai' as any, summaryDismissal)).toBe(false);
    expect(getSpellCastBoardGaps(ownSpellOnly, 'ai', summaryDismissal)).toContain('no_stack_spell_target');

    const ownAbilityOnly = buildGame({
      stack: [{
        id: 'etb',
        type: 'ability',
        controller: 'ai',
        card: { name: 'Mulldrifter', type_line: 'Creature — Elemental' },
      }],
    });
    expect(isAISpellContextuallyUseful(ownAbilityOnly, 'ai' as any, summaryDismissal)).toBe(false);

    const mixedStack = buildGame({
      stack: [
        {
          id: 'tithe',
          type: 'spell',
          controller: 'ai',
          card: { name: 'Smothering Tithe', type_line: 'Enchantment' },
        },
        {
          id: 'bolt',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
        },
      ],
    });
    expect(isSpellCastBoardContextUseful(mixedStack, 'ai', summaryDismissal)).toBe(true);
  });
});
