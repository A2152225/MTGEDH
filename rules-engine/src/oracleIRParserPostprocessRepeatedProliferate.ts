/**
 * oracleIRParserPostprocessRepeatedProliferate.ts
 *
 * Origin: oracleIRParserPostprocess.ts
 * Cluster: proliferate twice / again expansion, proliferate reminder prune,
 * and Tekuthal-style keyword-action replacement step clearing.
 * Public: expandRepeatedProliferateUnknownAbilities,
 * pruneRedundantProliferateReminderUnknownAbilities,
 * clearKeywordActionRepetitionReplacementSteps
 */

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { AbilityType } from './oracleTextParser';
import { normalizeOracleText } from './oracleIRParserUtils';

function normalizeRepeatedProliferateClause(step: OracleEffectStep): string {
  const raw = String(
    (step as { raw?: string }).raw
    || (step as { effectText?: readonly string[] }).effectText?.[0]
    || (step as { abilities?: readonly string[] }).abilities?.[0]
    || '',
  );
  return normalizeOracleText(raw)
    .replace(/^then\b\s*/i, '')
    .replace(/^if you do,\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
}

function isRedundantProliferateReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^then do it again$/i.test(normalized) ||
    /^choose any number of permanents and\/or players$/i.test(normalized) ||
    /^choose any number of permanents and\/or players, then give each another counter of each kind already there(?:\. then do it again)?$/i.test(normalized) ||
    /^to proliferate, choose any number of permanents and\/or players$/i.test(normalized) ||
    /^to proliferate, choose any number of permanents and\/or players, then give each another counter of each kind already there(?:\. then do it again)?$/i.test(normalized) ||
    /^(?:then\s+)?give each another counter of each kind already there(?:\. then do it again)?$/i.test(normalized)
  );
}

function isRedundantProliferateReminderStep(step: OracleEffectStep): boolean {
  if (isRedundantProliferateReminderUnknownStep(step)) return true;
  if (step.kind !== 'grant_static_ability') return false;
  const normalized = normalizeOracleText(String(step.raw || (step as { effectText?: readonly string[] }).effectText?.[0] || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  return /^then do it again$/i.test(normalized) || /^do it again$/i.test(normalized);
}

export function pruneRedundantProliferateReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!ability.steps.some((step) => step.kind === 'proliferate') && !normalizedText.includes('proliferate')) {
      return ability;
    }

    const nextSteps = ability.steps.filter(step => !isRedundantProliferateReminderStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function parseRepeatedProliferateSteps(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown' && step.kind !== 'grant_static_ability') return null;

  const clause = normalizeRepeatedProliferateClause(step);
  if (!clause) return null;

  // Roalesk: "proliferate, then proliferate again" is two proliferate actions.
  if (/^proliferate(?:\s*,)?\s+then\s+proliferate(?:\s+again)?$/i.test(clause)) {
    return [
      {
        kind: 'proliferate',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: clause,
      },
      {
        kind: 'proliferate',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: clause,
      },
    ];
  }

  // Isolated "then proliferate again" leftover after a prior proliferate step.
  if (/^proliferate(?:\s+again)?$/i.test(clause) && /\bagain\b/i.test(clause)) {
    return [
      {
        kind: 'proliferate',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: clause,
      },
    ];
  }

  if (!/^proliferate\s+(twice|two\s+times|2\s+times)$/i.test(clause)) return null;

  return [
    {
      kind: 'proliferate',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: clause,
    },
    {
      kind: 'proliferate',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: clause,
    },
  ];
}

function expandRepeatedProliferateSteps(
  steps: readonly OracleEffectStep[],
): { steps: OracleEffectStep[]; changed: boolean } {
  let changed = false;
  const next: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind === 'conditional' && Array.isArray(step.steps)) {
      const inner = expandRepeatedProliferateSteps(step.steps);
      if (inner.changed) {
        changed = true;
        next.push({ ...step, steps: inner.steps });
        continue;
      }
    }

    const expanded = parseRepeatedProliferateSteps(step);
    if (expanded) {
      changed = true;
      next.push(...expanded);
      continue;
    }

    next.push(step);
  }

  return { steps: next, changed };
}

export function expandRepeatedProliferateUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type === AbilityType.STATIC || ability.type === AbilityType.REPLACEMENT) {
      return ability;
    }

    const expanded = expandRepeatedProliferateSteps(ability.steps);
    return expanded.changed ? { ...ability, steps: expanded.steps } : ability;
  });
}

/**
 * Tekuthal / Topography Tracker style replacements are applied at keyword-action
 * resolution time (see server keywordActionRepetition). Clear misparsed executable
 * steps so replacement text is not treated as a static explore/proliferate effect.
 */
export function clearKeywordActionRepetitionReplacementSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.REPLACEMENT) return ability;
    const text = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (
      /if you would proliferate,\s*proliferate twice instead/i.test(text) ||
      /if a creature you control would explore,\s*instead it explores,\s*then it explores again/i.test(text)
    ) {
      return ability.steps.length === 0 ? ability : { ...ability, steps: [] };
    }
    return ability;
  });
}
