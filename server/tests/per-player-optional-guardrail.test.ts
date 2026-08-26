import { describe, expect, it } from 'vitest';

import {
  isControllerOptionalTriggeredAbilityEffectText,
  isEachPlayerMayPutLandFromHandOracleStep,
  isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt,
  isPerPlayerOptionalEffectText,
  isPerPlayerOptionalOracleStep,
  isStartingWithYouEachPlayerMayPutFromHandOracleStep,
  isControllerMayPutLandFromHandOracleStep,
} from '../../rules-engine/src/oracleIRPerPlayerOptional.js';
import { isEachPlayerMayPutCountersOnCreatureTheyControlStep } from '../../rules-engine/src/oracleIRCounterPlacement.js';
import { isControllerOptionalTriggeredAbilityEffect } from '../src/state/modules/trigger-runtime-wiring.js';
import {
  scrubStalePerPlayerOptionalEffectProgramSteps,
} from '../src/state/modules/triggerCounterPlacementPromptUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('per-player optional guardrails', () => {
  const perPlayerEffects = [
    'each player may put two +1/+1 counters on a creature they control',
    'each player may put a land card from their hand onto the battlefield',
    'starting with you, each player may pay any amount of mana',
    'starting with you, each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield',
    'in turn order, each player may top the high bid',
    'you and that player may each put a permanent card from your hand onto the battlefield',
  ];

  const controllerOptionalEffects = [
    'you may draw a card',
    'you may sacrifice a creature',
    'whenever a creature dies, you may pay {1}. if you do, draw a card',
  ];

  it('classifies per-player optional effect text', () => {
    for (const effect of perPlayerEffects) {
      expect(isPerPlayerOptionalEffectText(effect)).toBe(true);
      expect(isControllerOptionalTriggeredAbilityEffectText(effect)).toBe(false);
      expect(isControllerOptionalTriggeredAbilityEffect(effect)).toBe(false);
    }
  });

  it('classifies controller-only optional effect text', () => {
    for (const effect of controllerOptionalEffects) {
      expect(isPerPlayerOptionalEffectText(effect)).toBe(false);
      expect(isControllerOptionalTriggeredAbilityEffectText(effect)).toBe(true);
      expect(isControllerOptionalTriggeredAbilityEffect(effect)).toBe(true);
    }
  });

  it('does not treat opponent-tax you-may-unless-pays as controller Yes/No', () => {
    const rhystic =
      'whenever an opponent casts a spell, you may draw a card unless that player pays {1}';
    expect(isPerPlayerOptionalEffectText(rhystic)).toBe(false);
    expect(isControllerOptionalTriggeredAbilityEffectText(rhystic)).toBe(false);
    expect(isControllerOptionalTriggeredAbilityEffect(rhystic)).toBe(false);
    expect(
      isControllerOptionalTriggeredAbilityEffect(
        'you may draw a card unless that player pays {1}',
      ),
    ).toBe(false);
  });

  it('detects per-player optional oracle steps', () => {
    expect(isPerPlayerOptionalOracleStep({
      kind: 'add_counter',
      optional: true,
      raw: 'each player may put two +1/+1 counters on a creature they control',
    } as any)).toBe(true);

    expect(isEachPlayerMayPutLandFromHandOracleStep({
      kind: 'move_zone',
      optional: true,
      raw: 'each player may put a land card from their hand onto the battlefield',
    } as any)).toBe(true);

    expect(isStartingWithYouEachPlayerMayPutFromHandOracleStep({
      kind: 'move_zone',
      optional: true,
      raw: 'starting with you, each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield',
    } as any)).toBe(true);

    expect(isEachPlayerMayPutCountersOnCreatureTheyControlStep({
      kind: 'add_counter',
      optional: true,
      raw: 'each player may put two +1/+1 counters on a creature they control',
    } as any)).toBe(true);
  });

  it('detects optional steps bridged to dedicated server resolution prompts', () => {
    expect(isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt({
      kind: 'move_zone',
      optional: true,
      raw: 'each player may put a land card from their hand onto the battlefield',
    } as any)).toBe(true);

    expect(isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt({
      kind: 'add_counter',
      optional: true,
      raw: 'each player may put two +1/+1 counters on a creature they control',
    } as any)).toBe(true);

    expect(isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt({
      kind: 'move_zone',
      optional: true,
      raw: 'you may put a land card from your hand onto the battlefield',
    } as any)).toBe(true);

    expect(isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt({
      kind: 'move_zone',
      optional: true,
      raw: 'you may destroy target creature',
    } as any)).toBe(false);

    expect(isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt({
      kind: 'may_cast_from_among',
      optional: true,
      raw: 'You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.',
    } as any)).toBe(true);

    expect(isControllerMayPutLandFromHandOracleStep({
      kind: 'move_zone',
      optional: true,
      raw: 'you may put a land card from your hand onto the battlefield',
    } as any)).toBe(true);
  });

  it('scrubs stale optional_triggered_ability yes/no steps for per-player effects', () => {
    const gameId = 'test_per_player_optional_scrub';
    ResolutionQueueManager.removeQueue(gameId);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      description: 'You may: each player may put a land card from their hand onto the battlefield',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramFamily: 'optional_triggered_ability',
      effectText: 'each player may put a land card from their hand onto the battlefield',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps.length).toBe(1);
    scrubStalePerPlayerOptionalEffectProgramSteps(gameId);
    expect(ResolutionQueueManager.getQueue(gameId).steps.length).toBe(0);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
