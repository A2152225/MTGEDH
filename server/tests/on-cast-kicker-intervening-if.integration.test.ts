import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_e: string, _p: any) => {} }),
    emit: (_e: string, _p: any) => {},
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('on-cast kicker intervening-if (integration)', () => {
  const gameId = 'test_on_cast_kicker_intervening_if';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('unkicked Mycospawn kicked-exile trigger is skipped (no target prompt)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('missing game');
    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'land_1',
        controller: p2,
        owner: p2,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_kick',
        type: 'triggered_ability',
        controller: p1,
        source: 'mycospawn_spell',
        sourceName: 'Sowing Mycospawn',
        description: 'When you cast this spell, if it was kicked, exile target land',
        effect: 'if it was kicked, exile target land',
        triggerType: 'triggered_ability',
        mandatory: true,
        requiresTarget: true,
        needsTargetSelection: true,
        targetType: 'land',
        minTargets: 1,
        maxTargets: 1,
        wasKicked: false,
        card: { name: 'Sowing Mycospawn', wasKicked: false },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeUndefined();
    // Trigger consumed / skipped
    const still = ((game.state as any).stack || []).find((s: any) => s?.id === 'trigger_kick');
    expect(still).toBeUndefined();
  });

  it('Wastescape U-kicker-only does not prompt for G-kicker exile targets', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('missing game');
    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'sol',
        controller: p2,
        owner: p2,
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_g',
        type: 'triggered_ability',
        controller: p1,
        source: 'wastescape_spell',
        sourceName: 'Wastescape Battlemage',
        description:
          'When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls',
        effect:
          'if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls',
        triggerType: 'triggered_ability',
        mandatory: true,
        requiresTarget: true,
        needsTargetSelection: true,
        targetType: 'artifact or enchantment',
        targetConstraint: 'opponent',
        minTargets: 1,
        maxTargets: 1,
        wasKicked: true,
        paidKickerCosts: ['{1}{U}'],
        card: { name: 'Wastescape Battlemage', wasKicked: true, paidKickerCosts: ['{1}{U}'] },
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeUndefined();
  });
});
