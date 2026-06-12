import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Bracers direct copy ability', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('copies the triggering ability immediately under trigger IR primary', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const effectText = 'copy that ability. You may choose new targets for the copy.';
    expect(isTriggerEffectFullyIrWired(effectText, "Illusionist's Bracers")).toBe(true);

    const gameId = 'test_oracle_ir_bracers_copy_ability';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const triggeringStackId = 'stack_chromatic_sphere_ability_1';
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: p1,
        source: 'chromatic_sphere_1',
        sourceName: 'Chromatic Sphere',
        abilityText: '{1}, {T}, Pay 1 life: Add one mana of any color.',
        targets: [{ id: 'p2', type: 'player' }],
      },
      {
        id: 'bracers_trigger_1',
        type: 'triggered_ability',
        controller: p1,
        source: 'bracers_1',
        sourceName: "Illusionist's Bracers",
        description: effectText,
        triggerType: 'ability_activated',
        triggeringStackItemId: triggeringStackId,
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();

    executeTriggerEffect(
      game as any,
      p1,
      "Illusionist's Bracers",
      effectText,
      {
        id: 'bracers_trigger_1',
        permanentId: 'bracers_1',
        source: 'bracers_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.copiedBySourceName).toBe("Illusionist's Bracers");
  });
});
