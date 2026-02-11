import type { GameID } from "../../../shared/src/index.js";
import type { InMemoryGame } from "../state/types";

// Shared globals used across socket modules.
// Keep this module side-effect free to avoid accidental duplicate module graphs.
export const games = new Map<GameID, InMemoryGame>();
export const priorityTimers = new Map<GameID, NodeJS.Timeout>();
export const PRIORITY_TIMEOUT_MS = 30_000;

