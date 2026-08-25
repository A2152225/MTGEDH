// Origin parent: rules-engine/src/effectProgram.ts
// Cluster moved: buildEffectProgramFromOracleIR, appendOracleStepToEffectProgram, and
// exclusive oracle-step choice helpers (choose-mode targets, choice-request builders,
// supported-choice guards, clash append, color/mode mappers).
// Public entry symbols: buildEffectProgramFromOracleIR.
// Leaf must not import effectProgram.ts or effectProgram-handlers/index.ts.

import type { OracleClauseCondition, OracleEffectStep } from '../oracleIR';
import { ChoiceEventType, type ChoiceOption } from '../choiceEventsTypes';
import { isPerPlayerOptionalOracleStep } from '../oracleIRPerPlayerOptional';
import { sacrificeSelectorRequiresPlayerChoice } from '../oracleIRExecutorBattlefieldStepHandlers';
import { discardSelectorRequiresPlayerChoice } from '../oracleIRExecutorPlayerStepHandlers';
import type {
  BuildEffectProgramFromOracleIRInput,
  EffectProgram,
  EffectProgramChoiceRequest,
  EffectProgramClauseRef,
  EffectProgramStep,
  EffectProgramStepGuard,
} from './effectProgramTypes.js';
import {
  BASIC_LAND_TYPE_OPTIONS,
  ORACLE_CHOICE_STEP_KINDS,
} from './effectProgramTypes.js';

export function buildEffectProgramFromOracleIR(input: BuildEffectProgramFromOracleIRInput): EffectProgram {
  const steps: EffectProgramStep[] = [];
  const interveningIfCondition = normalizeInterveningIfCondition(input.interveningIf);
  const oracleSteps = unwrapMatchingLeadingConditional(input.steps, interveningIfCondition);

  if (interveningIfCondition) {
    steps.push({
      id: `${input.id}:intervening-if`,
      kind: 'condition',
      clause: {
        abilityIndex: input.abilityIndex,
        raw: interveningIfCondition.raw,
      },
      raw: interveningIfCondition.raw,
      condition: interveningIfCondition,
      interveningIf: true,
      onFalse: { action: 'halt' },
      onUnknown: 'block',
    });
  }

  oracleSteps.forEach((oracleStep, clauseIndex) => {
    const baseId = `${input.id}:clause-${clauseIndex}`;
    const nextStep = oracleSteps[clauseIndex + 1];
    const skipTargetStepId = nextStep
      ? getFirstLoweredOracleStepId(`${input.id}:clause-${clauseIndex + 1}`, nextStep, steps)
      : undefined;

    appendOracleStepToEffectProgram({
      input,
      steps,
      oracleStep,
      clauseIndex,
      baseId,
      skipTargetStepId,
    });
  });

  return {
    id: input.id,
    controllerId: input.controllerId,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    steps,
    metadata: input.metadata,
  };
}

function appendOracleStepToEffectProgram(args: {
  readonly input: BuildEffectProgramFromOracleIRInput;
  readonly steps: EffectProgramStep[];
  readonly oracleStep: OracleEffectStep;
  readonly clauseIndex: number;
  readonly baseId: string;
  readonly skipTargetStepId?: string;
}): void {
  const { input, steps, oracleStep, clauseIndex, baseId } = args;
  const kind = String((oracleStep as any)?.kind || '');

  if ((oracleStep as any)?.kind === 'conditional' && Array.isArray((oracleStep as any).steps)) {
    const condition = normalizeInterveningIfCondition((oracleStep as any).condition);
    const afterConditionalStepId = args.skipTargetStepId || `${baseId}:after-conditional`;
    const innerSteps = (oracleStep as any).steps as readonly OracleEffectStep[];

    if (condition) {
      steps.push({
        id: `${baseId}:condition`,
        kind: 'condition',
        clause: {
          abilityIndex: input.abilityIndex,
          clauseIndex,
          raw: oracleStep.raw,
        },
        raw: oracleStep.raw,
        condition,
        onFalse: { action: 'skip_to_step', stepId: afterConditionalStepId },
        onUnknown: 'block',
      });
    }

    innerSteps.forEach((innerStep, innerIndex) => {
      const nextInnerStep = innerSteps[innerIndex + 1];
      const innerBaseId = `${baseId}:then-${innerIndex}`;
      appendOracleStepToEffectProgram({
        input,
        steps,
        oracleStep: innerStep,
        clauseIndex,
        baseId: innerBaseId,
        skipTargetStepId: nextInnerStep
          ? getFirstLoweredOracleStepId(`${baseId}:then-${innerIndex + 1}`, nextInnerStep, steps)
          : afterConditionalStepId,
      });
    });

    if (!args.skipTargetStepId) {
      steps.push({
        id: afterConditionalStepId,
        kind: 'note',
        clause: {
          abilityIndex: input.abilityIndex,
          clauseIndex,
          raw: oracleStep.raw,
        },
        raw: oracleStep.raw,
        message: 'conditional complete',
      });
    }

    return;
  }

    const clause: EffectProgramClauseRef = {
      abilityIndex: input.abilityIndex,
      clauseIndex,
      raw: oracleStep.raw,
    };

    let guard: EffectProgramStepGuard | undefined;
    if (oracleStepOptionalRequiresChoice(oracleStep)) {
      const bindingKey = `${baseId}:may`;
      steps.push({
        id: `${baseId}:may-choice`,
        kind: 'choice',
        bindingKey,
        clause,
        raw: oracleStep.raw,
        choiceRequest: {
          type: ChoiceEventType.OPTION_CHOICE,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: ${oracleStep.raw || 'Use this optional effect?'}`,
          mandatory: false,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
            minSelections: 1,
            maxSelections: 1,
          },
        },
      });
      guard = { bindingKey, selectionIncludes: 'yes', onFalse: 'skip' };
    }

    if (appendChooseModePerModePlayerTargetSteps({
      input,
      steps,
      oracleStep,
      clause,
      baseId,
      guard,
    })) {
      return;
    }

    if (isSupportedFatesealChoiceStep(oracleStep)) {
      const opponentBindingKey = `${baseId}:opponent-choice`;
      const fatesealBindingKey = `${baseId}:choice`;
      steps.push({
        id: `${baseId}:opponent-choice`,
        kind: 'choice',
        bindingKey: opponentBindingKey,
        clause,
        raw: oracleStep.raw,
        guard,
        choiceRequest: {
          type: ChoiceEventType.PLAYER_CHOICE,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: Choose an opponent for ${oracleStep.raw || 'fateseal'}`,
          mandatory: true,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            oracleStepKind: 'fateseal_target',
            oracleStep,
          },
        },
      });
      steps.push({
        id: `${baseId}:choice`,
        kind: 'choice',
        bindingKey: fatesealBindingKey,
        clause,
        raw: oracleStep.raw,
        guard: { bindingKey: opponentBindingKey, cancelledEquals: false, onFalse: 'skip' },
        choiceRequest: {
          type: ChoiceEventType.FATESEAL,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: ${oracleStep.raw || 'Fateseal'}`,
          mandatory: true,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            oracleStepKind: 'fateseal',
            oracleStep,
            targetBindingKey: opponentBindingKey,
            fatesealCount: quantityToStaticNumber((oracleStep as any).amount) ?? 0,
          },
        },
      });
      steps.push({
        id: `${baseId}:command`,
        kind: 'command',
        clause,
        raw: oracleStep.raw,
        guard: { bindingKey: fatesealBindingKey, cancelledEquals: false, onFalse: 'skip' },
        command: { kind: 'oracle_ir_step', step: oracleStep },
      });
      return;
    }

    if (isSupportedClashChoiceStep(oracleStep)) {
      appendSupportedClashChoiceSteps({
        input,
        steps,
        oracleStep,
        clause,
        baseId,
        guard,
      });
      return;
    }

    if (oracleStepNeedsChoice(oracleStep, steps)) {
      const bindingKey = `${baseId}:choice`;
      steps.push({
        id: `${baseId}:choice`,
        kind: 'choice',
        bindingKey,
        clause,
        raw: oracleStep.raw,
        guard,
        choiceRequest: buildChoiceRequestForOracleStep(input, oracleStep),
      });

      if (oracleChoiceStepNeedsCommandContinuation(oracleStep)) {
        const commandGuard = kind === 'pay_mana'
          ? { bindingKey, selectionIncludes: 'yes' as const, onFalse: 'skip' as const }
          : { bindingKey, cancelledEquals: false, onFalse: 'skip' as const };
        steps.push({
          id: `${baseId}:command`,
          kind: 'command',
          clause,
          raw: oracleStep.raw,
          guard: commandGuard,
          command: { kind: 'oracle_ir_step', step: oracleStep },
        });
      }
      return;
    }

    steps.push({
      id: `${baseId}:command`,
      kind: 'command',
      clause,
      raw: oracleStep.raw,
      guard,
      command: { kind: 'oracle_ir_step', step: oracleStep },
    });
}

  function getFirstLoweredOracleStepId(
    baseId: string,
    oracleStep: OracleEffectStep,
    priorSteps: readonly EffectProgramStep[] = []
  ): string {
    if ((oracleStep as any)?.kind === 'conditional') {
      return `${baseId}:condition`;
    }

    if (oracleStepOptionalRequiresChoice(oracleStep)) {
      return `${baseId}:may-choice`;
    }

    if (isSupportedFatesealChoiceStep(oracleStep)) {
      return `${baseId}:opponent-choice`;
    }

    if (isSupportedClashChoiceStep(oracleStep)) {
      return (oracleStep as any).opponent ? `${baseId}:opponent-choice` : `${baseId}:choice`;
    }

    return oracleStepNeedsChoice(oracleStep, priorSteps) ? `${baseId}:choice` : `${baseId}:command`;
  }

  function oracleChoiceStepNeedsCommandContinuation(step: OracleEffectStep): boolean {
    const kind = String((step as any).kind || '');
    return kind === 'choose_mode'
      || kind === 'explore'
      || kind === 'proliferate'
      || kind === 'populate'
      || kind === 'scry'
      || kind === 'surveil'
    || kind === 'sacrifice'
    || kind === 'discard'
    || kind === 'unless_pays_mana'
    || kind === 'unless_pays_life'
    || kind === 'unless_discards'
    || kind === 'unless_sacrifices'
    || kind === 'pay_mana'
    || (kind === 'add_mana' && (step as any).requiresChosenMana === true);
  }

function oracleStepOptionalRequiresChoice(step: OracleEffectStep): boolean {
  if ((step as any).optional !== true) return false;

  if (isPerPlayerOptionalOracleStep(step)) return false;

  const kind = String((step as any).kind || '');
  // unless_pays/unless_discards/unless_sacrifices already queue their own pay-or-decline choice; a
  // preceding may-choice duplicates Rhystic Study-style "you may … unless … pays" as
  // two Always Yes prompts.
  if (kind === 'unless_pays_mana' || kind === 'unless_pays_life' || kind === 'unless_discards' || kind === 'unless_sacrifices') {
    return false;
  }

  return !(
    kind === 'grant_exile_permission' ||
    kind === 'grant_graveyard_permission' ||
    kind === 'grant_graveyard_keyword_ability' ||
    kind === 'modify_graveyard_permissions' ||
    kind === 'look_choose_from_top' ||
    kind === 'look_select_top' ||
    kind === 'tap_matching_permanents'
  );
}

function normalizeInterveningIfCondition(
  condition: string | OracleClauseCondition | undefined
): OracleClauseCondition | undefined {
  if (!condition) {
    return undefined;
  }

  if (typeof condition === 'string') {
    const raw = condition.trim();
    return raw ? { kind: 'if', raw } : undefined;
  }

  const raw = String(condition.raw || '').trim();
  return raw ? { ...condition, raw } : undefined;
}

function unwrapMatchingLeadingConditional(
  steps: readonly OracleEffectStep[],
  condition: OracleClauseCondition | undefined
): readonly OracleEffectStep[] {
  if (!condition || steps.length !== 1) {
    return steps;
  }

  const firstStep = steps[0] as any;
  if (firstStep?.kind !== 'conditional' || !Array.isArray(firstStep.steps)) {
    return steps;
  }

  const wrappedCondition = firstStep.condition as OracleClauseCondition | undefined;
  if (normalizeConditionText(wrappedCondition?.raw) !== normalizeConditionText(condition.raw)) {
    return steps;
  }

  return firstStep.steps as readonly OracleEffectStep[];
}

function normalizeConditionText(raw: string | undefined): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function modeStepsNeedTargetPlayer(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  return steps.some((inner) => {
    if (!inner) return false;
    if (String((inner as any).who?.kind || '') === 'target_player') return true;
    const targetText = String((inner as any).target?.text || (inner as any).what?.text || '');
    if (/\btarget player\b/i.test(targetText)) return true;
    return /\btarget player\b/i.test(String((inner as any).raw || ''));
  });
}

function isSelfReferentialObjectTargetText(text: string): boolean {
  return /^(?:it|this creature|this permanent|this card|~)$/i.test(String(text || '').trim());
}

function modeStepsNeedObjectTarget(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  return steps.some((inner) => {
    if (!inner) return false;
    const kind = String((inner as any).kind || '');
    if (kind === 'create_token') return false;
    if (kind === 'choose_target_creature') return true;
    if (String((inner as any).who?.kind || '') === 'target_player') return false;

    const targetText = String((inner as any).target?.text || (inner as any).what?.text || '').trim();
    if (targetText && isSelfReferentialObjectTargetText(targetText)) return false;
    if (/\btarget player\b/i.test(targetText) || /\btarget opponent\b/i.test(targetText)) return false;
    if (/\btarget\b/i.test(targetText) || /\bany target\b/i.test(targetText)) return true;

    if (
      kind === 'deal_damage'
      || kind === 'destroy'
      || kind === 'exile'
      || kind === 'bounce'
      || kind === 'fight'
    ) {
      const raw = String((inner as any).raw || '');
      if (/\btarget player\b|\btarget opponent\b/i.test(raw)) return false;
      if (/\bany target\b/i.test(raw)) return true;
      if (/\btarget (?:creature|permanent|artifact|enchantment|land|planeswalker|battle)\b/i.test(raw)) return true;
    }
    return false;
  });
}

function findModeObjectTargetSourceStep(
  steps: readonly OracleEffectStep[] | undefined,
): OracleEffectStep | undefined {
  if (!Array.isArray(steps)) return undefined;
  return steps.find((inner) => modeStepsNeedObjectTarget([inner]));
}

function chooseModeRequiresPerModeTargets(step: OracleEffectStep): boolean {
  if (String((step as any).kind || '') !== 'choose_mode') return false;
  const modes = Array.isArray((step as any).modes) ? (step as any).modes : [];
  if (modes.length === 0) return false;
  if (Boolean((step as any).distinctPlayerTargets)) return true;
  return modes.some((mode: { steps?: readonly OracleEffectStep[] }) => (
    modeStepsNeedTargetPlayer(mode?.steps) || modeStepsNeedObjectTarget(mode?.steps)
  ));
}

function appendChooseModePerModePlayerTargetSteps(args: {
  readonly input: BuildEffectProgramFromOracleIRInput;
  readonly steps: EffectProgramStep[];
  readonly oracleStep: OracleEffectStep;
  readonly clause: EffectProgramClauseRef;
  readonly baseId: string;
  readonly guard?: EffectProgramStepGuard;
}): boolean {
  const { input, steps, oracleStep, clause, baseId, guard } = args;
  if (!chooseModeRequiresPerModeTargets(oracleStep)) return false;

  const modes = Array.isArray((oracleStep as any).modes) ? (oracleStep as any).modes : [];
  const modeBindingKey = `${baseId}:choice`;
  const distinctPlayerTargets = Boolean((oracleStep as any).distinctPlayerTargets);

  steps.push({
    id: `${baseId}:choice`,
    kind: 'choice',
    bindingKey: modeBindingKey,
    clause,
    raw: oracleStep.raw,
    guard,
    choiceRequest: buildChoiceRequestForOracleStep(input, {
      ...oracleStep,
      optional: false,
    } as OracleEffectStep),
  });

  modes.forEach((mode: { label?: string; raw?: string; steps?: readonly OracleEffectStep[] }, modeIndex: number) => {
    const label = String(mode?.label || `Mode ${modeIndex + 1}`).trim();
    const modeRaw = String(mode?.raw || label).trim();
    const modeGuard: EffectProgramStepGuard = {
      bindingKey: modeBindingKey,
      selectionIncludes: label,
      cancelledEquals: false,
      onFalse: 'skip',
    };
    const innerSteps = Array.isArray(mode?.steps) ? mode.steps : [];
    let commandGuard = modeGuard;

    if (modeStepsNeedTargetPlayer(innerSteps) || distinctPlayerTargets) {
      const playerBindingKey = `${baseId}:mode-${modeIndex}:player`;
      steps.push({
        id: `${baseId}:mode-${modeIndex}:player`,
        kind: 'choice',
        bindingKey: playerBindingKey,
        clause,
        raw: modeRaw,
        guard: modeGuard,
        choiceRequest: {
          type: ChoiceEventType.PLAYER_CHOICE,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: Choose a player for ${modeRaw}`,
          mandatory: true,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            oracleStepKind: 'target_player',
            oracleStep: { kind: 'target_player', raw: modeRaw },
            distinctPlayerTargets,
            modeLabel: label,
          },
        },
      });
      commandGuard = {
        bindingKey: playerBindingKey,
        cancelledEquals: false,
        onFalse: 'skip',
      };
    }

    if (modeStepsNeedObjectTarget(innerSteps)) {
      const targetBindingKey = `${baseId}:mode-${modeIndex}:target`;
      const sourceStep = findModeObjectTargetSourceStep(innerSteps);
      const targetText = String(
        (sourceStep as any)?.target?.text
        || (sourceStep as any)?.what?.text
        || (sourceStep as any)?.raw
        || modeRaw,
      ).trim();
      steps.push({
        id: `${baseId}:mode-${modeIndex}:target`,
        kind: 'choice',
        bindingKey: targetBindingKey,
        clause,
        raw: modeRaw,
        guard: commandGuard,
        choiceRequest: {
          type: ChoiceEventType.TARGET_SELECTION,
          playerId: input.controllerId,
          description: `${input.sourceName || 'Ability'}: Choose ${targetText || 'a target'} for ${modeRaw}`,
          mandatory: true,
          sourceId: input.sourceId,
          sourceName: input.sourceName,
          sourceImage: input.sourceImage,
          payload: {
            oracleStepKind: 'choose_target_creature',
            oracleStep: {
              kind: 'choose_target_creature',
              target: (sourceStep as any)?.target || { kind: 'raw', text: targetText },
              raw: String((sourceStep as any)?.raw || targetText),
            },
            modeLabel: label,
          },
        },
      });
      commandGuard = {
        bindingKey: targetBindingKey,
        cancelledEquals: false,
        onFalse: 'skip',
      };
    }

    innerSteps.forEach((innerStep, innerIndex) => {
      steps.push({
        id: `${baseId}:mode-${modeIndex}:cmd-${innerIndex}`,
        kind: 'command',
        clause,
        raw: String((innerStep as any)?.raw || modeRaw),
        guard: commandGuard,
        command: { kind: 'oracle_ir_step', step: innerStep },
      });
    });
  });

  return true;
}

function oracleStepNeedsChoice(
  step: OracleEffectStep,
  priorSteps: readonly EffectProgramStep[] = []
): boolean {
  const kind = String((step as any).kind || '');
  if (kind === 'explore' && isSupportedExploreChoiceStep(step)) {
    return true;
  }

  if ((kind === 'scry' || kind === 'surveil') && isSupportedTopLibraryChoiceStep(step)) {
    return true;
  }

  if (step.kind === 'sacrifice' && sacrificeSelectorRequiresPlayerChoice(step)) {
    return true;
  }

  if (step.kind === 'discard' && discardSelectorRequiresPlayerChoice(step)) {
    return true;
  }

  if (kind === 'unless_pays_mana' || kind === 'unless_pays_life' || kind === 'unless_discards' || kind === 'unless_sacrifices') {
    return true;
  }

  if (kind === 'populate' && isSupportedPopulateChoiceStep(step)) {
    return true;
  }

  if (ORACLE_CHOICE_STEP_KINDS.has(kind) && kind !== 'explore' && kind !== 'scry' && kind !== 'surveil') {
    return true;
  }

  if (kind === 'add_mana' && Array.isArray((step as any).manaOptions) && (step as any).requiresChosenMana === true) {
    return !priorSteps.some(priorStep => (
      priorStep.kind === 'choice' &&
      String((priorStep.choiceRequest?.payload as any)?.oracleStepKind || '') === 'choose_color'
    ));
  }

  return false;
}

function buildChoiceRequestForOracleStep(
  input: BuildEffectProgramFromOracleIRInput,
  step: OracleEffectStep
): EffectProgramChoiceRequest {
  const kind = String((step as any).kind || '');
  const choiceType = mapOracleStepKindToChoiceType(kind);

  return {
    type: choiceType,
    playerId: input.controllerId,
    description: `${input.sourceName || 'Ability'}: ${(step as any).raw || kind}`,
    mandatory: (step as any).optional !== true,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    payload: buildChoiceRequestPayloadForOracleStep(kind, step),
  };
}

function buildChoiceRequestPayloadForOracleStep(
  kind: string,
  step: OracleEffectStep
): Readonly<Record<string, unknown>> {
  const basePayload = {
    oracleStepKind: kind,
    oracleStep: step,
  };

  if (kind === 'choose_mode') {
    const modes = Array.isArray((step as any).modes) ? (step as any).modes : [];
    const pBudgetRaw = Number((step as any).pBudget);
    const hasPBudget = Number.isFinite(pBudgetRaw) && pBudgetRaw > 0;
    const canRepeatModes = Boolean((step as any).canRepeatModes);
    return {
      ...basePayload,
      modes: modes.map((mode: any) => {
        const label = String(mode?.label || mode?.raw || '').trim();
        const pCostRaw = Number(mode?.pCost);
        return {
          id: label,
          label,
          description: String(mode?.raw || label),
          ...(Number.isFinite(pCostRaw) && pCostRaw > 0 ? { pCost: Math.floor(pCostRaw) } : {}),
        };
      }).filter((mode: ChoiceOption) => mode.id),
      minModes: Number((step as any).minModes ?? 1),
      maxModes: normalizeModeSelectionMaxModes((step as any).maxModes, modes.length),
      allowDuplicates: canRepeatModes,
      ...(hasPBudget
        ? { pBudget: Math.floor(pBudgetRaw), canRepeatModes }
        : (canRepeatModes ? { canRepeatModes } : {})),
    };
  }

  if (kind === 'choose_color' || kind === 'add_mana') {
    const colors = buildColorChoiceOptionsFromOracleStep(step);
    return {
      ...basePayload,
      ...(colors.length > 0 ? { colors } : {}),
      minColors: 1,
      maxColors: 1,
    };
  }

  if (kind === 'pay_mana') {
    const manaCost = String((step as any).mana || '').trim();
    return {
      ...basePayload,
      manaCost,
      options: [
        { id: 'yes', label: manaCost ? `Pay ${manaCost}` : 'Pay' },
        { id: 'no', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
    };
  }

  if (kind === 'choose_basic_land_type') {
    return {
      ...basePayload,
      options: BASIC_LAND_TYPE_OPTIONS.map((landType, idx) => ({
        id: `basic_land_${idx}`,
        label: landType,
        value: landType,
      })),
      minSelections: 1,
      maxSelections: 1,
    };
  }

  if (kind === 'scry') {
    return {
      ...basePayload,
      scryCount: quantityToStaticNumber((step as any).amount) ?? 0,
    };
  }

  if (kind === 'surveil') {
    return {
      ...basePayload,
      surveilCount: quantityToStaticNumber((step as any).amount) ?? 0,
    };
  }

  if (kind === 'sacrifice') {
    return {
      ...basePayload,
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: String((step as any).raw || 'Choose a permanent to sacrifice'),
    };
  }

  if (kind === 'discard') {
    if ((step as any).amount?.kind === 'any_number') {
      return {
        ...basePayload,
        anyNumberDiscard: true,
        minDiscardCount: 0,
        discardCount: 0,
        reason: 'effect',
      };
    }
    return {
      ...basePayload,
      discardCount: quantityToStaticNumber((step as any).amount) ?? 1,
      reason: 'effect',
    };
  }

  if (kind === 'unless_pays_mana') {
    return {
      ...basePayload,
      manaCost: String((step as any).mana || ''),
      payChoiceId: 'pay',
      declineChoiceId: 'decline',
    };
  }

  if (kind === 'unless_pays_life') {
    return {
      ...basePayload,
      lifeAmount: Number((step as any).amount || 0),
      payChoiceId: 'pay',
      declineChoiceId: 'decline',
    };
  }

  if (kind === 'unless_discards') {
    return {
      ...basePayload,
      discardAmount: Number((step as any).amount || 0),
      payChoiceId: 'discard',
      declineChoiceId: 'decline',
    };
  }

  if (kind === 'unless_sacrifices') {
    const whatText = String((step as any).what?.text || (step as any).what || 'a permanent').trim();
    return {
      ...basePayload,
      sacrificeFilter: whatText,
      payChoiceId: 'sacrifice',
      declineChoiceId: 'decline',
    };
  }

  if (kind === 'proliferate') {
    return {
      ...basePayload,
      proliferateId: `${kind}:${String((step as any).raw || '').trim()}`,
    };
  }

  if (kind === 'populate') {
    return {
      ...basePayload,
      targetTypes: ['creature token'],
      minTargets: 0,
      maxTargets: 1,
      targetDescription: String((step as any).raw || 'Choose a creature token to populate'),
    };
  }

  return basePayload;
}

function isSupportedTopLibraryChoiceStep(step: OracleEffectStep): boolean {
  const whoKind = String((step as any)?.who?.kind || '');
  const supportedWho =
    whoKind === 'you' ||
    whoKind === 'target_player' ||
    whoKind === 'target_opponent';
  return supportedWho && quantityToStaticNumber((step as any).amount) !== undefined;
}

function isSupportedExploreChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'explore') {
    return false;
  }

  const target = (step as any)?.target;
  if (!target || target.kind !== 'raw') {
    return false;
  }

  const text = String(target.text || '').trim().toLowerCase();
  return text === 'this creature' || text === 'this permanent' || text === 'it' || text === 'that creature';
}

function isSupportedFatesealChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'fateseal') {
    return false;
  }

  const whoKind = String((step as any)?.who?.kind || '');
  const targetKind = String((step as any)?.target?.kind || '');
  return whoKind === 'you' && targetKind === 'target_opponent' && quantityToStaticNumber((step as any).amount) !== undefined;
}

function isSupportedClashChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'clash') {
    return false;
  }

  const whoKind = String((step as any)?.who?.kind || '');
  const opponentKind = String((step as any)?.opponent?.kind || '');
  return whoKind === 'you' && (!opponentKind || opponentKind === 'target_opponent');
}

function isSupportedPopulateChoiceStep(step: OracleEffectStep): boolean {
  if (String((step as any)?.kind || '') !== 'populate') {
    return false;
  }

  const whoKind = String((step as any)?.who?.kind || '');
  return whoKind === 'you' && quantityToStaticNumber((step as any).amount) === 1;
}

function appendSupportedClashChoiceSteps(args: {
  readonly input: BuildEffectProgramFromOracleIRInput;
  readonly steps: EffectProgramStep[];
  readonly oracleStep: OracleEffectStep;
  readonly clause: EffectProgramClauseRef;
  readonly baseId: string;
  readonly guard?: EffectProgramStepGuard;
}): void {
  const { input, steps, oracleStep, clause, baseId, guard } = args;
  const hasOpponentChoice = Boolean((oracleStep as any).opponent);

  if (hasOpponentChoice) {
    const opponentBindingKey = `${baseId}:opponent-choice`;
    const controllerClashBindingKey = `${baseId}:choice`;
    const opponentClashBindingKey = `${baseId}:opponent-card-choice`;

    steps.push({
      id: `${baseId}:opponent-choice`,
      kind: 'choice',
      bindingKey: opponentBindingKey,
      clause,
      raw: oracleStep.raw,
      guard,
      choiceRequest: {
        type: ChoiceEventType.PLAYER_CHOICE,
        playerId: input.controllerId,
        description: `${input.sourceName || 'Ability'}: Choose an opponent to clash with`,
        mandatory: true,
        sourceId: input.sourceId,
        sourceName: input.sourceName,
        sourceImage: input.sourceImage,
        payload: {
          oracleStepKind: 'clash_target',
          oracleStep,
        },
      },
    });

    steps.push({
      id: `${baseId}:choice`,
      kind: 'choice',
      bindingKey: controllerClashBindingKey,
      clause,
      raw: oracleStep.raw,
      guard: { bindingKey: opponentBindingKey, cancelledEquals: false, onFalse: 'skip' },
      choiceRequest: buildClashChoiceRequest(input, oracleStep, 'controller', opponentBindingKey),
    });

    steps.push({
      id: `${baseId}:opponent-card-choice`,
      kind: 'choice',
      bindingKey: opponentClashBindingKey,
      clause,
      raw: oracleStep.raw,
      guard: { bindingKey: opponentBindingKey, cancelledEquals: false, onFalse: 'skip' },
      choiceRequest: buildClashChoiceRequest(input, oracleStep, 'opponent', opponentBindingKey),
    });

    steps.push({
      id: `${baseId}:command`,
      kind: 'command',
      clause,
      raw: oracleStep.raw,
      guard: { bindingKey: opponentClashBindingKey, cancelledEquals: false, onFalse: 'skip' },
      command: { kind: 'oracle_ir_step', step: oracleStep },
    });
    return;
  }

  const bindingKey = `${baseId}:choice`;
  steps.push({
    id: `${baseId}:choice`,
    kind: 'choice',
    bindingKey,
    clause,
    raw: oracleStep.raw,
    guard,
    choiceRequest: buildClashChoiceRequest(input, oracleStep, 'controller'),
  });
  steps.push({
    id: `${baseId}:command`,
    kind: 'command',
    clause,
    raw: oracleStep.raw,
    guard: { bindingKey, cancelledEquals: false, onFalse: 'skip' },
    command: { kind: 'oracle_ir_step', step: oracleStep },
  });
}

function buildClashChoiceRequest(
  input: BuildEffectProgramFromOracleIRInput,
  oracleStep: OracleEffectStep,
  clashRole: 'controller' | 'opponent',
  targetBindingKey?: string
): EffectProgramChoiceRequest {
  return {
    type: ChoiceEventType.CLASH,
    playerId: input.controllerId,
    description: `${input.sourceName || 'Ability'}: ${oracleStep.raw || 'Clash'}`,
    mandatory: true,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceImage: input.sourceImage,
    payload: {
      oracleStepKind: 'clash',
      oracleStep,
      clashRole,
      ...(targetBindingKey ? { targetBindingKey } : {}),
    },
  };
}

function quantityToStaticNumber(quantity: unknown): number | undefined {
  if ((quantity as any)?.kind === 'number' && Number.isFinite(Number((quantity as any).value))) {
    return Number((quantity as any).value);
  }

  return undefined;
}

function buildColorChoiceOptionsFromOracleStep(step: OracleEffectStep): readonly ChoiceOption[] {
  const options = Array.isArray((step as any).manaOptions)
    ? (step as any).manaOptions
    : Array.isArray((step as any).colors)
      ? (step as any).colors
      : [];

  return options
    .map((option: unknown) => normalizeColorChoiceOption(option))
    .filter((option): option is ChoiceOption => Boolean(option));
}

function normalizeColorChoiceOption(option: unknown): ChoiceOption | undefined {
  const raw = String(option || '').trim();
  const colorSymbol = normalizeColorSymbol(raw);
  if (!colorSymbol) {
    return undefined;
  }

  return {
    id: colorSymbol,
    label: colorSymbolToName(colorSymbol),
  };
}

function normalizeColorSymbol(raw: string): string | undefined {
  const trimmed = raw.trim();
  const symbolMatch = trimmed.match(/^\{?([WUBRG])\}?$/i);
  if (symbolMatch) {
    return symbolMatch[1]!.toUpperCase();
  }

  const nameToSymbol: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
  };
  return nameToSymbol[trimmed.toLowerCase()];
}

function colorSymbolToName(symbol: string): string {
  const names: Record<string, string> = {
    W: 'White',
    U: 'Blue',
    B: 'Black',
    R: 'Red',
    G: 'Green',
  };
  return names[symbol] || symbol;
}

function normalizeModeSelectionMaxModes(maxModes: unknown, modeCount: number): number {
  const numericMax = Number(maxModes);
  if (Number.isFinite(numericMax) && numericMax >= 0) {
    return numericMax;
  }

  return Math.max(1, modeCount);
}

function mapOracleStepKindToChoiceType(kind: string): ChoiceEventType {
  switch (kind) {
    case 'choose_color':
    case 'add_mana':
      return ChoiceEventType.COLOR_CHOICE;
    case 'choose_creature_type':
      return ChoiceEventType.CREATURE_TYPE_CHOICE;
    case 'choose_basic_land_type':
      return ChoiceEventType.BASIC_LAND_TYPE_CHOICE;
    case 'choose_card_name':
      return ChoiceEventType.CARD_NAME_CHOICE;
    case 'choose_mode':
      return ChoiceEventType.MODE_SELECTION;
    case 'explore':
      return ChoiceEventType.EXPLORE_DECISION;
    case 'proliferate':
      return ChoiceEventType.PROLIFERATE;
    case 'populate':
      return ChoiceEventType.TARGET_SELECTION;
    case 'clash':
      return ChoiceEventType.CLASH;
    case 'choose_opponent':
      return ChoiceEventType.PLAYER_CHOICE;
    case 'choose_target_creature':
      return ChoiceEventType.TARGET_SELECTION;
    case 'scry':
      return ChoiceEventType.SCRY;
    case 'surveil':
      return ChoiceEventType.SURVEIL;
    case 'sacrifice':
      return ChoiceEventType.TARGET_SELECTION;
    case 'discard':
      return ChoiceEventType.DISCARD_SELECTION;
    case 'unless_pays_mana':
    case 'unless_pays_life':
    case 'unless_discards':
    case 'unless_sacrifices':
      return ChoiceEventType.OPTION_CHOICE;
    case 'fateseal':
      return ChoiceEventType.FATESEAL;
    case 'vote':
      return ChoiceEventType.OPTION_CHOICE;
    case 'pay_mana':
      return ChoiceEventType.OPTION_CHOICE;
    default:
      return ChoiceEventType.OPTION_CHOICE;
  }
}

