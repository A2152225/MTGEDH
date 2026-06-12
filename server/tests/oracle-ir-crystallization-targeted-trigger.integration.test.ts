import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { triggerPermanentTargetedTriggersFromSpell } from '../src/state/modules/triggers/targeted.js';
import { processTargetedTriggersForSpellTargets } from '../src/socket/game-actions.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Crystallization attachment targeted trigger', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  const crystallizationOracleText =
    'Enchant creature\nEnchanted creature can\'t attack or block.\nWhen enchanted creature becomes the target of a spell or ability, exile that creature.';

  function seedCrystallizationBoard(game: any, playerId: PlayerID) {
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: playerId,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'crystallization_1',
        controller: playerId,
        attachedTo: 'bear_1',
        card: {
          name: 'Crystallization',
          type_line: 'Enchantment — Aura',
          oracle_text: crystallizationOracleText,
        },
      },
    ];
  }

  it('queues Crystallization when its enchanted creature is targeted by a spell', () => {
    const gameId = 'test_oracle_ir_crystallization_spell_targeted';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const spellStackId = 'stack_giant_growth_crystallization_1';
    seedCrystallizationBoard(game, p1);
    (game.state as any).stack = [
      {
        id: spellStackId,
        type: 'spell',
        controller: p1,
        sourceName: 'Giant Growth',
        targets: ['bear_1'],
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };

    processTargetedTriggersForSpellTargets(game, p1, ['bear_1'], gameId, spellStackId);

    const crystallizationTrigger = getStackItems((game.state as any).stack)
      .find((item: any) => item?.sourceName === 'Crystallization');
    expect(crystallizationTrigger).toBeDefined();
    expect(crystallizationTrigger?.triggerType).toBe('targeted');
    expect(String(crystallizationTrigger?.description || '')).toMatch(/exile that creature/i);
    expect(crystallizationTrigger?.source).toBe('crystallization_1');
    expect(crystallizationTrigger?.effectData?.targetedPermanentId).toBe('bear_1');
  });

  it('queues Crystallization via attachedEquipment linkage on the enchanted creature', () => {
    const gameId = 'test_oracle_ir_crystallization_attached_equipment_link';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        attachedEquipment: ['shell_1'],
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'shell_1',
        controller: p1,
        attachedTo: 'bear_1',
        card: {
          name: 'Spirit Loop',
          type_line: 'Enchantment — Aura',
          oracle_text: 'When enchanted creature becomes the target of a spell or ability, return that creature to its owner\'s hand.',
        },
      },
    ];

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: 'stack_shock_1',
      targetIds: ['bear_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.sourceName).toBe('Spirit Loop');
    expect(targetedTriggers[0]?.effectData?.targetedPermanentId).toBe('bear_1');
  });

  it('queues Crystallization via attachedTo linkage when attachedEquipment is unset on the creature', () => {
    const gameId = 'test_oracle_ir_crystallization_attached_to_only_link';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'crystallization_1',
        controller: p1,
        attachedTo: 'bear_1',
        card: {
          name: 'Crystallization',
          type_line: 'Enchantment — Aura',
          oracle_text: crystallizationOracleText,
        },
      },
    ];

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: 'stack_giant_growth_attached_to_only_1',
      targetIds: ['bear_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.sourceName).toBe('Crystallization');
    expect(targetedTriggers[0]?.effectData?.targetedPermanentId).toBe('bear_1');
  });

  it('queues equipped-creature attachment triggers for equipment linked via attachedTo', () => {
    const gameId = 'test_oracle_ir_equipped_creature_targeted_trigger';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const equipmentOracleText =
      'Equipped creature has hexproof.\nWhenever equipped creature becomes the target of a spell or ability, draw a card.';

    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'swiftfoot_boots_1',
        controller: p1,
        attachedTo: 'bear_1',
        card: {
          name: 'Swiftfoot Boots',
          type_line: 'Artifact — Equipment',
          oracle_text: equipmentOracleText,
        },
      },
    ];

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: 'stack_giant_growth_equipment_1',
      targetIds: ['bear_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.sourceName).toBe('Swiftfoot Boots');
    expect(String(targetedTriggers[0]?.description || '')).toMatch(/draw a card/i);
    expect(targetedTriggers[0]?.effectData?.targetedPermanentId).toBe('bear_1');
  });
});
