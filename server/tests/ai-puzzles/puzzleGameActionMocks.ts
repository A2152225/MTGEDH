/**
 * Shared game-actions mocks for priority / sequencing AI puzzles.
 * One vi.mock factory so all observers see the same call history.
 */

import { vi } from 'vitest';

export const requestCastSpellForSocket = vi.fn();
export const handlePlayLandRequest = vi.fn();

vi.mock('../../src/socket/game-actions.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/socket/game-actions.js')>(
    '../../src/socket/game-actions.js',
  );
  return {
    ...actual,
    requestCastSpellForSocket,
    handlePlayLandRequest,
  };
});
