import { describe, expect, it } from 'vitest';
import {
  buildFusedSpellCard,
  cardHasFuseKeyword,
  stripFuseReminderText,
} from '../src/state/modules/splitFuseSpellFace.js';
import { resolveSelectedSpellCard } from '../src/socket/game-actions-handlers/gameActionsCastFaceAndMiracleSelection.js';
import { getHandCastEvaluationCards } from '../src/state/modules/can-respond-handlers/canRespondHandCastEvaluation.js';

const wearTear = {
  id: 'wear-tear-1',
  name: 'Wear // Tear',
  layout: 'split',
  keywords: ['Fuse'],
  type_line: 'Instant // Instant',
  mana_cost: '{1}{R} // {W}',
  oracle_text: '',
  card_faces: [
    {
      name: 'Wear',
      mana_cost: '{1}{R}',
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact.\nFuse (You may cast one or both halves of this card from your hand.)',
      colors: ['R'],
    },
    {
      name: 'Tear',
      mana_cost: '{W}',
      type_line: 'Instant',
      oracle_text: 'Destroy target enchantment.\nFuse (You may cast one or both halves of this card from your hand.)',
      colors: ['W'],
    },
  ],
};

describe('split fuse spell face', () => {
  it('detects fuse and strips fuse reminder text', () => {
    expect(cardHasFuseKeyword(wearTear)).toBe(true);
    expect(stripFuseReminderText(wearTear.card_faces[0].oracle_text)).toBe('Destroy target artifact.');
  });

  it('builds combined fused characteristics', () => {
    const fused = buildFusedSpellCard(wearTear);
    expect(fused).toBeTruthy();
    expect(fused.castAsFused).toBe(true);
    expect(fused.name).toBe('Wear // Tear');
    expect(fused.mana_cost).toBe('{1}{R}{W}');
    expect(fused.oracle_text).toContain('Destroy target artifact.');
    expect(fused.oracle_text).toContain('Destroy target enchantment.');
    expect(fused.oracle_text).not.toMatch(/\bfuse\b/i);
    expect(fused.colors).toEqual(expect.arrayContaining(['R', 'W']));
  });

  it('resolveSelectedSpellCard honors fused option', () => {
    const selected = resolveSelectedSpellCard(wearTear, undefined, { fused: true });
    expect(selected.castAsFused).toBe(true);
    expect(selected.card.mana_cost).toBe('{1}{R}{W}');
    expect(selected.faceIndex).toBeUndefined();
  });

  it('hand cast evaluation offers both halves and a fused candidate', () => {
    const cards = getHandCastEvaluationCards(wearTear);
    expect(cards).toHaveLength(3);
    expect(cards.filter((c) => c.castAsFused === true)).toHaveLength(1);
    expect(cards.some((c) => c.faceIndex === 0 && c.name === 'Wear')).toBe(true);
    expect(cards.some((c) => c.faceIndex === 1 && c.name === 'Tear')).toBe(true);
  });
});
