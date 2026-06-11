import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseBareTriggerEffectFragmentSteps } from '../../rules-engine/src/oracleIRParserPostprocess.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyPermanentBecomeCopyOfTargetPermanent } from '../src/state/modules/permanent-copy.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('Cryptoplasm upkeep copy', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  function setupCryptoplasmUpkeepCopyGame(gameId: string) {
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'cryptoplasm_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'cryptoplasm_card',
          name: 'Cryptoplasm',
          type_line: 'Creature — Shapeshifter',
          oracle_text:
            'At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.',
          power: '3',
          toughness: '3',
        },
        power: 3,
        toughness: 3,
        basePower: 3,
        baseToughness: 3,
      },
      {
        id: 'bear_1',
        controller: p2,
        owner: p2,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
        power: 2,
        toughness: 2,
        basePower: 2,
        baseToughness: 2,
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    return { game, p1, p2 };
  }

  const upkeepCopyText =
    'you may have this creature become a copy of another target creature, except it has this ability';
  it('parses the optional self-become-copy fragment as copy_permanent', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'you may have this creature become a copy of another target creature, except it has this ability',
    );
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'copy_permanent',
        retainAbilityText: 'it has this ability',
      }),
    ]);
  });

  it('queues target selection when the upkeep copy effect resolves', () => {
    const gameId = 'cryptoplasm_upkeep_copy';
    const { game, p1 } = setupCryptoplasmUpkeepCopyGame(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Cryptoplasm',
      upkeepCopyText,
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'cryptoplasm_1',
        permanentId: 'cryptoplasm_1',
        id: 'cryptoplasm_trigger',
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const targetStep = steps.find(step => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();
    expect((targetStep as any)?.action).toBe('self_become_copy_of_creature');
    expect((targetStep as any)?.mandatory).toBe(false);
    expect((targetStep as any)?.minTargets).toBe(0);
    expect((targetStep as any)?.validTargets).toEqual([
      expect.objectContaining({ id: 'bear_1', label: 'Grizzly Bears' }),
    ]);
    expect((targetStep as any)?.retainedAbilityText).toBe('it has this ability');
  });

  it('queues target selection under ORACLE_IR_TRIGGER_PRIMARY', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'cryptoplasm_upkeep_copy_primary';
    const { game, p1 } = setupCryptoplasmUpkeepCopyGame(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Cryptoplasm',
      upkeepCopyText,
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'cryptoplasm_1',
        permanentId: 'cryptoplasm_1',
        id: 'cryptoplasm_trigger',
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const targetStep = steps.find(step => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();
    expect((targetStep as any)?.action).toBe('self_become_copy_of_creature');
    expect((targetStep as any)?.mandatory).toBe(false);
  });

  it('applies the copy and retains Cryptoplasm upkeep ability text', () => {
    const state: any = {
      battlefield: [
        {
          id: 'cryptoplasm_1',
          controller: 'p1',
          card: {
            id: 'cryptoplasm_card',
            name: 'Cryptoplasm',
            type_line: 'Creature — Shapeshifter',
            oracle_text:
              'At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.',
            power: '3',
            toughness: '3',
          },
          power: 3,
          toughness: 3,
          basePower: 3,
          baseToughness: 3,
        },
        {
          id: 'bear_1',
          controller: 'p2',
          card: {
            id: 'bear_card',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
        },
      ],
    };

    const result = applyPermanentBecomeCopyOfTargetPermanent(
      state,
      'cryptoplasm_1',
      'bear_1',
      'it has this ability',
    );

    expect(result.applied).toBe(true);
    expect(result.targetName).toBe('Grizzly Bears');

    const cryptoplasm = state.battlefield.find((perm: any) => perm.id === 'cryptoplasm_1');
    expect(cryptoplasm.name).toBe('Grizzly Bears');
    expect(cryptoplasm.power).toBe(2);
    expect(cryptoplasm.toughness).toBe(2);
    expect(String(cryptoplasm.card?.oracle_text || '')).toContain(
      'At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.',
    );
    expect(cryptoplasm.grantedAbilities).toEqual([
      'At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.',
    ]);
  });
});
