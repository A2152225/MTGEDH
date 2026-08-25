/**
 * Unless-sacrifice and if-you-do impulse conditionals for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 16504-16626 of the
 * pre-split file).
 * Cluster moved: the "unless you sacrifice" conditional rewrite and the conditional
 * if-you-do impulse-exile upgrade.
 * Public entry symbols: upgradeConditionalIfYouDoImpulseAbilities,
 * expandUnlessSacrificeAbilities, plus expandUnlessSacrificeStep re-exported at the foot of
 * this file for the postprocess parent.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseEffectLevelImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import { tryParseExileTopOnly } from './oracleIRParserExileTopOnly';
import {
  cleanImpulseClause,
  isIgnorableImpulseReminderClause,
} from './oracleIRParserImpulseClauseUtils';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector, splitIntoClauses } from './oracleIRParserUtils';

function expandUnlessSacrificeStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'sacrifice') return step;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const match = normalized.match(/^sacrifice\s+(.+?)\s+unless\s+(.+)$/i);
  if (!match) return step;

  const conditionRaw = String(match[2] || '').trim();
  const normalizedCondition = normalizeOracleText(conditionRaw);
  const negatedCondition =
    normalizedCondition === 'it escaped'
      ? "it didn't escape"
      : normalizedCondition === 'this permanent escaped'
        ? "this permanent didn't escape"
        : `not (${conditionRaw})`;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: negatedCondition },
    steps: [
      {
        ...step,
        what: parseObjectSelector(String(match[1] || '').trim()),
        raw: `sacrifice ${String(match[1] || '').trim()}`,
      },
    ],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseConditionalIfYouDoImpulseStep(
  step: Extract<OracleEffectStep, { kind: 'conditional' }>,
  nextStep: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (step.condition.kind !== 'if') return null;
  if (normalizeLeadingConditionalCondition(String(step.condition.raw || '').trim()) !== 'you do') return null;

  const permission = nextStep?.kind === 'unknown'
    ? parseEffectLevelImpulsePermissionClause(cleanImpulseClause(String(nextStep.raw || '')))
    : nextStep?.kind === 'grant_exile_permission' && /^(?:that card|the exiled card|it)$/i.test(String((nextStep.what as any)?.text || '').trim())
      ? {
          permission: nextStep.permission,
          duration: nextStep.duration,
        }
      : null;
  if (!permission) return null;

  const clauses = splitIntoClauses(
    normalizeOracleText(String(step.raw || ''))
      .replace(/^if you do,\s*/i, '')
      .replace(/,\s*then\s+(choose one of them)\b/gi, '. Then $1')
  )
    .map(clause => String(clause || '').trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;

  const exileTop = tryParseExileTopOnly({ clauses, idx: 0 });
  if (!exileTop || exileTop.step.kind !== 'exile_top') return null;

  for (let index = exileTop.consumed; index < clauses.length; index += 1) {
    if (!isIgnorableImpulseReminderClause(cleanImpulseClause(clauses[index]))) return null;
  }

  const impulseStep = exileTop.step as Extract<OracleEffectStep, { kind: 'exile_top' }>;
  const combinedRaw = `${String(step.raw || '').trim()} ${String(nextStep.raw || '').trim()}`.trim();

  return {
    kind: 'impulse_exile_top',
    who: impulseStep.who,
    amount: impulseStep.amount,
    duration: permission.duration,
    permission: permission.permission,
    ...(permission.condition ? { condition: permission.condition } : {}),
    ...(impulseStep.optional ? { optional: true } : {}),
    ...(impulseStep.sequence ? { sequence: impulseStep.sequence } : {}),
    raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
  };
}

export function upgradeConditionalIfYouDoImpulseAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const upgradedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      if (step.kind !== 'conditional') {
        upgradedSteps.push(step);
        continue;
      }

      const upgraded = parseConditionalIfYouDoImpulseStep(step, ability.steps[index + 1]);
      if (!upgraded) {
        upgradedSteps.push(step);
        continue;
      }

      changed = true;
      upgradedSteps.push(upgraded);
      index += 1;
    }

    return changed ? { ...ability, steps: upgradedSteps } : ability;
  });
}

export function expandUnlessSacrificeAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      const expanded = expandUnlessSacrificeStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export { expandUnlessSacrificeStep };
