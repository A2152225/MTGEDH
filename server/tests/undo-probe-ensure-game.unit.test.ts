import { afterEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { isUndoProbeGameId } from '../src/gameRestoreState.js';
import { ensureGame } from '../src/socket/util.js';
import {
  ResolutionQueueEvent,
  ResolutionQueueManager,
  ResolutionStepType,
} from '../src/state/resolution/index.js';
import { finalizeGameStateAfterReplay } from '../src/state/modules/replay-prompt-cleanup.js';

describe('undo probe game ids', () => {
  const probeId = 'undo_probe_game_mt9pcfvk';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(probeId);
    GameManager.deleteGame(probeId);
  });

  it('treats undo_probe_ prefix as a scratch id, not a live table', () => {
    expect(isUndoProbeGameId(probeId)).toBe(true);
    expect(isUndoProbeGameId('game_mt9pcfvk')).toBe(false);
  });

  it('does not recreate a probe id via GameManager.ensureGame', () => {
    expect(GameManager.ensureGame(probeId)).toBeUndefined();
    expect(GameManager.getGame(probeId)).toBeUndefined();
  });

  it('does not recreate a probe id via util ensureGame', () => {
    expect(ensureGame(probeId)).toBeUndefined();
  });

  it('does not emit resolution events for undo probe game ids', () => {
    const seen: string[] = [];
    const handler = (_event: ResolutionQueueEvent, eventGameId: string) => {
      seen.push(eventGameId);
    };
    ResolutionQueueManager.on(handler);
    try {
      ResolutionQueueManager.addStep(probeId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: 'p1',
        description: 'Probe prompt',
        mandatory: false,
        options: [{ id: 'yes', label: 'Yes' }],
      } as any);
      expect(seen).toEqual([]);
    } finally {
      ResolutionQueueManager.off(handler);
    }
  });

  it('finalizeGameStateAfterReplay drops probe queues without treating them as live games', () => {
    ResolutionQueueManager.beginReplay(probeId);
    finalizeGameStateAfterReplay({ gameId: probeId, state: {} } as any);
    expect(ResolutionQueueManager.isReplaying(probeId)).toBe(false);
    expect(ResolutionQueueManager.getPendingSummary(probeId).hasPending).toBe(false);
  });
});
