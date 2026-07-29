/**
 * Always No on optional triggered abilities (Aura Shards) must stick across
 * subsequent ETB triggers. Effect Program runtimes snapshot state at prompt
 * time — declining must not wipe mayAutoPreferences set while the prompt was open.
 *
 * Also covers "No until targets change": skip while legal artifact/enchantment
 * targets are unchanged, then ask again when the set changes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { resumeEffectProgramResolution, drainPendingOptionalAutoChoices } from '../src/state/effects/index.js';
import {
  buildNoUntilTargetsChangeValue,
  fingerprintArtifactEnchantmentTargets,
} from '../../shared/src/mayAutoPreference.js';

function createNoopIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function pushAuraShardsTrigger(game: any, playerId: string, id: string) {
  const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
  stack.push({
    id,
    type: 'triggered_ability',
    controller: playerId,
    source: 'aura_shards_1',
    sourceName: 'Aura Shards',
    description: 'you may destroy target artifact or enchantment.',
    effect: 'you may destroy target artifact or enchantment.',
    triggerType: 'creature_etb',
    mandatory: false,
    card: {
      name: 'Aura Shards',
      type_line: 'Enchantment',
      oracle_text: 'Whenever a creature enters the battlefield under your control, you may destroy target artifact or enchantment.',
    },
  });
  (game.state as any).stack = stack;
}

function setupAuraShardsGame(game: any, playerId: string) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).battlefield = [
    {
      id: 'aura_shards_1',
      controller: playerId,
      owner: playerId,
      card: {
        name: 'Aura Shards',
        type_line: 'Enchantment',
        oracle_text: 'Whenever a creature enters the battlefield under your control, you may destroy target artifact or enchantment.',
      },
    },
    {
      id: 'sol_ring_1',
      controller: playerId,
      owner: playerId,
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    },
    {
      id: 'arcane_signet_1',
      controller: playerId,
      owner: playerId,
      card: { name: 'Arcane Signet', type_line: 'Artifact' },
    },
  ];
  (game.state as any).zones = {
    [playerId]: { hand: [], graveyard: [], library: [], exile: [] },
  };
}

function pendingOptionalMaySteps(gameId: string) {
  return ResolutionQueueManager.getQueue(gameId).steps.filter((s: any) =>
    s.status !== 'completed'
    && (s.effectProgramFamily === 'optional_triggered_ability' || s.effectProgramPrompt || s.optionalTriggeredAbilityPrompt)
  );
}

describe('Aura Shards Always No', () => {
  const gameId = 'test_aura_shards_always_no';
  const playerId = 'p1';
  const prefKey = 'aura shards:you may destroy target artifact or enchantment';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('preserves Always No set while a may prompt is open across decline', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    setupAuraShardsGame(game, playerId);

    pushAuraShardsTrigger(game, playerId, 'trigger_1');
    pushAuraShardsTrigger(game, playerId, 'trigger_2');
    pushAuraShardsTrigger(game, playerId, 'trigger_3');

    game.resolveTopOfStack();
    const step1 = pendingOptionalMaySteps(gameId)[0];
    expect(step1).toBeDefined();

    // Always No while the Effect Program prompt is still open (live client order)
    (game.state as any).mayAutoPreferences = {
      [playerId]: { [prefKey]: 'no' },
    };

    const response = {
      stepId: step1!.id,
      playerId,
      selections: ['no'],
      cancelled: true,
      timestamp: Date.now(),
    };
    ResolutionQueueManager.completeStep(gameId, step1!.id, response as any);
    resumeEffectProgramResolution({
      game,
      gameId,
      step: step1!,
      response: response as any,
      persistPrompt: false,
    });

    expect((game.state as any).mayAutoPreferences?.[playerId]?.[prefKey]).toBe('no');

    // Single resolve drains all remaining Always-No optional tops
    game.resolveTopOfStack();
    expect(pendingOptionalMaySteps(gameId)).toHaveLength(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('auto-declines a fresh Aura Shards trigger when Always No is already saved', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    setupAuraShardsGame(game, playerId);

    (game.state as any).mayAutoPreferences = {
      [playerId]: { [prefKey]: 'no' },
    };

    pushAuraShardsTrigger(game, playerId, 'trigger_fresh');
    game.resolveTopOfStack();

    expect(pendingOptionalMaySteps(gameId)).toHaveLength(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('drains multiple Always-No Aura Shards in one resolveTopOfStack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    setupAuraShardsGame(game, playerId);

    (game.state as any).mayAutoPreferences = {
      [playerId]: { [prefKey]: 'no' },
    };

    pushAuraShardsTrigger(game, playerId, 'trigger_batch_1');
    pushAuraShardsTrigger(game, playerId, 'trigger_batch_2');
    pushAuraShardsTrigger(game, playerId, 'trigger_batch_3');
    pushAuraShardsTrigger(game, playerId, 'trigger_batch_4');

    game.resolveTopOfStack();

    expect(pendingOptionalMaySteps(gameId)).toHaveLength(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('clears already-queued Aura Shards prompts when Always No is set later', async () => {
    const localGameId = `${gameId}_queued_drain`;
    await resetGame(localGameId);
    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId)!;
    setupAuraShardsGame(game, playerId);
    (game.state as any).mayAutoPreferences = {};

    // Queue many optional prompts before any preference exists (Resolve All / restart flood).
    for (let i = 0; i < 8; i++) {
      pushAuraShardsTrigger(game, playerId, `trigger_queued_${i}`);
    }
    let guard = 0;
    while (((game.state as any).stack || []).length > 0 && guard++ < 20) {
      const before = ((game.state as any).stack || []).length;
      game.resolveTopOfStack();
      if (((game.state as any).stack || []).length >= before) break;
    }

    const queuedBeforePref = pendingOptionalMaySteps(localGameId);
    expect(queuedBeforePref.length).toBeGreaterThan(1);
    expect(((game.state as any).stack || []).length).toBe(0);

    (game.state as any).mayAutoPreferences = {
      [playerId]: { [prefKey]: 'no' },
    };

    const drained = drainPendingOptionalAutoChoices(game, localGameId, playerId);
    expect(drained).toBe(queuedBeforePref.length);
    expect(pendingOptionalMaySteps(localGameId)).toHaveLength(0);

    await resetGame(localGameId);
  });

  it('skips while targets unchanged, then asks again when a new target appears', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    setupAuraShardsGame(game, playerId);

    const fingerprint = fingerprintArtifactEnchantmentTargets((game.state as any).battlefield);
    (game.state as any).mayAutoPreferences = {
      [playerId]: { [prefKey]: buildNoUntilTargetsChangeValue(fingerprint) },
    };

    pushAuraShardsTrigger(game, playerId, 'trigger_same_targets_1');
    pushAuraShardsTrigger(game, playerId, 'trigger_same_targets_2');
    game.resolveTopOfStack();
    expect(pendingOptionalMaySteps(gameId)).toHaveLength(0);
    expect(((game.state as any).stack || []).length).toBe(0);

    // Opponent artifact enters — legal target set changes
    (game.state as any).battlefield.push({
      id: 'opponent_sol_ring',
      controller: 'p2',
      owner: 'p2',
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });

    pushAuraShardsTrigger(game, playerId, 'trigger_new_target');
    game.resolveTopOfStack();
    expect(pendingOptionalMaySteps(gameId).length).toBeGreaterThan(0);
    expect((game.state as any).mayAutoPreferences?.[playerId]?.[prefKey]).toBeUndefined();
  });
});
