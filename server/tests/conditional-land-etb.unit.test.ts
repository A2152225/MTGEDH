import { describe, expect, it } from 'vitest';

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
