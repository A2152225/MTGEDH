import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {},
    }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedPlayers(game: any) {
  const p1 = 'p1';
  const p2 = 'p2';
  (game.state as any).players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  return { p1, p2 };
}

describe('on-cast compound / up-to target selection (integration)', () => {
  const gameId = 'test_on_cast_compound_upto_targets';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('World Breaker prompts for artifact/enchantment/land (excludes creature-only)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const { p1, p2 } = seedPlayers(game);

    const effect =
      'When you cast this spell, exile target artifact, enchantment, or land.';
    const metadata = inferTriggeredAbilityTargetMetadata(effect);

    (game.state as any).battlefield = [
      {
        id: 'wb_source',
        controller: p1,
        owner: p1,
        card: { name: 'World Breaker', type_line: 'Creature — Eldrazi' },
      },
      {
        id: 'sol_ring',
        controller: p2,
        owner: p2,
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      },
      {
        id: 'forest',
        controller: p2,
        owner: p2,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'bear',
        controller: p2,
        owner: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_wb',
        type: 'triggered_ability',
        controller: p1,
        source: 'wb_source',
        sourceName: 'World Breaker',
        description: effect,
        effect: 'exile target artifact, enchantment, or land',
        triggerType: 'cast',
        mandatory: true,
        requiresTarget: true,
        needsTargetSelection: true,
        targetType: metadata.targetType,
        minTargets: metadata.minTargets ?? 1,
        maxTargets: metadata.maxTargets ?? 1,
        action: 'exile_target_permanent',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeDefined();
    const ids = (step as any).validTargets.map((t: any) => t.id).sort();
    expect(ids).toEqual(['forest', 'sol_ring']);
    expect((step as any).minTargets).toBe(1);
    expect((step as any).maxTargets).toBe(1);
  });

  it('Elder Deep-Fiend prompts up-to-four with minTargets 0 (zero targets legal)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const { p1, p2 } = seedPlayers(game);

    const effect = 'When you cast this spell, tap up to four target permanents.';
    const metadata = inferTriggeredAbilityTargetMetadata(effect);

    (game.state as any).battlefield = [
      {
        id: 'edf_source',
        controller: p1,
        owner: p1,
        card: { name: 'Elder Deep-Fiend', type_line: 'Creature — Eldrazi Octopus' },
      },
      {
        id: 'perm_a',
        controller: p2,
        owner: p2,
        card: { name: 'A', type_line: 'Creature — Bear' },
      },
      {
        id: 'perm_b',
        controller: p2,
        owner: p2,
        card: { name: 'B', type_line: 'Artifact' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_edf',
        type: 'triggered_ability',
        controller: p1,
        source: 'edf_source',
        sourceName: 'Elder Deep-Fiend',
        description: effect,
        effect: 'tap up to four target permanents',
        triggerType: 'cast',
        mandatory: true,
        requiresTarget: true,
        needsTargetSelection: true,
        targetType: metadata.targetType,
        minTargets: metadata.minTargets,
        maxTargets: metadata.maxTargets,
        action: 'tap_untap_target',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeDefined();
    expect((step as any).minTargets).toBe(0);
    expect((step as any).maxTargets).toBe(3); // min(4 requested, 3 permanents on field including source)
    expect((step as any).mandatory).toBe(false);
    const ids = new Set((step as any).validTargets.map((t: any) => t.id));
    expect(ids.has('perm_a')).toBe(true);
    expect(ids.has('perm_b')).toBe(true);
    expect(ids.has('edf_source')).toBe(true);
  });

  it('Ugin-style colored permanent exile excludes colorless', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const { p1, p2 } = seedPlayers(game);

    const effect =
      "When you cast this spell, exile up to one target permanent that's one or more colors.";
    const metadata = inferTriggeredAbilityTargetMetadata(effect);

    (game.state as any).battlefield = [
      {
        id: 'ugin_source',
        controller: p1,
        owner: p1,
        card: { name: 'Ugin, Eye of the Storms', type_line: 'Legendary Planeswalker — Ugin', colors: [] },
        colors: [],
      },
      {
        id: 'blue_bear',
        controller: p2,
        owner: p2,
        card: { name: 'Blue Bear', type_line: 'Creature — Bear', colors: ['U'] },
        colors: ['U'],
      },
      {
        id: 'wastes',
        controller: p2,
        owner: p2,
        card: { name: 'Wastes', type_line: 'Basic Land', colors: [] },
        colors: [],
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_ugin',
        type: 'triggered_ability',
        controller: p1,
        source: 'ugin_source',
        sourceName: 'Ugin, Eye of the Storms',
        description: effect,
        effect: "exile up to one target permanent that's one or more colors",
        triggerType: 'cast',
        mandatory: false,
        requiresTarget: true,
        needsTargetSelection: true,
        targetType: metadata.targetType,
        minTargets: metadata.minTargets,
        maxTargets: metadata.maxTargets,
        targetFilterRequiresOneOrMoreColors: metadata.targetFilterRequiresOneOrMoreColors,
        action: 'exile_target_permanent',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeDefined();
    expect((step as any).minTargets).toBe(0);
    expect((step as any).maxTargets).toBe(1);
    expect((step as any).mandatory).toBe(false);
    const ids = (step as any).validTargets.map((t: any) => t.id);
    expect(ids).toEqual(['blue_bear']);
  });

  it('Ulamog Ceaseless Hunger requires exactly two permanent targets', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const { p1, p2 } = seedPlayers(game);

    const effect = 'When you cast this spell, exile two target permanents.';
    const metadata = inferTriggeredAbilityTargetMetadata(effect);
    expect(metadata.minTargets).toBe(2);
    expect(metadata.maxTargets).toBe(2);

    (game.state as any).battlefield = [
      {
        id: 'ulamog_source',
        controller: p1,
        owner: p1,
        card: { name: 'Ulamog, the Ceaseless Hunger', type_line: 'Legendary Creature — Eldrazi' },
      },
      {
        id: 't1',
        controller: p2,
        owner: p2,
        card: { name: 'T1', type_line: 'Creature — Bear' },
      },
      {
        id: 't2',
        controller: p2,
        owner: p2,
        card: { name: 'T2', type_line: 'Artifact' },
      },
      {
        id: 't3',
        controller: p2,
        owner: p2,
        card: { name: 'T3', type_line: 'Enchantment' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_ulamog',
        type: 'triggered_ability',
        controller: p1,
        source: 'ulamog_source',
        sourceName: 'Ulamog, the Ceaseless Hunger',
        description: effect,
        effect: 'exile two target permanents',
        triggerType: 'cast',
        mandatory: true,
        requiresTarget: true,
        needsTargetSelection: true,
        targetType: metadata.targetType,
        minTargets: metadata.minTargets,
        maxTargets: metadata.maxTargets,
        action: 'exile_target_permanent',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeDefined();
    expect((step as any).minTargets).toBe(2);
    expect((step as any).maxTargets).toBe(2);
    expect((step as any).mandatory).toBe(true);
  });
});
