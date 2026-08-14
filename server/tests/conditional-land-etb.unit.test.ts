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
