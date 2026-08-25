/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: getBattlefield (battlefield array accessor) plus the
 * EnsureInRoomAndSeated type extracted socket handlers take instead of
 * closing over registerInteractionHandlers.
 *
 * Public entry symbols: getBattlefield, EnsureInRoomAndSeated.
 */
import type { BattlefieldPermanent } from "../../../../shared/src/index.js";

export type EnsureInRoomAndSeated = (
  gameId: unknown,
) => { gameId: string; game: any; pid: string } | undefined;

export const getBattlefield = (game: any): BattlefieldPermanent[] =>
  Array.isArray(game?.state?.battlefield)
    ? (game.state.battlefield as BattlefieldPermanent[])
    : [];
