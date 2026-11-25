import { describe, expect, it } from 'vitest';

import { evaluateConditionalEntersTappedFromBattlefield } from '../../rules-engine/src/oracleIREtbTappedPattern.js';
import {
  detectETBTappedPattern,
  evaluateConditionalLandETB,
} from '../src/socket/land-helpers.js';

const TURBULENT_MOOR_ORACLE =
  '({T}: Add {W} or {B}.)\nThis land enters tapped unless your opponents control eight or more lands.';

describe('conditional land ETB — opponents control N lands', () => {
  it('classifies turbulent lands as conditional, not always-tapped', () => {
    expect(detectETBTappedPattern(TURBULENT_MOOR_ORACLE)).toBe('conditional');
  });

  it('enters tapped when opponents control fewer than eight lands', () => {
    const fourLands = evaluateConditionalLandETB(
      TURBULENT_MOOR_ORACLE,
      0,
      [],
      undefined,
      undefined,
      3,
      undefined,
      4,
    );
    expect(fourLands.shouldEnterTapped).toBe(true);

    const sevenLands = evaluateConditionalLandETB(
      TURBULENT_MOOR_ORACLE,
      0,
      [],
      undefined,
      undefined,
      3,
      undefined,
      7,
    );
    expect(sevenLands.shouldEnterTapped).toBe(true);
  });

  it('enters untapped when opponents control eight or more lands', () => {
    const result = evaluateConditionalLandETB(
      TURBULENT_MOOR_ORACLE,
      0,
      [],
      undefined,
      undefined,
      3,
      undefined,
      8,
    );
    expect(result.shouldEnterTapped).toBe(false);
  });
});

const STEAM_VENTS_ORACLE =
  "As Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.\n{T}: Add {U} or {R}.";

const CANOPY_VISTA_ORACLE =
  '({T}: Add {G} or {W}.)\nThis land enters tapped unless you control two or more basic lands.';

describe('conditional land ETB — shock and battle lands', () => {
  it('taps shock lands by default so the pay-2-life prompt can untap them', () => {
    const result = evaluateConditionalLandETB(STEAM_VENTS_ORACLE, 0, []);
    expect(detectETBTappedPattern(STEAM_VENTS_ORACLE)).toBe('conditional');
    expect(result.shouldEnterTapped).toBe(true);
    expect(result.reason).toMatch(/pay 2 life/i);
  });

  it('taps Canopy Vista without two basic lands and untaps with two', () => {
    expect(evaluateConditionalLandETB(CANOPY_VISTA_ORACLE, 3, [], undefined, 0).shouldEnterTapped).toBe(true);
    expect(evaluateConditionalLandETB(CANOPY_VISTA_ORACLE, 3, [], undefined, 2).shouldEnterTapped).toBe(false);
  });
});

const DRAGONSKULL_ORACLE =
  'This land enters tapped unless you control a Swamp or a Mountain.\n{T}: Add {B} or {R}.';

describe('conditional land ETB — check lands with a second article', () => {
  it('enters tapped when the only land is a Plains', () => {
    const result = evaluateConditionalLandETB(DRAGONSKULL_ORACLE, 1, ['Plains']);
    expect(result.shouldEnterTapped).toBe(true);
    expect(result.reason).toMatch(/swamp or mountain/i);
    expect(evaluateConditionalEntersTappedFromBattlefield(DRAGONSKULL_ORACLE, {
      landCount: 1,
      basicLandCount: 1,
      landTypes: ['plains'],
      hasLegendaryCreature: false,
      opponentCount: 3,
      opponentLandCount: 0,
    })).toBe(true);
  });

  it('enters untapped when a Mountain is controlled, including the older template', () => {
    expect(evaluateConditionalLandETB(DRAGONSKULL_ORACLE, 1, ['Mountain']).shouldEnterTapped).toBe(false);
    expect(evaluateConditionalLandETB(
      'Dragonskull Summit enters the battlefield tapped unless you control a Swamp or Mountain.\n{T}: Add {B} or {R}.',
      1,
      ['Swamp'],
    ).shouldEnterTapped).toBe(false);
  });

  it('still offers a reveal when the second land type has an article', () => {
    const result = evaluateConditionalLandETB(
      "As this land enters, you may reveal a Mountain or a Plains card from your hand. If you don't, this land enters tapped.",
      0,
      [],
      [{ name: 'Plains', type_line: 'Basic Land — Plains' }],
    );
    expect(result.requiresRevealPrompt).toBe(true);
    expect(result.revealTypes).toEqual(['mountain', 'plains']);
  });
});
