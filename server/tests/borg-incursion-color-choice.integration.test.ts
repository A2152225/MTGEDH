import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { applyResolutionStepSideEffects } from '../src/socket/resolution.js';
import { clearEffectProgramRuntimes } from '../src/state/effects/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'test_borg_incursion_color_choice';
const BORG_ORACLE =
  "Create two 1/1 colorless Borg artifact creature tokens, then artifact creatures you control gain protection from the color of your choice until end of turn. (They can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that color.)";

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  clearEffectProgramRuntimes(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Borg Incursion color_choice (gate shard 298)', () => {
  const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    await resetGame();
  });

  afterEach(async () => {
    await resetGame();
    if (previousSpellPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
  });

  it('answers choose_color once and finishes without re-queuing', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = gameId;
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'artifact_creature_1',
        controller: 'p1',
        card: {
          id: 'myr_card',
          name: 'Myr',
          type_line: 'Artifact Creature — Myr',
          colors: [],
        },
      },
      {
        id: 'non_artifact_creature_1',
        controller: 'p1',
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'stack_borg_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'borg_card_1',
          name: 'Borg Incursion',
          type_line: 'Instant',
          oracle_text: BORG_ORACLE,
        },
      },
    ];

    game.resolveTopOfStack();

    const queueAfterPause = ResolutionQueueManager.getQueue(gameId);
    const colorSteps = queueAfterPause.steps.filter((s) => s.type === ResolutionStepType.COLOR_CHOICE);
    expect(colorSteps.length).toBeGreaterThanOrEqual(1);
    expect(((game.state as any).stack || []).some((s: any) => String(s?.card?.name || '') === 'Borg Incursion')).toBe(true);

    const step = colorSteps[0] as any;
    const response = {
      stepId: step.id,
      playerId: 'p1',
      selections: ['red'],
      cancelled: false,
      timestamp: Date.now(),
    };
    expect(ResolutionQueueManager.completeStep(gameId, step.id, response)).toBeTruthy();

    const io = { to: () => ({ emit: vi.fn() }), emit: vi.fn() } as any;
    await applyResolutionStepSideEffects(io, game, gameId, step, response);

    const pendingColor = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (s) => s.type === ResolutionStepType.COLOR_CHOICE,
    );
    expect(pendingColor).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    const artifact = (game.state as any).battlefield.find((p: any) => p.id === 'artifact_creature_1');
    const bear = (game.state as any).battlefield.find((p: any) => p.id === 'non_artifact_creature_1');
    expect(artifact?.temporaryProtection).toEqual([
      expect.objectContaining({ from: 'red', untilEndOfTurn: true }),
    ]);
    expect(bear?.temporaryProtection || []).toHaveLength(0);

    // Answering once must not restart create_token in a loop.
    const borgTokens = ((game.state as any).battlefield || []).filter((p: any) =>
      String(p?.card?.name || '').toLowerCase().includes('borg'),
    );
    expect(borgTokens.length).toBeLessThanOrEqual(4);
  });
});
