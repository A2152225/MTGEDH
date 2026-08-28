import { describe, expect, it } from 'vitest';

import { detectSpellLandBonus } from '../src/state/modules/game-state-effects.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const SUMMER_BLOOM_ORACLE = 'You may play up to three additional lands this turn.';
const EXPLORE_ORACLE = 'You may play an additional land this turn.\nDraw a card.';
const URBAN_EVOLUTION_ORACLE = 'Draw three cards. You may play an additional land this turn.';
const JOURNEY_ORACLE =
  'Choose one —\n• Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle.\n• You may play up to two additional lands this turn.\nEntwine {2}{G} (Choose both if you pay the entwine cost.)';
const GROWTH_SPIRAL_ORACLE = 'Draw a card. You may put a land card from your hand onto the battlefield.';
const WAYWARD_ORACLE =
  "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nYou may play an additional land on each of your turns.\nThis creature can't attack or block unless you have the city's blessing.";

describe('detectSpellLandBonus is oracle-only (no TEMPORARY_LAND_PLAY_SPELLS table)', () => {
  it('detects Summer Bloom up-to-three this turn on an anonymous spell', () => {
    expect(detectSpellLandBonus('Fixture Bloom', SUMMER_BLOOM_ORACLE)).toBe(3);
  });

  it('detects Explore and Urban Evolution +1 this turn on anonymous spells', () => {
    expect(detectSpellLandBonus('Fixture Extra Land', EXPLORE_ORACLE)).toBe(1);
    expect(detectSpellLandBonus('Fixture Draw And Land', URBAN_EVOLUTION_ORACLE)).toBe(1);
  });

  it('detects Journey of Discovery up-to-two this turn from the mode text', () => {
    expect(detectSpellLandBonus('Fixture Journey', JOURNEY_ORACLE)).toBe(2);
  });

  it('does not treat put-a-land-onto-battlefield as an extra land drop', () => {
    expect(detectSpellLandBonus('Growth Spiral', GROWTH_SPIRAL_ORACLE)).toBe(0);
  });

  it('does not treat continuous each-turn extra lands as a this-turn spell bonus', () => {
    expect(detectSpellLandBonus('Wayward Swordtooth', WAYWARD_ORACLE)).toBe(0);
  });

  it('does not grant a bonus from leftover names without this-turn extra-drop oracle', () => {
    expect(detectSpellLandBonus('Explore', GROWTH_SPIRAL_ORACLE)).toBe(0);
    expect(detectSpellLandBonus('Summer Bloom', 'Draw a card.')).toBe(0);
  });
});
