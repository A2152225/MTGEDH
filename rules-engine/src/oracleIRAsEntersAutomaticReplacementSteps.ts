/**
 * Origin parent: oracleIRParserAbilityToIR.ts / oracleTextParser parseReplacementEffect
 * Cluster: as-enters replacement steps that apply automatically (no choice prompt)
 *   as the permanent is entering — currently turn_face_down (Ixidron family).
 * Public: collectAsEntersAutomaticReplacementSteps
 * Leaf must not import oracleIRParser.ts barrels that would cycle; it calls parseOracleTextToIR.
 */

import type { OracleEffectStep } from './oracleIR';
import { parseOracleTextToIR } from './oracleIRParser';
import { AbilityType } from './oracleTextParser';

const AUTOMATIC_AS_ENTERS_STEP_KINDS = new Set<string>(['turn_face_down']);

export function collectAsEntersAutomaticReplacementSteps(
  oracleText: string,
  cardName?: string,
): OracleEffectStep[] {
  const text = String(oracleText || '').trim();
  if (!text) return [];

  const ir = parseOracleTextToIR(text, cardName);
  const steps: OracleEffectStep[] = [];

  for (const ability of ir.abilities || []) {
    if (ability.type !== AbilityType.REPLACEMENT) continue;
    const trigger = String(ability.triggerCondition || '').toLowerCase();
    const abilityText = String(ability.text || '').toLowerCase();
    if (!/\benters(?: the battlefield)?/.test(trigger) && !/^as\s+/.test(abilityText)) continue;
    if (/\byou may\b/i.test(String(ability.effectText || ability.text || ''))) continue;

    for (const step of ability.steps || []) {
      if (!AUTOMATIC_AS_ENTERS_STEP_KINDS.has(String(step.kind || ''))) continue;
      if ((step as { optional?: boolean }).optional === true) continue;
      steps.push(step);
    }
  }

  return steps;
}
