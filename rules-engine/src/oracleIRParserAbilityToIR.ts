// Extracted from rules-engine/src/oracleIRParser.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParser.ts: parseAbilityToIRAbility. Nested choose-mode parsing
// receives parseOracleTextToIR as a parameter so this module does not import the parent.
//
// Public entry points:
//   parseAbilityToIRAbility

import type { OracleEffectStep, OracleIRAbility, OracleIRResult, OraclePlayerSelector } from './oracleIR';
import { buildAbilityClauses } from './oracleIRParserAbilityClauses';
import {
  tryParseChooseModeBlock as tryParseChooseModeBlockFromModule,
  tryParseChooseModeBlockWithPrelude as tryParseChooseModeBlockWithPreludeFromModule,
} from './oracleIRParserChooseMode';
import { parseEffectLevelImpulsePermissionClause as parseExileTopImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import {
  isSimpleSelfEntersTappedReplacementEffect,
  parseEffectClauseToStep,
  tryParseVillainousChoiceStep,
} from './oracleIRParserEffectClauseToStep';
import { tryParseExileTopOnly as tryParseExileTopOnlyFromModule } from './oracleIRParserExileTopOnly';
import { tryParseExileTopOnlyLegacy as tryParseExileTopOnlyLegacyFromModule } from './oracleIRParserExileTopOnlyLegacy';
import {
  cleanImpulseClause as cleanImpulseClauseFromModule,
  isIgnorableImpulseReminderClause as isIgnorableImpulseReminderClauseFromModule,
} from './oracleIRParserImpulseClauseUtils';
import { tryParseImpulseExileTop as tryParseImpulseExileTopFromModule } from './oracleIRParserImpulseExileTop';
import { handleImpulseOrExileTopClause } from './oracleIRParserImpulseFlow';
import { parseBareTriggerEffectFragmentSteps } from './oracleIRParserPostprocess';
import {
  abilityEffectText,
  tryParseLeadingConditionalStep,
  tryParseTrailingConditionalStep,
} from './oracleIRParserSacrificeHelpers';
import { tryParseTemporaryGrantedDiesTriggerClause } from './oracleIRParserTemporaryTriggeredClauses';
import { tryParsePhase4ChoiceFamilyClause } from './oracleIRParserPhase4ChoiceFamilyClauses';
import { tryParseTemporaryEtbWindowClause } from './oracleIRParserTemporaryEtbWindowClauses';
import { tryParseCreateTokenFollowupModifier } from './oracleIRParserTokenFollowup';
import { tryParseMultiCreateTokensClause as tryParseMultiCreateTokensClauseFromModule } from './oracleIRParserTokenCreateClauses';
import {
  isThatOwnerOrControllerSelector,
  normalizeOracleText,
  parseObjectSelector,
  parseQuantity,
} from './oracleIRParserUtils';
import type { ParsedAbility } from './oracleTextParser';
import { AbilityType } from './oracleTextParser';

const AS_ENTERS_CHOOSE_STEP_KINDS = new Set([
  'choose_color',
  'choose_creature_type',
  'choose_basic_land_type',
  'choose_card_name',
  'choose_opponent',
]);

function stampAsEntersChooseRaw(
  ability: ParsedAbility,
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  const full = String(ability.text || '').replace(/\.+$/g, '').trim();
  if (!/^as\s+.+\s+enters/i.test(full)) return [...steps];
  return steps.map((step) => {
    if (!AS_ENTERS_CHOOSE_STEP_KINDS.has(String(step.kind || ''))) return step;
    if (/as\s+.+\s+enters/i.test(String((step as { raw?: string }).raw || ''))) return step;
    return { ...step, raw: full };
  });
}

export function parseAbilityToIRAbility(
  ability: ParsedAbility,
  cardName: string | undefined,
  parseOracleTextToIR: (oracleText: string, cardName?: string) => OracleIRResult
): OracleIRAbility {
  let effectText = abilityEffectText(ability);
  if (!effectText && /^you\s+may\s+look\s+at\s+the\s+top\s+/i.test(String(ability.text || '').trim())) {
    effectText = String(ability.text || '').trim();
  }
  if (ability.type === AbilityType.REPLACEMENT && isSimpleSelfEntersTappedReplacementEffect(effectText)) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [],
    };
  }
  const parseEffectTextToFlatSteps = (text: string): readonly OracleEffectStep[] => {
    const clauses = buildAbilityClauses({ effectText: text, cardName, parseEffectClauseToStep });
    return clauses.map(parseEffectClauseToStep);
  };

  // Check for a modal "Choose N \u2014 \u2022 Mode A \u2022 Mode B" block at the top of the effect.
  // When found, the entire effect is a single choose_mode step rather than
  // individual flat clauses (which would lose the bullet grouping).
  const chooseModeStep = tryParseChooseModeBlockFromModule(effectText, (modeEffectText) => {
    return parseOracleTextToIR(modeEffectText, cardName).abilities.flatMap(modeAbility => modeAbility.steps);
  });
  if (chooseModeStep !== null) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [chooseModeStep],
    };
  }

  const chooseModeStepsWithPrelude = tryParseChooseModeBlockWithPreludeFromModule(
    effectText,
    (modeEffectText) => parseOracleTextToIR(modeEffectText, cardName).abilities.flatMap(modeAbility => modeAbility.steps),
    parseEffectTextToFlatSteps,
  );
  if (chooseModeStepsWithPrelude !== null) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [...chooseModeStepsWithPrelude],
    };
  }

  const villainousChoiceStep = tryParseVillainousChoiceStep(effectText, cardName);
  if (villainousChoiceStep !== null) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [villainousChoiceStep],
    };
  }

  const eldraziManaReminderMatch = normalizeOracleText(effectText).match(
    /^((?:you may\s+)?create(?:s)?\s+.+?\btokens?)\.\s+(?:it has|they have)\s+"sacrifice this (?:token|creature): add \{c\}\."$/i,
  );
  if (eldraziManaReminderMatch) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [...parseEffectTextToFlatSteps(String(eldraziManaReminderMatch[1] || '').trim())],
    };
  }

  const fullTemporaryEtbWindowStep = tryParseTemporaryEtbWindowClause({
    clause: effectText,
    rawClause: effectText,
    withMeta: <T extends OracleEffectStep>(step: T): T => step,
  });
  if (fullTemporaryEtbWindowStep) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [fullTemporaryEtbWindowStep],
    };
  }

  const fullChoiceFamilyStep = tryParsePhase4ChoiceFamilyClause({
    clause: effectText,
    rawClause: effectText,
    withMeta: <T extends OracleEffectStep>(step: T): T => step,
  });
  if (fullChoiceFamilyStep) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [fullChoiceFamilyStep],
    };
  }

  const fullTemporaryDiesTriggerStep = tryParseTemporaryGrantedDiesTriggerClause({
    clause: effectText,
    rawClause: effectText,
    withMeta: <T extends OracleEffectStep>(step: T): T => step,
  });
  if (fullTemporaryDiesTriggerStep) {
    return {
      type: ability.type,
      text: ability.text,
      cost: ability.cost,
      triggerCondition: ability.triggerCondition,
      interveningIf: ability.interveningIf,
      effectText,
      steps: [fullTemporaryDiesTriggerStep],
    };
  }

  const clauses = buildAbilityClauses({ effectText, cardName, parseEffectClauseToStep });

  const steps: OracleEffectStep[] = [];

  const cleanImpulseClause = (s: string): string => cleanImpulseClauseFromModule(s);
  const isIgnorableImpulseReminderClause = (clause: string): boolean =>
    isIgnorableImpulseReminderClauseFromModule(clause);

  const tryParseImpulseExileTop = (idx: number): { step: OracleEffectStep; consumed: number } | null =>
    tryParseImpulseExileTopFromModule(clauses, idx);


  const tryParseExileTopOnlyLegacy = (idx: number): { step: OracleEffectStep; consumed: number } | null =>
    tryParseExileTopOnlyLegacyFromModule(clauses, idx);


  const tryParseExileTopOnly = (idx: number): { step: OracleEffectStep; consumed: number } | null =>
    tryParseExileTopOnlyFromModule({ clauses, idx }) ?? tryParseExileTopOnlyLegacy(idx);

  const tryParseLegacySubjectOrderImpulse = (idx: number): { step: OracleEffectStep; consumed: number } | null => {
    const firstClean = cleanImpulseClause(clauses[idx]);
    const secondClean = cleanImpulseClause(clauses[idx + 1]);
    const subjectOrderImpulse = firstClean.match(
      /^(its controller|its owner|that [a-z0-9][a-z0-9 -]*(?:'s|[’]s) (?:controller|owner)|that player|that opponent|defending player|the defending player|they|he or she)\s+may\s+exile\s+(that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+(their|his or her|your)\s+library(?:\s+face down)?\s*$/i
    );
    if (!subjectOrderImpulse || !secondClean) return null;

    const permissionInfo = parseExileTopImpulsePermissionClause(secondClean);
    if (!permissionInfo) return null;

    const rawSubject = String(subjectOrderImpulse[1] || '').trim().toLowerCase();
    let who: OraclePlayerSelector | null = null;
    if (rawSubject === 'that player' || rawSubject === 'they' || rawSubject === 'he or she') who = { kind: 'target_player' };
    else if (rawSubject === 'that opponent' || rawSubject === 'defending player' || rawSubject === 'the defending player') {
      who = { kind: 'target_opponent' };
    } else if (rawSubject === 'its controller' || rawSubject === 'its owner' || isThatOwnerOrControllerSelector(rawSubject)) {
      who = { kind: 'target_player' };
    }

    if (!who) return null;

    return {
      consumed: 2,
      step: {
        kind: 'impulse_exile_top',
        who,
        amount: parseQuantity(subjectOrderImpulse[2]),
        permission: permissionInfo.permission,
        duration: permissionInfo.duration,
        raw: `${clauses[idx]}. ${clauses[idx + 1]}`,
        ...(permissionInfo.condition ? { condition: permissionInfo.condition } : {}),
      },
    };
  };

  let lastCreateTokenStepIndexes: number[] | null = null;
  let pendingImpulseFromExileTop: { stepIndex: number; clauseIndex: number } | null = null;

  for (let i = 0; i < clauses.length; ) {
    // Follow-up modifiers like "It enters tapped." should apply to the immediately
    // previous create_token step(s), and should not produce standalone IR steps.
    if (lastCreateTokenStepIndexes && lastCreateTokenStepIndexes.length > 0) {
      const mod = tryParseCreateTokenFollowupModifier(clauses[i]);
      if (mod) {
        for (const idx of lastCreateTokenStepIndexes) {
          const prev: any = steps[idx];
          if (!prev || prev.kind !== 'create_token') continue;
          steps[idx] = {
            ...prev,
            ...(mod.entersTapped ? { entersTapped: true } : {}),
            ...(mod.attacking ? { attacking: mod.attacking } : {}),
            ...(mod.withCounters ? { withCounters: { ...(prev.withCounters || {}), ...mod.withCounters } } : {}),
            ...(mod.grantsHaste ? { grantsHaste: mod.grantsHaste } : {}),
            ...(mod.grantsAbilitiesUntilEndOfTurn
              ? {
                  grantsAbilitiesUntilEndOfTurn: Array.from(
                    new Set([...(prev.grantsAbilitiesUntilEndOfTurn || []), ...mod.grantsAbilitiesUntilEndOfTurn])
                  ),
                }
              : {}),
            ...(mod.grantsAbilitiesPermanent
              ? {
                  grantsAbilitiesPermanent: Array.from(
                    new Set([...(prev.grantsAbilitiesPermanent || []), ...mod.grantsAbilitiesPermanent])
                  ),
                }
              : {}),
            ...(mod.atNextEndStep ? { atNextEndStep: mod.atNextEndStep } : {}),
            ...(mod.atEndOfCombat ? { atEndOfCombat: mod.atEndOfCombat } : {}),
          } as any;
        }
        if (mod.grantsDiesTriggerEffect) {
          const effect = String(mod.grantsDiesTriggerEffect || '').trim();
          if (effect) {
            steps.push({
              kind: 'grant_temporary_dies_trigger',
              target: parseObjectSelector('that token'),
              effect: effect.replace(/\.+$/g, '').trim() + '.',
              duration: 'while_on_battlefield',
              raw: `It gains "When this token dies, ${effect}."`,
              sequence: 'then',
            } as OracleEffectStep);
          }
        }
        i += 1;
        continue;
      }
    }

    const impulseFlow = handleImpulseOrExileTopClause({
      clauses,
      index: i,
      steps,
      lastCreateTokenStepIndexes,
      pendingImpulseFromExileTop,
      parseEffectClauseToStep,
      tryParseImpulseExileTop,
      tryParseExileTopOnly,
      tryParseLegacySubjectOrderImpulse,
    });
    if (impulseFlow.handled) {
      steps.splice(0, steps.length, ...impulseFlow.steps);
      lastCreateTokenStepIndexes = impulseFlow.lastCreateTokenStepIndexes;
      pendingImpulseFromExileTop = impulseFlow.pendingImpulseFromExileTop;
      i = impulseFlow.nextIndex;
      continue;
    }
    pendingImpulseFromExileTop = impulseFlow.pendingImpulseFromExileTop;
    /* Redundant legacy inline subject-order impulse regex removed.

        /^(its controller|its owner|that [a-z0-9][a-z0-9 -]*(?:'s|[’]s) (?:controller|owner)|that player|that opponent|defending player|the defending player|they|he or she)\s+may\s+exile\s+(that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+(their|his or her|your)\s+library(?:\s+face down)?\s*$/i
      );
    */
    const multiCreate = tryParseMultiCreateTokensClauseFromModule(clauses[i]);
    if (multiCreate) {
      const startIdx = steps.length;
      steps.push(...multiCreate);
      lastCreateTokenStepIndexes = Array.from({ length: multiCreate.length }, (_, off) => startIdx + off);
      i += 1;
      continue;
    }

    const conditionalWrapped = tryParseLeadingConditionalStep({
      rawClause: clauses[i],
      cardName,
      parseEffectClauseToStep,
    });
    if (conditionalWrapped) {
      steps.push(conditionalWrapped);
      lastCreateTokenStepIndexes = null;
      pendingImpulseFromExileTop = null;
      i += 1;
      continue;
    }

    const next = parseEffectClauseToStep(clauses[i]);
    if (next.kind === 'unknown' && !String(next.raw || '').trim()) {
      i += 1;
      continue;
    }
    if (next.kind === 'unknown') {
      const trailingConditionalWrapped = tryParseTrailingConditionalStep({
        rawClause: clauses[i],
        cardName,
        parseEffectClauseToStep,
      });
      if (trailingConditionalWrapped) {
        steps.push(trailingConditionalWrapped);
        lastCreateTokenStepIndexes = null;
        pendingImpulseFromExileTop = null;
        i += 1;
        continue;
      }
      const fragment = parseBareTriggerEffectFragmentSteps(clauses[i]);
      if (fragment && fragment.length > 0 && fragment.every((step) => step.kind !== 'unknown')) {
        steps.push(...fragment);
        lastCreateTokenStepIndexes = null;
        pendingImpulseFromExileTop = null;
        i += 1;
        continue;
      }
    }

    steps.push(next);
    lastCreateTokenStepIndexes = next.kind === 'create_token' ? [steps.length - 1] : null;
    i += 1;
  }

  return {
    type: ability.type,
    text: ability.text,
    cost: ability.cost,
    ...(ability.stationChargeThreshold != null
      ? { stationChargeThreshold: ability.stationChargeThreshold }
      : {}),
    triggerCondition: ability.triggerCondition,
    interveningIf: ability.interveningIf,
    effectText,
    steps: stampAsEntersChooseRaw(ability, steps),
  };
}
