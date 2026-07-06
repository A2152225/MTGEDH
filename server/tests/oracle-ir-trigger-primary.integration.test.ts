import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import {
  isOracleIrTriggerPrimaryEnabled,
  tryResolveTriggerViaOracleIR,
} from '../src/state/modules/oracleIrTriggerExecution.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR trigger execution', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('shadow mode probes ETB draw without mutating game state', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;

    const gameId = 'oracle_ir_trigger_shadow';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [];
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Test Creature',
      effectText: 'Draw a card.',
      triggerItem: { id: 'trigger-1', source: 'perm-1' },
    });

    expect(isOracleIrTriggerPrimaryEnabled()).toBe(false);
    expect(outcome.handled).toBe(false);
    expect(outcome.shadowWouldHandle).toBe(true);
    expect(player.hand).toHaveLength(0);
  });

  it('primary mode applies draw trigger effects', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_primary_draw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [];
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Mulldrifter',
      effectText: 'Draw two cards.',
      triggerItem: { id: 'trigger-1', source: 'mulldrifter-1' },
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThan(0);
    expect(player.hand.length + player.library.length).toBe(1);
  });

  it('primary mode queues copy_permanent target selection via server zone sync', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_copy_primary_direct';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'cryptoplasm_1',
        controller: p1,
        card: {
          name: 'Cryptoplasm',
          type_line: 'Creature — Shapeshifter',
          power: '3',
          toughness: '3',
        },
        power: 3,
        toughness: 3,
      },
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        power: 2,
        toughness: 2,
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Cryptoplasm',
      effectText:
        'you may have this creature become a copy of another target creature, except it has this ability',
      triggerItem: {
        id: 'trigger-1',
        source: 'cryptoplasm_1',
        permanentId: 'cryptoplasm_1',
      },
    });

    expect(outcome.handled).toBe(true);
    const targetSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetSteps).toHaveLength(1);
    expect((targetSteps[0] as any)?.action).toBe('self_become_copy_of_creature');
  });

  it('handles fully wired multi-step trigger effects under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_multi_step_primary';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [{
      id: 'self-1',
      controller: p1,
      card: { name: 'Clockwork Droid', type_line: 'Creature — Construct' },
    }];

    const ctx = game as any;
    ctx.gameId = gameId;

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Clockwork Droid',
      effectText: "It can't be blocked this turn and you scry 1.",
      triggerItem: { source: 'self-1', permanentId: 'self-1' },
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThan(0);
  });

  it('primary mode queues each-player land choices for end-step resource effects', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_kynaios_end_step';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 1,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [{ id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains' }];
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const effectText =
      "draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.";

    const collectedSteps = collectOracleEffectSteps(effectText, 'Kynaios and Tiro of Meletis');
    expect(collectedSteps.some((step) => step.kind === 'move_zone' && (step as any).optional === true)).toBe(true);
    expect(collectedSteps[0]?.kind).toBe('draw');
    expect(isTriggerEffectFullyIrWired(effectText, 'Kynaios and Tiro of Meletis')).toBe(true);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Kynaios and Tiro of Meletis',
      effectText,
      triggerItem: {
        id: 'kynaios_trigger_1',
        source: 'kynaios_1',
        permanentId: 'kynaios_1',
        gameId,
      },
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBeGreaterThan(0);
    expect(outcome.applied).toBeGreaterThanOrEqual(1);

    expect(outcome.handled).toBe(true);

    const landChoiceSteps = queue.steps.filter(
      (step) => step.type === ResolutionStepType.KYNAIOS_CHOICE,
    );
    expect(landChoiceSteps.length).toBeGreaterThanOrEqual(2);

    const duplicateLandOptionChoices = queue.steps.filter(
      (step) =>
        step.type === ResolutionStepType.OPTION_CHOICE
        && (step as any).oracleIrOptionalMayChoice === true
        && /put a land card from their hand onto the battlefield/i.test(String((step as any).description || '')),
    );
    expect(duplicateLandOptionChoices).toHaveLength(0);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('primary mode queues per-player counter placement without duplicate controller OPTION_CHOICE', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_advokist_counters';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'elf_1',
        controller: p2,
        card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const effectText = 'Each player may put two +1/+1 counters on a creature they control.';
    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Orzhov Advokist',
      effectText,
      triggerItem: {
        id: 'advokist_trigger_1',
        source: 'advokist_1',
        permanentId: 'advokist_1',
        gameId,
      },
    });

    expect(outcome.handled).toBe(true);
    const queue = ResolutionQueueManager.getQueue(gameId);
    const counterSteps = queue.steps.filter(
      (step) =>
        step.type === ResolutionStepType.OPTION_CHOICE
        && (step as any).counterPlacementTrigger === true,
    );
    expect(counterSteps.length).toBeGreaterThanOrEqual(2);

    const duplicateOptionChoices = queue.steps.filter(
      (step) =>
        step.type === ResolutionStepType.OPTION_CHOICE
        && (step as any).oracleIrOptionalMayChoice === true
        && /\+1\/\+1 counters on a creature they control/i.test(String((step as any).description || '')),
    );
    expect(duplicateOptionChoices).toHaveLength(0);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('primary mode creates soldier tokens for Myrel attack trigger from effectData-only stack items', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_myrel_attack';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const myrelId = 'myrel_1';
    const soldier1 = 'soldier_1';
    const soldier2 = 'soldier_2';
    (game.state as any).battlefield = [
      {
        id: myrelId,
        controller: p1,
        owner: p1,
        card: {
          name: 'Myrel, Shield of Argive',
          type_line: 'Legendary Creature — Human Soldier',
          oracle_text:
            'Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.',
        },
      },
      {
        id: soldier1,
        controller: p1,
        owner: p1,
        isToken: true,
        card: { name: 'Soldier', type_line: 'Artifact Creature — Soldier', power: '1', toughness: '1' },
      },
      {
        id: soldier2,
        controller: p1,
        owner: p1,
        isToken: true,
        card: { name: 'Soldier', type_line: 'Artifact Creature — Soldier', power: '1', toughness: '1' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    const effectText =
      'Create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.';
    const triggerItem = {
      id: 'myrel_attack_trigger',
      permanentId: myrelId,
      source: myrelId,
      triggerType: 'attacks',
      description: effectText,
      effectData: {
        countType: 'soldiers',
        power: 1,
        toughness: 1,
        tokenType: 'Soldier',
        tokenTypes: ['Artifact', 'Creature', 'Soldier'],
      },
    };

    const tokensBefore = (game.state as any).battlefield.filter((perm: any) => perm.isToken).length;
    executeTriggerEffect(ctx, p1, 'Myrel, Shield of Argive', effectText, triggerItem);
    const tokensAfter = (game.state as any).battlefield.filter((perm: any) => perm.isToken).length;

    expect(tokensAfter - tokensBefore).toBe(3);
  });

  it('primary mode applies chosen-type +1/+1 counters via effect program (Littjara chaos)', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_littjara_chaos';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
      },
      {
        id: 'gob_1',
        controller: p1,
        card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', power: '2', toughness: '2' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const effectText =
      'choose a creature type. Put a +1/+1 counter on each creature you control of that type.';
    expect(isTriggerEffectFullyIrWired(effectText, 'Littjara')).toBe(true);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Littjara',
      effectText,
      triggerItem: {
        id: 'littjara_chaos_1',
        source: 'plane_littjara',
        chosenCreatureType: 'Elf',
      },
    });

    expect(outcome.handled).toBe(true);
    const elf = (game.state as any).battlefield.find((perm: any) => perm.id === 'elf_1');
    const gob = (game.state as any).battlefield.find((perm: any) => perm.id === 'gob_1');
    expect(elf?.counters?.['+1/+1']).toBe(1);
    expect(gob?.counters?.['+1/+1']).toBeUndefined();

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('primary mode applies counter-scaled modify_pt for exert-style pumps', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_hydra_counter_scaled';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'hydra_trainer',
        controller: p1,
        counters: { '+1/+1': 2 },
        card: { name: 'Hydra Trainer', type_line: 'Creature' },
      },
      {
        id: 'counter_target',
        controller: p1,
        card: { name: 'Counter Target', type_line: 'Creature — Human' },
      },
      {
        id: 'charge_relic',
        controller: p1,
        counters: { charge: 1 },
        card: { name: 'Charge Relic', type_line: 'Artifact' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const effectText =
      'target creature gets +X/+X until end of turn, where X is the number of counters on permanents you control';
    expect(isTriggerEffectFullyIrWired(effectText, 'Hydra Trainer')).toBe(true);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Hydra Trainer',
      effectText,
      triggerItem: {
        source: 'hydra_trainer',
        targets: ['counter_target'],
      },
    });

    expect(outcome.handled).toBe(true);
    const target = (game.state as any).battlefield.find((perm: any) => perm.id === 'counter_target');
    expect(target?.temporaryPTMods).toEqual([
      expect.objectContaining({ power: 3, toughness: 3, expiresAt: 'end_of_turn' }),
    ]);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('primary mode queues creature type choice for Littjara chaos without preset type', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_littjara_choice';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const effectText =
      'choose a creature type. Put a +1/+1 counter on each creature you control of that type.';

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Littjara',
      effectText,
      triggerItem: { id: 'littjara_chaos_2', source: 'plane_littjara' },
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBe(0);
    const typeStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.type === ResolutionStepType.CREATURE_TYPE_CHOICE);
    expect(typeStep).toBeTruthy();

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('executeTriggerEffect applies Littjara chaos via IR when primary owns preset chosen type', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_littjara_execute';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'elf_1',
        controller: p1,
        card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid', power: '1', toughness: '1' },
      },
      {
        id: 'gob_1',
        controller: p1,
        card: { name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', power: '2', toughness: '2' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    const chaosText =
      'choose a creature type. Put a +1/+1 counter on each creature you control of that type.';
    executeTriggerEffect(ctx, p1, 'Littjara', chaosText, {
      source: 'plane_littjara',
      chosenCreatureType: 'Elf',
    });

    const elf = (game.state as any).battlefield.find((perm: any) => perm.id === 'elf_1');
    const gob = (game.state as any).battlefield.find((perm: any) => perm.id === 'gob_1');
    expect(elf?.counters?.['+1/+1']).toBe(1);
    expect(gob?.counters?.['+1/+1']).toBeUndefined();
  });
});
