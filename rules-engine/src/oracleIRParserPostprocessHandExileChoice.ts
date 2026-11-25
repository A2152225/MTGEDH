// "Each opponent exiles a card from their hand" (Yarok's Fenlurker, Mindslicer-style hand exiles):
// the clause parsed as a generic move_zone whose card was never chosen by the exiling player. Rewrite it
// as a discard-style hand choice with destination 'exile', so the affected player picks the card through
// the normal discard selection flow and the card goes to exile instead of the graveyard.
//
// Public entry points:
//   rewriteHandExileChoiceStep, rewriteHandExileChoiceAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

const HAND_EXILE_CHOICE =
  /^(?:then\s+)?(each opponent|each player|each other player|target player|target opponent|that player|defending player)\s+exiles?\s+(a|an|one|two|three|four|five|\d+|x)\s+cards?\s+from\s+(?:their|his or her)\s+hand$/i;

function normalizeRaw(raw: unknown): string {
  return String(raw || '')
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .trim();
}

export function rewriteHandExileChoiceStep(step: OracleEffectStep): OracleEffectStep {
  const anyStep = step as any;
  if (anyStep?.kind === 'conditional' && Array.isArray(anyStep.steps)) {
    const steps = anyStep.steps.map(rewriteHandExileChoiceStep);
    const elseSteps = Array.isArray(anyStep.elseSteps) ? anyStep.elseSteps.map(rewriteHandExileChoiceStep) : undefined;
    const changed = steps.some((entry: any, idx: number) => entry !== anyStep.steps[idx])
      || Boolean(elseSteps && elseSteps.some((entry: any, idx: number) => entry !== anyStep.elseSteps[idx]));
    if (!changed) return step;
    return { ...anyStep, steps, ...(elseSteps ? { elseSteps } : {}) } as OracleEffectStep;
  }
  if (anyStep?.kind !== 'move_zone' || String(anyStep.to || '') !== 'exile') return step;
  const match = normalizeRaw(anyStep.raw).match(HAND_EXILE_CHOICE);
  if (!match) return step;
  return {
    kind: 'discard',
    who: parsePlayerSelector(match[1]),
    amount: parseQuantity(`${match[2]} card`),
    destination: 'exile',
    ...(anyStep.optional ? { optional: true } : {}),
    ...(anyStep.sequence ? { sequence: anyStep.sequence } : {}),
    raw: String(anyStep.raw || ''),
  } as OracleEffectStep;
}

export function rewriteHandExileChoiceAbilities(abilities: OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = Array.isArray(ability.steps) ? ability.steps : [];
    const next = steps.map(rewriteHandExileChoiceStep);
    return next.some((entry, idx) => entry !== steps[idx]) ? ({ ...ability, steps: next } as OracleIRAbility) : ability;
  });
}
