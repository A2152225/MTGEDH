/**
 * Origin parent: oracleIRParserParseOracleTextToIR.ts
 * Cluster: Winter's Chill “may pay {A} or {B}” follow-ups
 *   (“If that player doesn't…” / “If that player pays only {A}…”).
 * Public: foldUnlessPaysMayPayOrFollowups
 */

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

function conditionRawOf(step: OracleEffectStep): string {
  if (step.kind !== 'conditional') return '';
  return normalizeOracleText(String((step as { condition?: { raw?: string } }).condition?.raw || ''));
}

export function foldUnlessPaysMayPayOrFollowups(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = [...(ability.steps || [])];
    if (steps.length < 2) return ability;
    let changed = false;
    const next: OracleEffectStep[] = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (step.kind !== 'unless_pays_mana' || !Array.isArray(step.manaOptions) || step.manaOptions.length < 2) {
        next.push(step);
        continue;
      }
      const decline = steps[index + 1];
      const paysOnly = steps[index + 2];
      const declineRaw = conditionRawOf(decline as OracleEffectStep);
      const paysOnlyRaw = conditionRawOf(paysOnly as OracleEffectStep);
      const declineMatch = /^that player does(?: not|n't)$/i.test(declineRaw);
      const paysOnlyMatch = /^that player pays only (\{[^}]+\})/i.exec(paysOnlyRaw);
      if (!declineMatch || decline?.kind !== 'conditional') {
        next.push(step);
        continue;
      }
      const declineSteps = Array.isArray((decline as { steps?: readonly OracleEffectStep[] }).steps)
        ? (decline as { steps: readonly OracleEffectStep[] }).steps
        : [];
      const paidSteps = paysOnlyMatch && paysOnly?.kind === 'conditional'
        ? (Array.isArray((paysOnly as { steps?: readonly OracleEffectStep[] }).steps)
          ? (paysOnly as { steps: readonly OracleEffectStep[] }).steps
          : [])
        : [];
      next.push({
        ...step,
        steps: declineSteps.length > 0 ? declineSteps : step.steps,
        ...(paidSteps.length > 0 ? { paidSteps } : {}),
      });
      index += paysOnlyMatch ? 2 : 1;
      changed = true;
    }
    return changed ? { ...ability, steps: next } : ability;
  });
}
