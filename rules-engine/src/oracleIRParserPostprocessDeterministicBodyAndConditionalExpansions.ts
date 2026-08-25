// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: deterministic unknown-body step parsing plus the simple/otherwise conditional and you-may-transform unknown-ability expansions.
//
// Public entry points:
//   expandTapMatchingPermanentCountAbilities
//   expandSimpleConditionalUnknownAbilities
//   wrapIfYouDoConditionOnParsedAbilities
//   expandYouMayTransformIfYouDoAbilities
//   expandOtherwiseConditionalUnknownAbilities

import type { OracleClauseCondition, OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseEffectLevelImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import { tryParseExileTopOnly } from './oracleIRParserExileTopOnly';
import { cleanImpulseClause, isIgnorableImpulseReminderClause } from './oracleIRParserImpulseClauseUtils';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { tryParseTemporaryModifyPtClause } from './oracleIRParserModifyPtClauses';
import { parseBlightActionFragmentSteps } from './oracleIRParserPostprocessBareTriggerFragmentSteps';
import { parseCopySpellUnknownStep } from './oracleIRParserPostprocessCopySpellUnknownSteps';
import { expandDynamicCounterRiderSteps } from './oracleIRParserPostprocessDynamicCounterRiders';
import {
  parseExilePermissionModifierUnknownStep,
} from './oracleIRParserPostprocessExileAndGraveyardPermissionModifiers';
import { parseKeywordActionUnknownStep } from './oracleIRParserPostprocessKeywordActionUnknownSteps';
import {
  parseLookTopChooseOneToHandRestToGraveyardBody,
} from './oracleIRParserPostprocessMoveZoneCopyAndLandAnimationExpansions';
import {
  parseReturnFromYourGraveyardToHandClause,
} from './oracleIRParserPostprocessMoveZoneFollowupUpgrades';
import { parseCurrentResidualUnknownStep } from './oracleIRParserPostprocessResidualUnknownStepChain';
import {
  parseMoveZoneWithAttachFollowup,
} from './oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parseQuantity,
  splitIntoClauses,
} from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';
import { AbilityType } from './oracleTextParser';

function parseDeterministicUnknownBodySteps(
  step: OracleEffectStep,
  body: string
): readonly OracleEffectStep[] | null {
  const normalizedBody = normalizeClauseForParse(body.replace(/[.]+$/g, '').trim());
  const withMeta = <T extends OracleEffectStep>(candidate: T): T => {
    const out: any = { ...candidate };
    if (normalizedBody.sequence) out.sequence = normalizedBody.sequence;
    if (normalizedBody.optional) out.optional = normalizedBody.optional;
    return out;
  };

  const parseImpulseExileBody = (bodyClause: string): readonly OracleEffectStep[] | null => {
    const clauses = splitIntoClauses(
      bodyClause.replace(/,\s*then\s+(choose one of them)\b/gi, '. Then $1')
    )
      .map(clause => String(clause || '').trim())
      .filter(Boolean);
    if (clauses.length === 0) return null;

    const exileTop = tryParseExileTopOnly({ clauses, idx: 0 });
    if (!exileTop || exileTop.step.kind !== 'exile_top') return null;

    let bestPermission: ReturnType<typeof parseEffectLevelImpulsePermissionClause> | null = null;
    let bestClauseIndex: number | null = null;

    for (let index = exileTop.consumed; index < clauses.length; index += 1) {
      const cleanedClause = cleanImpulseClause(clauses[index]);
      const parsedPermission = parseEffectLevelImpulsePermissionClause(cleanedClause);
      if (parsedPermission) {
        if (!bestPermission || (bestPermission.duration === 'during_resolution' && parsedPermission.duration !== 'during_resolution')) {
          bestPermission = parsedPermission;
          bestClauseIndex = index;
        }
        if (parsedPermission.duration !== 'during_resolution') break;
        continue;
      }

      if (!isIgnorableImpulseReminderClause(cleanedClause)) break;
    }

    if (!bestPermission || bestClauseIndex === null) return null;

    const impulseStep = exileTop.step as Extract<OracleEffectStep, { kind: 'exile_top' }>;
    const combinedRaw = `${String(impulseStep.raw || '').trim()} ${String(clauses[bestClauseIndex] || '').trim()}`.trim();

    return [
      {
        kind: 'impulse_exile_top',
        who: impulseStep.who,
        amount: impulseStep.amount,
        duration: bestPermission.duration,
        permission: bestPermission.permission,
        ...(bestPermission.condition ? { condition: bestPermission.condition } : {}),
        ...(impulseStep.optional || step.optional ? { optional: true } : {}),
        ...(impulseStep.sequence ? { sequence: impulseStep.sequence } : {}),
        raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
      },
    ];
  };

  const parseSingleClause = (rawClause: string): readonly OracleEffectStep[] | null => {
    const rawText = String(rawClause || '').trim();
    const normalizedClause = normalizeClauseForParse(rawText.replace(/[.]+$/g, '').trim());
    const clause = String(normalizedClause.clause || '').trim();
    if (!clause) return null;

    const applyClauseMeta = <T extends OracleEffectStep>(candidate: T): T => {
      const out: any = { ...candidate };
      if (normalizedClause.sequence) out.sequence = normalizedClause.sequence;
      if (normalizedClause.optional) out.optional = true;
      return out;
    };

    const clauseStep = {
      ...step,
      raw: clause,
      ...(normalizedClause.sequence ? { sequence: normalizedClause.sequence } : {}),
      ...(normalizedClause.optional || normalizedBody.optional || step.optional ? { optional: true } : {}),
    } as Extract<OracleEffectStep, { kind: 'unknown' }>;

    const moveWithAttach = parseMoveZoneWithAttachFollowup(clause);
    if (moveWithAttach && moveWithAttach.length > 0) return moveWithAttach.map(applyClauseMeta);

    const singleStep =
      parseExilePermissionModifierUnknownStep(clauseStep) ??
      parseCopySpellUnknownStep(clauseStep) ??
      parseReturnFromYourGraveyardToHandClause(clause) ??
      tryParseZoneAndRemovalClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseSimpleCreateTokenClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseLifeAndCombatClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseTemporaryModifyPtClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseSimpleActionClause({ clause, rawClause: clause, withMeta: applyClauseMeta });
    if (singleStep && singleStep.kind !== 'unknown') return [applyClauseMeta(singleStep)];

    const blightSteps = parseBlightActionFragmentSteps(clause, normalizedClause.sequence ? { sequence: normalizedClause.sequence } : {});
    if (blightSteps && blightSteps.length > 0) return blightSteps.map(applyClauseMeta);

    const keywordStep = parseKeywordActionUnknownStep(clauseStep);
    if (keywordStep && keywordStep.kind !== 'unknown') return [applyClauseMeta(keywordStep)];

    return null;
  };

  const bodyClause = String(normalizedBody.clause || '').trim();
  const impulseBody = parseImpulseExileBody(bodyClause);
  if (impulseBody && impulseBody.length > 0) return impulseBody;

  const lookTopDistribution = parseLookTopChooseOneToHandRestToGraveyardBody(step, bodyClause);
  if (lookTopDistribution && lookTopDistribution.length > 0) return lookTopDistribution;

  const andParts = bodyClause.split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean);
  if (andParts.length > 1) {
    const parsed = andParts.flatMap(part => parseSingleClause(part) || []);
    if (parsed.length === andParts.length) return parsed;
  }

  const direct = parseSingleClause(bodyClause);
  if (direct && direct.length > 0) return direct;

  const sentenceClauses = splitIntoClauses(bodyClause);
  if (sentenceClauses.length > 1) {
    const parsed = sentenceClauses.flatMap(clause => parseSingleClause(clause) || []);
    if (parsed.length === sentenceClauses.length) return parsed;
  }

  return null;
}

function parseSimpleConditionalUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;
  const conditionSource = normalized.replace(/^[A-Za-z][A-Za-z0-9 ',\-]+\s+-\s+(if|when)\b/i, '$1');

  const match =
    conditionSource.match(/^if\s+(.+?\bcard),\s*(.+)$/i) ||
    conditionSource.match(/^if\s+(.+),\s*(.+)$/i) ||
    conditionSource.match(/^when\s+(you do),\s*(.+)$/i);
  if (!match) return null;

  const conditionRaw = normalizeLeadingConditionalCondition(String(match[1] || '').trim());
  const body = String(match[2] || '').trim();
  if (!conditionRaw || !body) return null;

  const bodyForParse = body.replace(/^you may reveal it and put\b/i, 'you may put');
  const rawParsedBodySteps = parseDeterministicUnknownBodySteps(step, bodyForParse);
  const parsedBodySteps = rawParsedBodySteps ? expandDynamicCounterRiderSteps(rawParsedBodySteps) : null;

  if (!parsedBodySteps || parsedBodySteps.length === 0) return null;

  if (conditionRaw === 'you do' && parsedBodySteps.length === 1 && parsedBodySteps[0]?.kind === 'impulse_exile_top') {
    return {
      ...parsedBodySteps[0],
      raw: normalized,
    };
  }

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: parsedBodySteps,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseTapMatchingPermanentsUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): Extract<OracleEffectStep, { kind: 'tap_matching_permanents' }> | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;

  const match = normalized.match(/^you may tap\s+(another|x|a|an|\d+|[a-z]+)\s+untapped\s+(.+?)\s+you control$/i);
  if (!match) return null;

  return {
    kind: 'tap_matching_permanents',
    who: { kind: 'you' },
    amount: parseQuantity(String(match[1] || '').trim()),
    filter: String(match[2] || '').trim(),
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseTapCountBuffDamageFollowupStep(
  step: OracleEffectStep,
  tappedFilter: string
): Extract<OracleEffectStep, { kind: 'conditional' }> | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^if you do,\s*(this creature|this permanent|it)\s+gets\s+\+x\/\+0\s+until end of turn and deals x damage to (defending player|the defending player)$/i
  );
  if (!match) return null;

  const targetText = String(match[1] || '').trim().toLowerCase();
  const filterText = normalizeOracleText(String(tappedFilter || ''))
    .replace(/^an?\s+/i, '')
    .trim()
    .toLowerCase();

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: 'you do' },
    steps: [
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: targetText },
        power: 1,
        toughness: 0,
        powerUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: `x is the number of ${filterText} tapped this way` },
        raw: `${targetText} gets +X/+0 until end of turn where X is the number of ${filterText} tapped this way`,
      },
      {
        kind: 'deal_damage',
        amount: { kind: 'unknown', raw: `the number of ${filterText} tapped this way` },
        target: { kind: 'raw', text: String(match[2] || '').trim().toLowerCase() },
        raw: `deals X damage to ${String(match[2] || '').trim()}`,
      },
    ],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandTapMatchingPermanentCountAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      if (step.kind !== 'unknown') {
        expandedSteps.push(step);
        continue;
      }

      const tapStep = parseTapMatchingPermanentsUnknownStep(step);
      if (!tapStep) {
        expandedSteps.push(step);
        continue;
      }

      const nextStep = ability.steps[index + 1];
      if (nextStep) {
        const followup = parseTapCountBuffDamageFollowupStep(nextStep, tapStep.filter);
        if (followup) {
          expandedSteps.push(tapStep, followup);
          changed = true;
          index += 1;
          continue;
        }
      }

      expandedSteps.push(tapStep);
      changed = true;
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function invertOtherwiseCondition(previous: Extract<OracleEffectStep, { kind: 'conditional' }>): string | null {
  if (previous.condition.kind !== 'if') return null;
  const text = normalizeLeadingConditionalCondition(String(previous.condition.raw || '').trim());
  const movedCardTypeMatch = text.match(/^it was (?:a|an)\s+(.+?)(?:\s+card)?$/i);
  if (!movedCardTypeMatch) return null;
  return `it was not a ${String(movedCardTypeMatch[1] || '').trim()}`.trim();
}

function parseOtherwiseConditionalUnknownStep(
  step: OracleEffectStep,
  previous: OracleEffectStep | undefined
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^otherwise,?\s*(.+)$/i);
  if (!match || previous?.kind !== 'conditional') return null;

  const conditionRaw = invertOtherwiseCondition(previous);
  if (!conditionRaw) return null;

  const body = String(match[1] || '').trim();
  if (!body) return null;

  const parsedBodySteps = parseDeterministicUnknownBodySteps(step, body);
  if (!parsedBodySteps || parsedBodySteps.length === 0) return null;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: parsedBodySteps,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandSimpleConditionalUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseSimpleConditionalUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseYouMayTransformIfYouDoUnknownSteps(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^you may transform (.+?)\.\s*if you do,\s*(.+)$/i);
  if (!match) return null;

  const transformTarget = String(match[1] || '').trim();
  const body = String(match[2] || '').trim();
  if (!transformTarget || !body) return null;

  const parsedBodySteps = parseDeterministicUnknownBodySteps(step, body);
  if (!parsedBodySteps || parsedBodySteps.length === 0) return null;

  const sequence = step.sequence ? { sequence: step.sequence } : {};
  return [
    {
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: [`you may transform ${transformTarget}`],
      duration: 'static',
      raw: `you may transform ${transformTarget}`,
      ...sequence,
    } as unknown as OracleEffectStep,
    {
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
      steps: parsedBodySteps,
      ...sequence,
      raw: `if you do, ${body}`,
    } as unknown as OracleEffectStep,
  ];
}

export function wrapIfYouDoConditionOnParsedAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const nextSteps = ability.steps.map((step, index) => {
      const previous = ability.steps[index - 1] as { whereX?: OracleClauseCondition } | undefined;
      const inheritedWhereX = (step as { whereX?: OracleClauseCondition }).whereX || previous?.whereX;
      if (step.kind === 'conditional' && String((step.condition as { raw?: string } | undefined)?.raw || '') === 'you do') {
        if (!inheritedWhereX) return step;
        let innerChanged = false;
        const innerSteps = (step.steps || []).map((inner) => {
          if ((inner as { whereX?: OracleClauseCondition }).whereX) return inner;
          innerChanged = true;
          return { ...inner, whereX: inheritedWhereX };
        });
        if (!innerChanged) return step;
        changed = true;
        return { ...step, steps: innerSteps };
      }
      const raw = normalizeOracleText(String(step.raw || '')).trim();
      if (!/^if you do,/i.test(raw)) return step;
      changed = true;
      const innerRaw = raw.replace(/^if you do,\s*/i, '');
      const innerBase = {
        ...step,
        raw: innerRaw,
        ...(inheritedWhereX && !(step as { whereX?: OracleClauseCondition }).whereX ? { whereX: inheritedWhereX } : {}),
      } as OracleEffectStep;
      // Re-expand unknown "If you do, �" bodies through the residual unknown parser so
      // compound P/T+keyword / mana clauses parse the same as top-level effects.
      const residualInner =
        innerBase.kind === 'unknown'
          ? parseCurrentResidualUnknownStep({ kind: 'unknown', raw: innerRaw })
          : null;
      // When residual does not fully resolve compound "A and B" bodies (draw+lose life,
      // draw+repeat, etc.), fall back to deterministic and-splitting used by simple
      // conditionals so both halves stay nested under the If-you-do.
      const deterministicInner =
        innerBase.kind === 'unknown'
          ? parseDeterministicUnknownBodySteps(
            { kind: 'unknown', raw: innerRaw } as Extract<OracleEffectStep, { kind: 'unknown' }>,
            innerRaw,
          )
          : null;
      const preferResidual =
        residualInner
        && residualInner.length > 0
        && residualInner.every((inner) => inner.kind !== 'unknown');
      const preferDeterministic =
        !preferResidual
        && deterministicInner
        && deterministicInner.length > 0
        && deterministicInner.every((inner) => inner.kind !== 'unknown');
      let innerSteps: OracleEffectStep[] = preferResidual
        ? [...residualInner!]
        : preferDeterministic
          ? [...deterministicInner!]
          : residualInner && residualInner.length > 0
            ? [...residualInner]
            : [innerBase];
      // Keyword actions such as Support N are expanded from unknowns; also try that
      // path for nested If-you-do bodies that residual parsing left untouched.
      innerSteps = innerSteps.map((inner) => {
        if (inner.kind !== 'unknown') return inner;
        return parseKeywordActionUnknownStep(inner as Extract<OracleEffectStep, { kind: 'unknown' }>) || inner;
      });
      if (inheritedWhereX) {
        innerSteps = innerSteps.map((inner) => (
          (inner as { whereX?: OracleClauseCondition }).whereX
            ? inner
            : { ...inner, whereX: inheritedWhereX }
        ));
      }
      return {
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you do' },
        steps: innerSteps,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw,
      } as OracleEffectStep;
    });
    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

export function expandYouMayTransformIfYouDoAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type === AbilityType.STATIC || ability.type === AbilityType.REPLACEMENT) {
      return ability;
    }

    let changed = false;
    const expandedSteps = ability.steps.flatMap((step) => {
      if (step.kind !== 'unknown') return [step];
      const expanded = parseYouMayTransformIfYouDoUnknownSteps(step);
      if (!expanded) return [step];
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandOtherwiseConditionalUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step, index, steps) => {
      const expanded = parseOtherwiseConditionalUnknownStep(step, steps[index - 1]);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

