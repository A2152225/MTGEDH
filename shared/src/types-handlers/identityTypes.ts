/**
 * Origin parent: shared/src/types.ts
 *
 * Cluster moved: identity aliases (GameID, PlayerID, SeatIndex, GameFormat).
 *
 * Public entry symbols: GameID, PlayerID, SeatIndex, GameFormat.
 */

export type GameID = string;
export type PlayerID = string;
export type SeatIndex = number;

export type GameFormat = 'commander' | 'standard' | 'modern' | 'vintage' | 'legacy' | 'pauper' | 'custom';
