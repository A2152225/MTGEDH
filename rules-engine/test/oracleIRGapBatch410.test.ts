import { describe, expect, it } from 'vitest';
import { isActivatableStationThresholdEffect } from '../src/stationPermanentUtils.ts';

describe('oracle IR gap batch410 — Station threshold static vs activated', () => {
  it('treats keyword-only threshold lines as non-activatable', () => {
    expect(isActivatableStationThresholdEffect('Flying')).toBe(false);
    expect(isActivatableStationThresholdEffect('Flying, vigilance')).toBe(false);
    expect(isActivatableStationThresholdEffect('Creatures you control have flying.')).toBe(false);
  });

  it('treats continuous threshold grants as non-activatable', () => {
    expect(isActivatableStationThresholdEffect('You may play an additional land on each of your turns.')).toBe(false);
    expect(isActivatableStationThresholdEffect('This becomes an artifact creature.')).toBe(false);
  });

  it('keeps once-per-turn graveyard cast threshold text as activatable', () => {
    expect(
      isActivatableStationThresholdEffect(
        'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.',
      ),
    ).toBe(true);
  });
});
