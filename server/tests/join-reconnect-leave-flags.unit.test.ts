import { describe, expect, it } from 'vitest';
import { clearDeferredLeaveOnReconnect } from '../src/socket/join-handlers/joinReconnectPlayer.js';

describe('clearDeferredLeaveOnReconnect', () => {
  it('clears deferred leave and auto-pass without touching a true loss', () => {
    const player: any = {
      id: 'p1',
      leftGame: true,
      conceded: true,
      departureMode: 'leave',
      connected: false,
    };
    const state: any = { autoPassForTurn: { p1: true } };

    expect(clearDeferredLeaveOnReconnect(player, state)).toBe(true);
    expect(player.leftGame).toBeUndefined();
    expect(player.conceded).toBeUndefined();
    expect(player.departureMode).toBeUndefined();
    expect(player.connected).toBe(true);
    expect(state.autoPassForTurn.p1).toBeUndefined();
  });

  it('does not revive a player who has lost', () => {
    const player: any = {
      id: 'p1',
      hasLost: true,
      leftGame: true,
      conceded: true,
      departureMode: 'leave',
    };

    expect(clearDeferredLeaveOnReconnect(player, {})).toBe(false);
    expect(player.leftGame).toBe(true);
    expect(player.conceded).toBe(true);
  });
});
