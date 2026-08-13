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
});
