// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: createOracleIRContextWithEffectProgramBindings,
// createOracleIROptionsWithEffectProgramBindings, findSelectedModeIdsForCommand,
// readSelectedModeIdsForBinding, deriveOracleIRContextFromEffectProgramBindings.
// Public entry symbols: createOracleIRContextWithEffectProgramBindings,
// createOracleIROptionsWithEffectProgramBindings, findSelectedModeIdsForCommand,
// readSelectedModeIdsForBinding, deriveOracleIRContextFromEffectProgramBindings.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import { ChoiceEventType, type ChoiceResponse } from '../choiceEventsTypes';
import type { EffectProgramCommandStep, EffectProgramRuntime } from '../effectProgram';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from '../oracleIRExecutionTypes';
import {
  LAST_MOVED_CARDS_BINDING,
  LAST_REVEALED_CARD_COUNT_BINDING,
  type DerivedOracleIRContextBindings,
} from './effectProgramOracleRunnerBindingKeys';
import {
  classifyChoiceTarget,
  normalizeChosenManaSelection,
} from './effectProgramOracleRunnerChoiceClassify';
import { normalizeChoiceResponseSelections } from './effectProgramOracleRunnerChoiceNormalize';

export function createOracleIRContextWithEffectProgramBindings(
  ctx: OracleIRExecutionContext,
  runtime: EffectProgramRuntime<GameState>
): OracleIRExecutionContext {
  const derived = deriveOracleIRContextFromEffectProgramBindings(runtime);
  const boundLastMovedCards = runtime.bindings[LAST_MOVED_CARDS_BINDING];
  const boundLastRevealedCardCount = runtime.bindings[LAST_REVEALED_CARD_COUNT_BINDING];
  const lastMovedCards = Array.isArray(boundLastMovedCards)
    ? boundLastMovedCards
    : Array.isArray(ctx.lastMovedCards)
      ? ctx.lastMovedCards
      : undefined;
  const lastRevealedCardCount = typeof boundLastRevealedCardCount === 'number'
    ? Math.max(0, Number(boundLastRevealedCardCount) || 0)
    : ctx.lastRevealedCardCount;

  if (!derived && !lastMovedCards && lastRevealedCardCount === ctx.lastRevealedCardCount) {
    return ctx;
  }

  if (!derived) {
    return {
      ...ctx,
      ...(lastMovedCards ? { lastMovedCards } : {}),
      ...(typeof lastRevealedCardCount === 'number' ? { lastRevealedCardCount } : {}),
    };
  }

  return {
    ...ctx,
    targetCreatureId: derived.targetCreatureId || ctx.targetCreatureId,
    targetPermanentId: derived.targetPermanentId || ctx.targetPermanentId,
    targetSpellId: derived.targetSpellId || ctx.targetSpellId,
    lastClashWon: typeof derived.lastClashWon === 'boolean' ? derived.lastClashWon : ctx.lastClashWon,
    ...(lastMovedCards ? { lastMovedCards } : {}),
    ...(typeof lastRevealedCardCount === 'number' ? { lastRevealedCardCount } : {}),
    ...(derived.selectorContext?.unlessPaysManaChoice === 'pay' || derived.selectorContext?.unlessPaysManaChoice === 'decline'
      ? { unlessPaysManaChoice: derived.selectorContext.unlessPaysManaChoice }
      : {}),
    ...(derived.selectorContext?.unlessPaysLifeChoice === 'pay' || derived.selectorContext?.unlessPaysLifeChoice === 'decline'
      ? { unlessPaysLifeChoice: derived.selectorContext.unlessPaysLifeChoice }
      : {}),
    ...(derived.selectorContext?.unlessDiscardsChoice === 'discard' || derived.selectorContext?.unlessDiscardsChoice === 'decline'
      ? { unlessDiscardsChoice: derived.selectorContext.unlessDiscardsChoice }
      : {}),
    ...(derived.selectorContext?.unlessSacrificesChoice === 'sacrifice' || derived.selectorContext?.unlessSacrificesChoice === 'decline'
      ? { unlessSacrificesChoice: derived.selectorContext.unlessSacrificesChoice }
      : {}),
    selectorContext: {
      ...(ctx.selectorContext || {}),
      ...(derived.selectorContext || {}),
    },
  };
}

export function createOracleIROptionsWithEffectProgramBindings(
  options: OracleIRExecutionOptions,
  runtime: EffectProgramRuntime<GameState>,
  commandStep?: EffectProgramCommandStep
): OracleIRExecutionOptions {
  const selectedModeIds = findSelectedModeIdsForCommand(runtime, commandStep);
  const oracleStep = commandStep?.command?.kind === 'oracle_ir_step'
    ? commandStep.command.step
    : undefined;
  const guardedOptionalAccepted =
    commandStep?.guard?.selectionIncludes === 'yes'
    || Boolean((oracleStep as any)?.optional);
  const mergedOptions: OracleIRExecutionOptions = {
    ...options,
    ...(guardedOptionalAccepted ? { allowOptional: true } : {}),
    ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
  };

  return mergedOptions;
}

export function findSelectedModeIdsForCommand(
  runtime: EffectProgramRuntime<GameState>,
  commandStep?: EffectProgramCommandStep
): readonly string[] {
  const preferredBindingKey = commandStep?.guard?.bindingKey;
  if (preferredBindingKey) {
    const preferred = readSelectedModeIdsForBinding(runtime, preferredBindingKey);
    if (preferred.length > 0) {
      return preferred;
    }
  }

  const commandIndex = commandStep
    ? runtime.program.steps.findIndex(step => step.id === commandStep.id)
    : -1;
  if (commandIndex > 0) {
    for (let index = commandIndex - 1; index >= 0; index -= 1) {
      const step = runtime.program.steps[index];
      if (step?.kind !== 'choice') {
        continue;
      }

      const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
      if (choiceType !== ChoiceEventType.MODE_SELECTION) {
        continue;
      }

      const selectedModeIds = readSelectedModeIdsForBinding(runtime, step.bindingKey);
      if (selectedModeIds.length > 0) {
        return selectedModeIds;
      }
    }
  }

  for (const step of runtime.program.steps) {
    if (step.kind !== 'choice') {
      continue;
    }

    const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
    if (choiceType !== ChoiceEventType.MODE_SELECTION) {
      continue;
    }

    const response = runtime.bindings[step.bindingKey] as ChoiceResponse | undefined;
    if (!response || response.cancelled) {
      continue;
    }

    const selectedModeIds = readSelectedModeIdsForBinding(runtime, step.bindingKey);
    if (selectedModeIds.length > 0) {
      return selectedModeIds;
    }
  }

  return [];
}

export function readSelectedModeIdsForBinding(
  runtime: EffectProgramRuntime<GameState>,
  bindingKey: string
): readonly string[] {
  const step = runtime.program.steps.find(candidate => candidate.kind === 'choice' && candidate.bindingKey === bindingKey);
  if (step?.kind !== 'choice') {
    return [];
  }

  const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
  if (choiceType !== ChoiceEventType.MODE_SELECTION) {
    return [];
  }

  const response = runtime.bindings[bindingKey] as ChoiceResponse | undefined;
  if (!response || response.cancelled) {
    return [];
  }

  return normalizeChoiceResponseSelections(response);
}

export function deriveOracleIRContextFromEffectProgramBindings(
  runtime: EffectProgramRuntime<GameState>
): DerivedOracleIRContextBindings | undefined {
  const selectorContext: Record<string, unknown> = {};
  const derived: DerivedOracleIRContextBindings = {};

  for (const step of runtime.program.steps) {
    if (step.kind !== 'choice') {
      continue;
    }

    const response = runtime.bindings[step.bindingKey] as ChoiceResponse | undefined;
    if (!response || response.cancelled) {
      continue;
    }

    const selections = normalizeChoiceResponseSelections(response);
    const firstSelection = selections[0];
    if (!firstSelection) {
      continue;
    }

    const choiceType = String(step.choiceEvent?.type || step.choiceRequest?.type || '');
    if (choiceType === ChoiceEventType.TARGET_SELECTION) {
      selectorContext.chosenObjectIds = selections;
      const targetKind = classifyChoiceTarget(runtime.state, firstSelection, runtime.program.controllerId);
      if (targetKind === 'player') {
        selectorContext.targetPlayerId = firstSelection;
        if (firstSelection !== runtime.program.controllerId) {
          selectorContext.targetOpponentId = firstSelection;
        }
      } else if (targetKind === 'creature') {
        derived.targetCreatureId = firstSelection;
        derived.targetPermanentId = firstSelection;
      } else {
        derived.targetPermanentId = firstSelection;
      }
      continue;
    }

    if (choiceType === ChoiceEventType.DISCARD_SELECTION) {
      selectorContext.chosenObjectIds = selections;
      continue;
    }

    if (choiceType === ChoiceEventType.PLAYER_CHOICE) {
      selectorContext.targetPlayerId = firstSelection;
      if (firstSelection !== runtime.program.controllerId) {
        selectorContext.targetOpponentId = firstSelection;
      }
      continue;
    }

    if (choiceType === ChoiceEventType.COLOR_CHOICE) {
      selectorContext.chosenMana = normalizeChosenManaSelection(firstSelection);
      continue;
    }

    if (choiceType === ChoiceEventType.CREATURE_TYPE_CHOICE) {
      selectorContext.chosenCreatureType = firstSelection;
      continue;
    }

    if (choiceType === ChoiceEventType.BASIC_LAND_TYPE_CHOICE) {
      selectorContext.chosenBasicLandType = firstSelection;
      continue;
    }

    if (choiceType === ChoiceEventType.CARD_NAME_CHOICE) {
      selectorContext.chosenCardName = firstSelection;
      continue;
    }

    const oracleStepKind = String((step.choiceRequest?.payload as any)?.oracleStepKind || '');
    if (oracleStepKind === 'unless_pays_mana' || oracleStepKind === 'unless_pays_life') {
      const payChoice = firstSelection === 'pay';
      if (oracleStepKind === 'unless_pays_mana') {
        selectorContext.unlessPaysManaChoice = payChoice ? 'pay' : 'decline';
      } else {
        selectorContext.unlessPaysLifeChoice = payChoice ? 'pay' : 'decline';
      }
      continue;
    }

    if (oracleStepKind === 'unless_discards') {
      selectorContext.unlessDiscardsChoice = firstSelection === 'discard' ? 'discard' : 'decline';
      continue;
    }

    if (oracleStepKind === 'unless_sacrifices') {
      selectorContext.unlessSacrificesChoice = firstSelection === 'sacrifice' ? 'sacrifice' : 'decline';
      continue;
    }

    if (oracleStepKind === 'choose_target_creature') {
      selectorContext.chosenObjectIds = selections;
      derived.targetCreatureId = firstSelection;
      derived.targetPermanentId = firstSelection;
    }
  }

  for (const binding of Object.values(runtime.bindings)) {
    if (binding && typeof binding === 'object' && typeof (binding as any).lastClashWon === 'boolean') {
      derived.lastClashWon = (binding as any).lastClashWon;
    }
  }

  if (
    !derived.targetCreatureId &&
    !derived.targetPermanentId &&
    !derived.targetSpellId &&
    typeof derived.lastClashWon !== 'boolean' &&
    Object.keys(selectorContext).length === 0
  ) {
    return undefined;
  }

  return {
    ...derived,
    selectorContext,
  };
}
