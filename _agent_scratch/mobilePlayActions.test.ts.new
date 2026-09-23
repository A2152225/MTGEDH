import { describe, expect, it } from 'vitest';
import {
  getMobilePrimaryActionMode,
  mobileMulliganHandOpenKey,
  mobileStackPriorityOpenKey,
  shouldAutoOpenMobileMulliganHand,
  shouldAutoOpenMobileStackSheet,
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

describe('shouldAutoOpenMobileStackSheet', () => {
  it('opens once when priority gains to you with a non-empty stack', () => {
    const first = shouldAutoOpenMobileStackSheet({
      showMobileChrome: true,
      isSeatedPlayer: true,
      hasPriority: true,
      stackLength: 2,
      gameId: 'g1',
      priority: 'p1',
      topStackId: 's-top',
      lastOpenedKey: null,
    });
    expect(first.open).toBe(true);
    expect(first.key).toBe(mobileStackPriorityOpenKey('g1', 'p1', 2, 's-top'));

    const again = shouldAutoOpenMobileStackSheet({
      showMobileChrome: true,
      isSeatedPlayer: true,
      hasPriority: true,
      stackLength: 2,
      gameId: 'g1',
      priority: 'p1',
      topStackId: 's-top',
      lastOpenedKey: first.key,
    });
    expect(again.open).toBe(false);
  });

  it('opens again when the top of stack changes while you still have priority', () => {
    const next = shouldAutoOpenMobileStackSheet({
      showMobileChrome: true,
      isSeatedPlayer: true,
      hasPriority: true,
      stackLength: 3,
      gameId: 'g1',
      priority: 'p1',
      topStackId: 's-new',
      lastOpenedKey: mobileStackPriorityOpenKey('g1', 'p1', 2, 's-top'),
    });
    expect(next.open).toBe(true);
  });

  it('does not open without mobile chrome, seat, priority, or stack items', () => {
    const base = {
      showMobileChrome: true,
      isSeatedPlayer: true,
      hasPriority: true,
      stackLength: 1,
      gameId: 'g1',
      priority: 'p1',
      topStackId: 's1',
      lastOpenedKey: null as string | null,
    };
    expect(shouldAutoOpenMobileStackSheet({ ...base, showMobileChrome: false }).open).toBe(false);
    expect(shouldAutoOpenMobileStackSheet({ ...base, isSeatedPlayer: false }).open).toBe(false);
    expect(shouldAutoOpenMobileStackSheet({ ...base, hasPriority: false }).open).toBe(false);
    expect(shouldAutoOpenMobileStackSheet({ ...base, stackLength: 0 }).open).toBe(false);
  });

  it('keeps lastOpenedKey when conditions are not met so an explicit close is respected', () => {
    const key = mobileStackPriorityOpenKey('g1', 'p1', 1, 's1');
    const closed = shouldAutoOpenMobileStackSheet({
      showMobileChrome: true,
      isSeatedPlayer: true,
      hasPriority: false,
      stackLength: 1,
      gameId: 'g1',
      priority: 'p2',
      topStackId: 's1',
      lastOpenedKey: key,
    });
    expect(closed.open).toBe(false);
    expect(closed.key).toBe(key);
  });
});