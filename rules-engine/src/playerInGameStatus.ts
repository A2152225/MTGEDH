/**
 * Whether a player has left the game for continuous-effect purposes.
 * CR 800.4 / 104.5: objects they own leave, and their static effects stop.
 *
 * Public entry symbols: playerHasLeftTheGame, controllerHasLeftTheGame,
 * playerIsLegalAttackTarget.
 */

export type PlayerInGameStatusLike = {
  id?: string;
  hasLost?: boolean;
  eliminated?: boolean;
  leftGame?: boolean;
  conceded?: boolean;
  spectator?: boolean;
  isSpectator?: boolean;
};

export function playerHasLeftTheGame(
  player: PlayerInGameStatusLike | null | undefined,
): boolean {
  if (!player) return false;
  return Boolean(player.hasLost || player.eliminated || player.leftGame || player.conceded);
}

export function controllerHasLeftTheGame(
  state: {
    players?: readonly PlayerInGameStatusLike[];
  } | null | undefined,
  controllerId: string | null | undefined,
): boolean {
  const id = String(controllerId || '').trim();
  if (!id) return false;
  const players = state?.players;
  if (!Array.isArray(players) || players.length === 0) return false;
  const player = players.find((entry) => String(entry?.id || '').trim() === id);
  if (!player) return false;
  return playerHasLeftTheGame(player);
}

/**
 * CR 506.2 / 800.4: a player who has left the game (or is only spectating)
 * is not a legal attack target. Does not use life totals — "can't lose"
 * effects can keep a 0-life player in the game.
 */
export function playerIsLegalAttackTarget(
  player: PlayerInGameStatusLike | null | undefined,
  attackingPlayerId?: string | null,
): boolean {
  const id = String(player?.id || '').trim();
  if (!id) return false;
  if (attackingPlayerId && id === String(attackingPlayerId).trim()) return false;
  if (playerHasLeftTheGame(player)) return false;
  if (player?.spectator || player?.isSpectator) return false;
  return true;
}
