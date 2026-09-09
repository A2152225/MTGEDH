import { describe, expect, it } from 'vitest';
import {
  getMobilePrimaryActionMode,
  mobileMulliganHandOpenKey,
  shouldAutoOpenMobileMulliganHand,
} from '../src/utils/mobilePlayActions';

describe('getMobilePrimaryActionMode', () => {
  it('keeps spectators and unset seats on play chrome', () => {
    expect(getMobilePrimaryActionMode({
      isSeatedPlayer: false,
      needsToKeepHand: true,
      canUnkeepHand: true,
    })).toBe('play');
  });

  it('surfaces mulligan actions while the seated player must keep', () => {
    expect(getMobilePrimaryActionMode({
      isSeatedPlayer: true,
      needsToKeepHand: true,
      canUnkeepHand: false,
    })).toBe('mulligan');
  });

  it('surfaces unkeep after a keep while the table is still waiting', () => {
    expect(getMobilePrimaryActionMode({
      isSeatedPlayer: true,
      needsToKeepHand: false,
      canUnkeepHand: true,
    })).toBe('unkeep');
  });

  it('returns play chrome after the table is ready', () => {
    expect(getMobilePrimaryActionMode({
      isSeatedPlayer: true,
      needsToKeepHand: false,
      canUnkeepHand: false,
    })).toBe('play');
  });
});

describe('shouldAutoOpenMobileMulliganHand', () => {
  it('opens the hand sheet once per dealt opening hand', () => {
    const first = shouldAutoOpenMobileMulliganHand({
      showMobileChrome: true,
      needsToKeepHand: true,
      handCount: 7,
      gameId: 'g1',
      mulligansTaken: 0,
      lastOpenedKey: null,
    });
    expect(first.open).toBe(true);
    expect(first.key).toBe(mobileMulliganHandOpenKey('g1', 0, 7));

    const again = shouldAutoOpenMobileMulliganHand({
      showMobileChrome: true,
      needsToKeepHand: true,
      handCount: 7,
      gameId: 'g1',
      mulligansTaken: 0,
      lastOpenedKey: first.key,
    });
    expect(again.open).toBe(false);
  });

  it('opens again after a mulligan deals a new hand', () => {
    const afterMulligan = shouldAutoOpenMobileMulliganHand({
      showMobileChrome: true,
      needsToKeepHand: true,
      handCount: 7,
      gameId: 'g1',
      mulligansTaken: 1,
      lastOpenedKey: mobileMulliganHandOpenKey('g1', 0, 7),
    });
    expect(afterMulligan.open).toBe(true);
  });

  it('does not open for spectators, empty hands, or desktop chrome', () => {
    expect(shouldAutoOpenMobileMulliganHand({
      showMobileChrome: false,
      needsToKeepHand: true,
      handCount: 7,
      gameId: 'g1',
      mulligansTaken: 0,
      lastOpenedKey: null,
    }).open).toBe(false);
    expect(shouldAutoOpenMobileMulliganHand({
      showMobileChrome: true,
      needsToKeepHand: false,
      handCount: 7,
      gameId: 'g1',
      mulligansTaken: 0,
      lastOpenedKey: null,
    }).open).toBe(false);
    expect(shouldAutoOpenMobileMulliganHand({
      showMobileChrome: true,
      needsToKeepHand: true,
      handCount: 0,
      gameId: 'g1',
      mulligansTaken: 0,
      lastOpenedKey: null,
    }).open).toBe(false);
  });
});
