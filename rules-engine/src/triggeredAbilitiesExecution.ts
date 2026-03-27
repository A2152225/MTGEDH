import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionOptions, OracleIRExecutionResult } from './oracleIRExecutor';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from './oracleIRExecutor';
import { getCopiedSpellReplaySteps } from './oracleIRExecutorCopySpellSupport';
import { parseOracleTextToIR } from './oracleIRParser';
import {
  buildEnrichedTriggerExecutionEventData,
  normalizeTriggerContextId,
} from './triggeredAbilitiesChoiceSupport';
import { evaluateTriggerCondition } from './triggeredAbilitiesConditionRouting';
import { resolveInterveningIfClause } from './triggeredAbilitiesInterveningIf';
import { checkTrigger } from './triggeredAbilitiesMatching';
import { createTriggerInstance, type TriggerInstance } from './triggeredAbilitiesQueue';
import {
  type TriggerEventData,
  buildOracleIRExecutionEventHintFromTriggerData,
  buildResolutionEventDataFromGameState,
} from './triggeredAbilitiesEventData';
import { type TriggerEvent, type TriggeredAbility } from './triggeredAbilitiesTypes';

function collectOptionalStepKinds(steps: readonly any[]): string[] {
  const kinds: string[] = [];

  const visit = (step: any): void => {
    if (!step || typeof step !== 'object') return;
    if (step.optional) {
      kinds.push(String(step.kind || 'unknown'));
    }
    if (Array.isArray(step.steps)) {
      for (const nested of step.steps) visit(nested);
    }
    if (Array.isArray(step.modes)) {
      for (const mode of step.modes) {
        for (const nested of Array.isArray(mode?.steps) ? mode.steps : []) visit(nested);
      }
    }
  };

  for (const step of steps) visit(step);
  return kinds;
}

export interface ProcessEventOracleExecutionResult {
  readonly state: GameState;
  readonly triggers: readonly TriggerInstance[];
  readonly executions: readonly OracleIRExecutionResult[];
  readonly log: readonly string[];
}

export interface ProcessEventOracleExecutionOptions extends OracleIRExecutionOptions {
  readonly resolutionEventData?: TriggerEventData;
}

export function executeTriggeredAbilityEffectWithOracleIR(
  state: GameState,
  ability: Pick<TriggeredAbility, 'controllerId' | 'sourceId' | 'sourceName' | 'effect'>,
  eventData?: TriggerEventData,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  const normalizedEffect = String(ability.effect || '').replace(/\u2019/g, "'").trim();
  const unlessPaysManaMatch = normalizedEffect.match(
    /^that player may pay (\{[^}]+\})\.\s*if they do(?:n't| not),\s*(.+)$/i
  );
  const explicitUnlessPaysChoice = eventData?.unlessPaysLifeChoice;

  if (unlessPaysManaMatch && (explicitUnlessPaysChoice === 'pay' || explicitUnlessPaysChoice === 'decline')) {
    const [, manaCost, followUpEffect] = unlessPaysManaMatch;

    if (explicitUnlessPaysChoice === 'pay') {
      return {
        state,
        log: [`Resolved unless-pays-mana step (payer chose to pay ${manaCost}): ${ability.effect}`],
        appliedSteps: [],
        skippedSteps: [],
        automationGaps: [],
        pendingOptionalSteps: [],
      };
    }

    const declinedResult = executeTriggeredAbilityEffectWithOracleIR(
      state,
      {
        ...ability,
        effect: followUpEffect,
      },
      eventData,
      options
    );

    return {
      ...declinedResult,
      log: [
        `Resolved unless-pays-mana step (payer declined to pay ${manaCost}): ${ability.effect}`,
        ...declinedResult.log,
      ],
    };
  }

  const tokenChoiceMatch = normalizedEffect.match(/^create a ([a-z0-9'+ -]+) token or a ([a-z0-9'+ -]+) token\.?$/i);
  const selectedModeIds = Array.isArray(eventData?.selectedModeIds) ? eventData.selectedModeIds : [];

  if (tokenChoiceMatch && selectedModeIds.length > 0) {
    const [, firstTokenName, secondTokenName] = tokenChoiceMatch;
    const normalizedSelections = selectedModeIds.map(id => String(id || '').trim().toLowerCase()).filter(Boolean);
    const chooseToken = (tokenName: string): boolean => {
      const normalizedTokenName = String(tokenName || '').trim().toLowerCase();
      return normalizedSelections.some(
        selection =>
          selection === normalizedTokenName ||
          selection === `${normalizedTokenName} token` ||
          selection.includes(normalizedTokenName)
      );
    };

    const chosenTokenName = chooseToken(secondTokenName)
      ? secondTokenName
      : chooseToken(firstTokenName)
        ? firstTokenName
        : undefined;

    if (chosenTokenName) {
      return executeTriggeredAbilityEffectWithOracleIR(
        state,
        {
          ...ability,
          effect: `Create a ${chosenTokenName} token.`,
        },
        eventData,
        options
      );
    }
  }

  const ir = parseOracleTextToIR(ability.effect, ability.sourceName);
  const steps = ir.abilities.flatMap(a => a.steps);
  const normalizedEventData = buildEnrichedTriggerExecutionEventData(state, ability, eventData, {
    inferTapOrUntapChoice: true,
  });

  const canAutoAllowOptional =
    Boolean(normalizedEventData?.targetPermanentId && normalizedEventData?.tapOrUntapChoice) &&
    steps.some(step => step.kind === 'tap_or_untap' && Boolean((step as any).optional)) &&
    steps.every(step => !Boolean((step as any).optional) || step.kind === 'tap_or_untap');

  const optionalKinds = collectOptionalStepKinds(steps);
  const canAutoAllowCopySpell =
    optionalKinds.length > 0 &&
    optionalKinds.every(kind => kind === 'copy_spell');

  const executionOptions =
    (canAutoAllowOptional || canAutoAllowCopySpell) && !options.allowOptional
      ? { ...options, allowOptional: true }
      : options;

  const hint = buildOracleIRExecutionEventHintFromTriggerData(normalizedEventData);
  const replayStackItem = ((state.stack || []) as any[]).find(
    item => String((item as any)?.id || '').trim() === String(ability.sourceId || '').trim()
  ) as any;
  const replaySteps =
    steps.some(step => step.kind === 'copy_spell' && step.subject === 'this_spell') && replayStackItem?.card
      ? getCopiedSpellReplaySteps(replayStackItem.card)
      : undefined;
  const ctx = buildOracleIRExecutionContext(
    {
      controllerId: (normalizeTriggerContextId(ability.controllerId) ?? ability.controllerId) as PlayerID,
      sourceId: ability.sourceId,
      sourceName: ability.sourceName,
    },
    hint
  );

  if (Array.isArray(replaySteps) && replaySteps.length > 0) {
    (ctx as any).copyReplaySteps = replaySteps;
  }

  return applyOracleIRStepsToGameState(state, steps, ctx, {
    ...executionOptions,
    selectedModeIds: normalizedEventData?.selectedModeIds,
  });
}

export function processEventAndExecuteTriggeredOracle(
  state: GameState,
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: TriggerEventData,
  options: ProcessEventOracleExecutionOptions = {}
): ProcessEventOracleExecutionResult {
  const triggeredAbilities = abilities.flatMap(ability => {
    const matchingEventData = buildEnrichedTriggerExecutionEventData(state, ability, eventData, {
      inferTapOrUntapChoice: false,
    });
    return checkTrigger(ability, event, matchingEventData) ? [{ ability, executionEventData: matchingEventData }] : [];
  });
  const timestamp = Date.now();

  const triggers: TriggerInstance[] = [];
  const executions: OracleIRExecutionResult[] = [];
  const log: string[] = [];

  let nextState = state;

  for (let idx = 0; idx < triggeredAbilities.length; idx++) {
    const { ability, executionEventData } = triggeredAbilities[idx];
    const trigger = createTriggerInstance(ability, timestamp + idx, executionEventData);
    triggers.push(trigger);

    const resolvedInterveningIfClause = resolveInterveningIfClause(ability);

    if (ability.hasInterveningIf && !resolvedInterveningIfClause) {
      log.push(`${ability.sourceName} trigger skipped at resolution (intervening-if missing clause)`);
      continue;
    }

    if (resolvedInterveningIfClause) {
      const resolutionData =
        options.resolutionEventData ??
        buildResolutionEventDataFromGameState(nextState, ability.controllerId, executionEventData);
      const stillTrue = evaluateTriggerCondition(
        resolvedInterveningIfClause,
        ability.controllerId,
        resolutionData,
        ability.sourceId
      );
      if (!stillTrue) {
        log.push(`${ability.sourceName} trigger skipped at resolution (intervening-if false)`);
        continue;
      }
    }

    const execution = executeTriggeredAbilityEffectWithOracleIR(nextState, ability, executionEventData, options);
    executions.push(execution);
    nextState = execution.state;

    log.push(`${ability.sourceName} triggered ability processed`);
    log.push(...execution.log);
  }

  return {
    state: nextState,
    triggers,
    executions,
    log,
  };
}
