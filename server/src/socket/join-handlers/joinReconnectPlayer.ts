/**
 * Origin parent: server/src/socket/join.ts
 *
 * Cluster moved: reconnect cleanup for deferred-leave flags that survive
 * event replay after a server restart.
 *
 * Public entry symbols: clearDeferredLeaveOnReconnect.
 */

/**
 * Socket disconnect / deferred leave stamps `leftGame` + `conceded` and can
 * persist a `leave` event. After restore, reconnect reuses that roster row
 * without clearing those flags, so `resolvePlayers('you')` skips the sitting
 * player and IR scry/surveil (and similar) fail all-or-nothing.
 *
 * Real losses (`hasLost` / `eliminated`) and a true concede (no `leave`
 * departure mode) stay in place.
 */
export function clearDeferredLeaveOnReconnect(player: any, state: any): boolean {
  if (!player || typeof player !== 'object') return false;
  if (player.hasLost === true || player.eliminated === true) return false;

  const playerId = String(player.id || '').trim();
  player.connected = true;

  const departureMode = String(player.departureMode || '').trim().toLowerCase();
  const isDeferredLeave = departureMode === 'leave' || player.leftGame === true;
  if (!isDeferredLeave) return false;

  delete player.leftGame;
  delete player.leftAt;
  if (departureMode === 'leave' || player.conceded === true) {
    delete player.conceded;
    delete player.concededAt;
    delete player.departureMode;
  }

  if (playerId && state?.autoPassForTurn && typeof state.autoPassForTurn === 'object') {
    delete state.autoPassForTurn[playerId];
  }

  return true;
}
