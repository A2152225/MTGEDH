import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { collectTriggerExecutionSteps } from '../src/state/modules/oracleIrTriggerExecutionHelpers.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR trigger copy_spell stack push', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('copies the triggering instant onto the stack when a spell-cast trigger resolves', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_trigger_copy_spell_stack';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const stormPermanentId = 'tys_1';
    const triggeringStackId = 'stack_lightning_1';
    const effectText =
      "copy it for each other instant and sorcery spell you've cast before it this turn";

    const steps = collectTriggerExecutionSteps(effectText, 'Thousand-Year Storm');
    expect(steps.some((step) => step.kind === 'copy_spell')).toBe(true);

    (game.state as any).spellsCastThisTurn = [
      { id: 'spell_a', name: 'Opt', casterId: p1 },
      { id: 'spell_b', name: 'Shock', casterId: p1 },
      { id: 'spell_c', name: 'Lightning Bolt', casterId: p1 },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'spell',
        controller: p1,
        card: {
          id: 'lightning_bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: ['p2'],
      },
    ];
    (game.state as any).players = [
      { id: p1, name: 'P1' },
      { id: 'p2', name: 'P2', life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: stormPermanentId,
        controller: p1,
        card: {
          name: 'Thousand-Year Storm',
          type_line: 'Enchantment',
          oracle_text:
            "Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn.",
        },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();

    executeTriggerEffect(
      game as any,
      p1,
      'Thousand-Year Storm',
      effectText,
      {
        permanentId: stormPermanentId,
        source: stormPermanentId,
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: p1,
        effectData: {
          casterId: p1,
          triggeringStackItemId: triggeringStackId,
        },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter(
      (item: any) => item?.copiedFromStackItemId === triggeringStackId,
    );
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => item?.isCopy === true && item?.copiedBySourceName === 'Thousand-Year Storm')).toBe(true);
    expect(stackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
  });
});
