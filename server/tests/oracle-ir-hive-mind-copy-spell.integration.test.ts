import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { collectTriggerExecutionSteps } from '../src/state/modules/oracleIrTriggerExecutionHelpers.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

const HIVE_MIND_EFFECT =
  'each other player copies that spell. Each of those players may choose new targets for their copy.';

describe('Oracle IR Hive Mind each-other-player copy_spell', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('wires the copy_spell step for each other player', () => {
    const steps = collectTriggerExecutionSteps(HIVE_MIND_EFFECT, 'Hive Mind');
    const copyStep = steps.find((step) => step.kind === 'copy_spell') as Extract<typeof steps[number], { kind: 'copy_spell' }> | undefined;
    expect(copyStep).toBeTruthy();
    expect(copyStep?.who).toEqual({ kind: 'each_opponent' });
    expect(copyStep?.allowNewTargets).toBe(true);
    expect(isTriggerEffectFullyIrWired(HIVE_MIND_EFFECT, 'Hive Mind')).toBe(true);
  });

  it('puts one stack copy under each other player and queues their retargets', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_hive_mind_copy_spell';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent({ type: 'join', playerId: p3, name: 'P3' } as any);

    const triggeringStackId = 'stack_lightning_hive_1';
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
      { id: p3, name: 'P3', life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'hive_mind_1',
        controller: p1,
        card: {
          name: 'Hive Mind',
          type_line: 'Enchantment',
          oracle_text:
            'Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'lightning_bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [p1],
        copyRetargetValidTargets: [
          { id: p1, type: 'player' },
          { id: p2, type: 'player' },
          { id: p3, type: 'player' },
        ],
        copyRetargetMinTargets: 1,
        copyRetargetMaxTargets: 1,
        copyRetargetTargetDescription: 'any target',
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Hive Mind',
      HIVE_MIND_EFFECT,
      {
        id: 'hive_mind_trigger_1',
        permanentId: 'hive_mind_1',
        source: 'hive_mind_1',
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: p2,
        effectData: { triggeringStackItemId: triggeringStackId, casterId: p2 },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((item: any) => String(item?.controller || '')))).toEqual(new Set([p1, p3]));
    expect(copies.every((item: any) => item?.type === 'spell' && item?.copiedBySourceName === 'Hive Mind')).toBe(true);
    expect(stackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);

    const retargetSteps = [
      ...ResolutionQueueManager.getStepsForPlayer(gameId, p1),
      ...ResolutionQueueManager.getStepsForPlayer(gameId, p3),
    ].filter((step: any) => step?.retargetSpellCopy === true || step?.retargetSpellCopyTargetSelection === true);
    expect(retargetSteps).toHaveLength(2);
    expect(new Set(retargetSteps.map((step: any) => String(step?.playerId || '')))).toEqual(new Set([p1, p3]));
  });

  it('does not give Hive Mind copies or retarget prompts to a defeated player', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_hive_mind_copy_spell_defeated';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent({ type: 'join', playerId: p3, name: 'P3' } as any);

    const triggeringStackId = 'stack_lightning_hive_defeated_1';
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
      { id: p3, name: 'P3', life: 0, hasLost: true, eliminated: true },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'hive_mind_1',
        controller: p1,
        card: {
          name: 'Hive Mind',
          type_line: 'Enchantment',
          oracle_text:
            'Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'lightning_bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [p1],
        copyRetargetValidTargets: [
          { id: p1, type: 'player' },
          { id: p2, type: 'player' },
          { id: p3, type: 'player' },
        ],
        copyRetargetMinTargets: 1,
        copyRetargetMaxTargets: 1,
        copyRetargetTargetDescription: 'any target',
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Hive Mind',
      HIVE_MIND_EFFECT,
      {
        id: 'hive_mind_trigger_1',
        permanentId: 'hive_mind_1',
        source: 'hive_mind_1',
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: p2,
        effectData: { triggeringStackItemId: triggeringStackId, casterId: p2 },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(String(copies[0]?.controller || '')).toBe(p1);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p3)).toHaveLength(0);
    const livingRetargets = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step: any) => step?.retargetSpellCopy === true || step?.retargetSpellCopyTargetSelection === true);
    expect(livingRetargets).toHaveLength(1);
  });

  it('copies the last-known triggering spell after it has already left the stack', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_hive_mind_copy_spell_left_stack';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent({ type: 'join', playerId: p3, name: 'P3' } as any);

    const triggeringStackId = 'stack_warcraft_hive_left_1';
    const leftoverWarpId = 'stack_warp_world_leftover_1';
    const triggeringSnapshot = {
      id: triggeringStackId,
      type: 'spell',
      controller: p2,
      card: {
        id: 'warcraft_card',
        name: 'Master Warcraft',
        type_line: 'Instant',
        oracle_text: 'Cast this spell only before the combat damage step.',
      },
      targets: [p1],
    };
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
      { id: p3, name: 'P3', life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'hive_mind_1',
        controller: p1,
        card: {
          name: 'Hive Mind',
          type_line: 'Enchantment',
          oracle_text:
            'Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: leftoverWarpId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'warp_world_card',
          name: 'Warp World',
          type_line: 'Sorcery',
        },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Hive Mind',
      HIVE_MIND_EFFECT,
      {
        id: 'hive_mind_trigger_1',
        permanentId: 'hive_mind_1',
        source: 'hive_mind_1',
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: p2,
        effectData: {
          triggeringStackItemId: triggeringStackId,
          casterId: p2,
          triggeringSpell: { id: 'warcraft_card', name: 'Master Warcraft', type_line: 'Instant' },
          triggeringSpellStackItem: triggeringSnapshot,
        },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => String(item?.card?.name || '') === 'Master Warcraft')).toBe(true);
    expect(stackItems.some((item: any) => item?.id === leftoverWarpId)).toBe(true);
    expect(stackItems.filter((item: any) => String(item?.card?.name || '') === 'Warp World')).toHaveLength(1);
  });

  it('does not copy a leftover live spell when only the triggering spell name is known', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_hive_mind_copy_spell_name_only';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent({ type: 'join', playerId: p3, name: 'P3' } as any);

    const triggeringStackId = 'stack_warcraft_hive_name_only_1';
    const leftoverWarpId = 'stack_warp_world_name_only_1';
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
      { id: p3, name: 'P3', life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).battlefield = [
      {
        id: 'hive_mind_1',
        controller: p1,
        card: {
          name: 'Hive Mind',
          type_line: 'Enchantment',
          oracle_text:
            'Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: leftoverWarpId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'warp_world_card',
          name: 'Warp World',
          type_line: 'Sorcery',
        },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Hive Mind',
      HIVE_MIND_EFFECT,
      {
        id: 'hive_mind_trigger_1',
        permanentId: 'hive_mind_1',
        source: 'hive_mind_1',
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: p2,
        effectData: {
          triggeringStackItemId: triggeringStackId,
          casterId: p2,
          triggeringSpell: { id: 'warcraft_card', name: 'Master Warcraft', type_line: 'Instant' },
        },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.isCopy === true || item?.copiedFromStackItemId);
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.every((item: any) => String(item?.card?.name || '') === 'Master Warcraft')).toBe(true);
    expect(stackItems.filter((item: any) => String(item?.card?.name || '') === 'Warp World')).toHaveLength(1);
  });
});
