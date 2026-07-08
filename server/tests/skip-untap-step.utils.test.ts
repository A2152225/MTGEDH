import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  consumePlayerSkipNextUntapStep,
  markPlayerSkipsNextUntapStep,
  playerHasSkipNextUntapStep,
  shouldSkipUntapStepForPlayer,
} from '../src/state/modules/skipUntapStepUtils.js';
import { performUntapStepTurnAction } from '../src/state/modules/turn.js';
import type { PlayerID } from '../../shared/src/index.js';

describe('skip untap step utils', () => {
  it('marks and consumes per-player skip next untap step', () => {
    const game = createInitialGameState('skip_untap_utils');
    const p1 = 'p1' as PlayerID;

    expect(playerHasSkipNextUntapStep(game, p1)).toBe(false);
    markPlayerSkipsNextUntapStep(game, p1);
    expect(playerHasSkipNextUntapStep(game, p1)).toBe(true);
    expect(shouldSkipUntapStepForPlayer(game, p1)).toBe(true);
    expect(consumePlayerSkipNextUntapStep(game, p1)).toBe(true);
    expect(playerHasSkipNextUntapStep(game, p1)).toBe(false);
  });

  it('consumes per-player skip flag when untap step action is skipped', () => {
    const game = createInitialGameState('skip_untap_perform');
    const p1 = 'p1' as PlayerID;

    game.createToken(p1, 'Tapped', 1, 1, 1);
    const permId = game.state.battlefield[0].id;
    game.state.battlefield[0].tapped = true;
    markPlayerSkipsNextUntapStep(game, p1);

    const untappedIds = performUntapStepTurnAction(game, p1);
    expect(untappedIds).toEqual([]);
    expect(playerHasSkipNextUntapStep(game, p1)).toBe(false);
    expect(game.state.battlefield.find((p) => p.id === permId)?.tapped).toBe(true);
  });
});
