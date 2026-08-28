import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';

const HIVE_MIND_EFFECT =
  'each other player copies that spell. Each of those players may choose new targets for their copy.';

const AKROMAS_WILL_ORACLE =
  'Choose one. If you control a commander as you cast this spell, you may choose both instead.\n'
  + '• Creatures you control gain flying, vigilance, and double strike until end of turn.\n'
  + '• Creatures you control gain lifelink, indestructible, and protection from each color until end of turn.';

function creatureKeywords(perm: any): string[] {
  const granted = Array.isArray(perm?.grantedAbilities)
    ? perm.grantedAbilities.map((value: unknown) => String(value || '').toLowerCase())
    : [];
  const toRemove = Array.isArray(perm?.untilEndOfTurn?.grantedAbilitiesToRemove)
    ? perm.untilEndOfTurn.grantedAbilitiesToRemove.map((value: unknown) => String(value || '').toLowerCase())
    : [];
  return [...granted, ...toRemove];
}

function setupHiveMindAkromasWillGame(params: {
  readonly gameId: string;
  readonly selectedModes?: readonly string[];
}) {
  const game = createInitialGameState(params.gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

  const triggeringStackId = 'stack_akromas_will_1';
  (game.state as any).players = [
    { id: p1, name: 'P1', life: 40 },
    { id: p2, name: 'P2', life: 40 },
  ];
  (game.state as any).turnPlayer = p2;
  (game.state as any).activePlayer = p2;
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
    {
      id: 'p1_creature',
      controller: p1,
      card: { name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
    },
    {
      id: 'p2_creature',
      controller: p2,
      card: { name: 'Cat', type_line: 'Creature — Cat', power: 2, toughness: 2 },
    },
  ];
  (game.state as any).stack = [
    {
      id: triggeringStackId,
      type: 'spell',
      controller: p2,
      card: {
        id: 'akromas_will_card',
        name: "Akroma's Will",
        type_line: 'Instant',
        oracle_text: AKROMAS_WILL_ORACLE,
      },
      targets: [],
      ...(params.selectedModes && params.selectedModes.length > 0
        ? { selectedModes: [...params.selectedModes] }
        : {}),
    },
  ];

  (game as any).gameId = params.gameId;
  (game as any).io = { to: () => ({ emit: vi.fn() }) };
  (game as any).bumpSeq = vi.fn();
  ResolutionQueueManager.removeQueue(params.gameId);

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

  return { game, p1, p2, triggeringStackId };
}

describe("Oracle IR Hive Mind copies of Akroma's Will", () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('parses choose_mode with both keyword-grant modes', () => {
    const steps = collectSpellResolutionEffectSteps(AKROMAS_WILL_ORACLE, "Akroma's Will");
    const chooseMode = steps.find((step) => step.kind === 'choose_mode') as Extract<typeof steps[number], { kind: 'choose_mode' }> | undefined;
    expect(chooseMode).toBeTruthy();
    expect(chooseMode?.modes).toHaveLength(2);
  });

  it('queues mode selection for a copy that inherited no chosen modes', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'test_hive_mind_akromas_will_unresolved_modes';
    const { game, p1, triggeringStackId } = setupHiveMindAkromasWillGame({ gameId });

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(String(copies[0]?.controller || '')).toBe(p1);
    expect(Array.isArray((copies[0] as any)?.selectedModes) ? (copies[0] as any).selectedModes : []).toEqual([]);

    game.resolveTopOfStack();

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.effectProgramPrompt).toBe(true);
    expect(((modeStep as any)?.modes || []).length).toBeGreaterThanOrEqual(2);
  });

  it("applies the copy controller's chosen mode to their creatures", () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'test_hive_mind_akromas_will_copy_mode_choice';
    const { game, p1, triggeringStackId } = setupHiveMindAkromasWillGame({ gameId });

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);

    game.resolveTopOfStack();

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();

    const firstModeId = String((modeStep as any)?.modes?.[0]?.id || 'Mode 1');
    const completedStep = ResolutionQueueManager.completeStep(gameId, String(modeStep!.id), {
      stepId: String(modeStep!.id),
      playerId: p1,
      selections: [{ id: firstModeId, label: firstModeId }],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = resumeEffectProgramResolution({
      game: game as any,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: false,
    });
    expect(resumed.status).toBe('completed');

    const p1Creature = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'p1_creature');
    const p2Creature = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'p2_creature');
    const p1Keywords = creatureKeywords(p1Creature);
    expect(p1Keywords).toEqual(expect.arrayContaining(['flying', 'vigilance']));
    expect(creatureKeywords(p2Creature)).not.toEqual(expect.arrayContaining(['flying']));
  });

  it('does not inherit the original caster modes so the copy controller can choose', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'test_hive_mind_akromas_will_inherited_modes';
    const { game, p1, triggeringStackId } = setupHiveMindAkromasWillGame({
      gameId,
      selectedModes: ['mode_1'],
    });

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(Array.isArray((copies[0] as any)?.selectedModes) ? (copies[0] as any).selectedModes : []).toEqual([]);

    game.resolveTopOfStack();

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.effectProgramPrompt).toBe(true);
    expect(((modeStep as any)?.modes || []).length).toBeGreaterThanOrEqual(2);
  });
});
