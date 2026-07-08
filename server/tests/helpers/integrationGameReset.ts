import { deleteGame } from '../../src/db/index.js';
import { GameManager } from '../../src/GameManager.js';
import { games } from '../../src/socket/socket.js';
import { ResolutionQueueManager } from '../../src/state/resolution/index.js';

/** Clear in-memory game caches and persisted events between socket integration tests. */
export async function resetIntegrationGame(gameId: string): Promise<void> {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    GameManager.deleteGame(gameId);
  } catch {
    /* best-effort */
  }
  await deleteGame(gameId);
}
