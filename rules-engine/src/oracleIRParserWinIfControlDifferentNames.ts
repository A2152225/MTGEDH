// New sibling for leftover resolution “if you control N or more [type] with
// different names, you win the game” (Maze's End activated Gate-search family).
//
// Cluster: generic win-if-control-N-different-names — no card-name routing.
// Public: tryParseWinIfControlDifferentNamesStep, expandWinIfControlDifferentNamesAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

const IF_CONTROL_THEN_WIN =
  /^if you control ([a-z0-9]+) or more ([a-z0-9' -]+?) with different names,\s*you win the game\.?$/i;

const WIN_IF_CONTROL =
  /^you win the game if you control ([a-z0-9]+) or more ([a-z0-9' -]+?) with different names\.?$/i;

function normalizeWinIfControlText(raw: string): string {
  return normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

export function tryParseWinIfControlDifferentNamesStep(
  rawClause: string,
  sequence: { sequence?: 'then' } = {},
): Extract<OracleEffectStep, { kind: 'conditional' }> | null {
  const normalized = normalizeWinIfControlText(rawClause);
  if (!normalized) return null;

  const match = normalized.match(IF_CONTROL_THEN_WIN) || normalized.match(WIN_IF_CONTROL);
  if (!match) return null;

  const thresholdRaw = String(match[1] || '').trim();
  const typeRaw = String(match[2] || '').trim();
  if (!thresholdRaw || !typeRaw) return null;

  const conditionRaw = `you control ${thresholdRaw} or more ${typeRaw} with different names`;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: [{
      kind: 'win_game',
      raw: 'you win the game',
    }],
    raw: normalized,
    ...sequence,
  };
}

function leftoverStaticWinIfRaw(step: OracleEffectStep): string | null {
  if (step.kind === 'unknown') {
    return String(step.raw || '').trim() || null;
  }
  if (step.kind !== 'grant_static_ability') return null;
  const raw = String(step.raw || '').trim();
  const effectText = Array.isArray((step as { effectText?: readonly string[] }).effectText)
    ? String((step as { effectText?: readonly string[] }).effectText?.[0] || '').trim()
    : '';
  const candidate = raw || effectText;
  if (!candidate) return null;
  const normalized = normalizeWinIfControlText(candidate);
  if (IF_CONTROL_THEN_WIN.test(normalized) || WIN_IF_CONTROL.test(normalized)) {
    return candidate;
  }
  return null;
}

export function expandWinIfControlDifferentNamesAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const nextSteps = (ability.steps || []).map((step) => {
      const leftover = leftoverStaticWinIfRaw(step);
      if (!leftover) return step;
      const sequence = step.sequence === 'then' ? { sequence: 'then' as const } : {};
      const parsed = tryParseWinIfControlDifferentNamesStep(leftover, sequence);
      if (!parsed) return step;
      changed = true;
      return parsed;
    });
    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}
