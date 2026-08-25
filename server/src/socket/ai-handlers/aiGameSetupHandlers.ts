/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: createConfiguredGame plus normalizeRequestedGameSeed used
 * when AI handlers create a game room.
 *
 * Public entry symbols: createConfiguredGame.
 */
import { GameManager } from "../../GameManager.js";
import { appendEvent, gameExistsInDb } from "../../db/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";

function normalizeRequestedGameSeed(rawSeed: unknown): number | undefined {
  if (rawSeed == null) return undefined;
  if (typeof rawSeed === 'string' && rawSeed.trim() === '') return undefined;

  const parsedSeed = typeof rawSeed === 'number' ? rawSeed : Number(rawSeed);
  if (!Number.isFinite(parsedSeed) || !Number.isInteger(parsedSeed) || parsedSeed <= 0 || parsedSeed > 0xFFFFFFFF) {
    throw new Error('Invalid game seed. Expected an integer between 1 and 4294967295.');
  }

  return parsedSeed >>> 0;
}

export async function createConfiguredGame(
  gameId: string,
  format: unknown,
  startingLife: unknown,
  seed: unknown,
  logPrefix: string,
): Promise<{
  game: any;
  selectedFormat: string;
  selectedStartingLife: number;
  selectedSeed: number | undefined;
}> {
  if (GameManager.getGame(gameId) || gameExistsInDb(gameId)) {
    throw Object.assign(new Error('Game already exists.'), {
      code: 'GAME_ALREADY_EXISTS',

          // Let the normal broadcast-driven AI/auto-pass flow handle any
          // further progression after this step settles.
    });
  }

  let game = GameManager.getGame(gameId);
  if (!game) {
    try {
      game = GameManager.createGame({ id: gameId });
      debug(1, `${logPrefix} Created new game via GameManager:`, gameId);
    } catch (createErr: any) {
      game = GameManager.getGame(gameId);
      if (!game) {
        debugError(1, `${logPrefix} Failed to create or get game:`, createErr);
        throw new Error('Failed to create game');
      }
      debug(1, `${logPrefix} Game was created by another request, reusing:`, gameId);
    }
  }

  game.state = (game.state || {}) as any;
  const selectedFormat = typeof format === 'string' ? format : 'commander';
  const selectedStartingLife = typeof startingLife === 'number'
    ? startingLife
    : (selectedFormat === 'commander' ? 40 : 20);
  const selectedSeed = normalizeRequestedGameSeed(seed);

  (game.state as any).format = selectedFormat;
  (game.state as any).startingLife = selectedStartingLife;

  if (selectedSeed !== undefined) {
    try {
      if (typeof (game as any).seedRng === 'function') {
        (game as any).seedRng(selectedSeed);
      }
    } catch (err) {
      debugWarn(1, `${logPrefix} Failed to set rng seed on game instance (continuing):`, err);
    }

    try {
      (game.state as any).rngSeed = selectedSeed;
      (game as any)._rngSeed = selectedSeed;
    } catch {
      // best-effort only
    }

    try {
      await appendEvent(gameId, (game as any).seq || 0, 'rngSeed', { seed: selectedSeed });
    } catch (err) {
      debugWarn(1, `${logPrefix} appendEvent rngSeed failed (continuing):`, err);
    }
  }

  return { game, selectedFormat, selectedStartingLife, selectedSeed };
}
