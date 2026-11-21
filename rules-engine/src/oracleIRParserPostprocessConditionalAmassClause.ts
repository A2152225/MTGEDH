// rules-engine/src/oracleIRParserPostprocessConditionalAmassClause.ts
//
// Origin: new module (no parent). Sibling of oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords.ts,
// which lowers a top-level "amass <Subtype> N" but not one that sits behind an "If ..." clause.
//
// Cluster: "If <condition>, amass <Subtype> N" -> conditional wrapping the lowered amass steps, plus
// removal of the amass reminder text that follows it.
//
// Moria Scavenger (oracle-cards.jsonl):
//   "{T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a
//   +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0
//   black Orc Army creature token first.)"
//
// Public entry symbols:
//   lowerConditionalAmassClauseAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { lowerAmassReminderAbilities } from './oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords';

const AMASS_LEAD = /^amass(?:\s+[a-z][a-z' -]*?)?\s+(?:\d+|x)$/i;
const IF_AMASS_CLAUSE = /^if\s+(.+?),\s+(amass(?:\s+[a-z][a-z' -]*?)?\s+(?:\d+|x))$/i;

function stepRaw(step: OracleEffectStep | undefined): string {
  return String((step as { raw?: unknown } | undefined)?.raw || '')
    .replace(/\u2019/g, "'")
    .replace(/[.\s]+$/g, '')
    .trim();
}

function lowerAmassLead(amassText: string): readonly OracleEffectStep[] | null {
  const lead = { kind: 'unknown', raw: amassText } as unknown as OracleEffectStep;
  const [lowered] = lowerAmassReminderAbilities([{ steps: [lead] } as unknown as OracleIRAbility]);
  const steps = lowered?.steps || [];
  return steps.length > 0 && steps.every((step) => step.kind !== 'unknown') ? steps : null;
}

/** The condition and amass text of a step that is still an unparsed "If X, amass ..." clause. */
function readConditionalAmassClause(step: OracleEffectStep): { condition: string; amassText: string } | null {
  if (step.kind === 'conditional') {
    const nested = Array.isArray(step.steps) ? step.steps : [];
    if (nested.length !== 1 || nested[0]?.kind !== 'unknown') return null;
    const amassText = stepRaw(nested[0]);
    if (!AMASS_LEAD.test(amassText)) return null;
    const condition = String(step.condition?.raw || '').trim();
    return condition ? { condition, amassText } : null;
  }

  // Unparsed clause, or the same clause after the residual passes filed it as static metadata.
  const isResidual = step.kind === 'unknown' || step.kind === 'grant_static_ability';
  if (!isResidual) return null;
  const match = stepRaw(step).match(IF_AMASS_CLAUSE);
  if (!match) return null;
  return { condition: String(match[1] || '').trim(), amassText: String(match[2] || '').trim() };
}

/** Amass reminder text: "(Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create ... first.)" */
function isAmassReminderFragment(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  const raw = stepRaw(step).replace(/^\(/, '').replace(/\)$/, '').trim();
  if (step.kind === 'add_counter' || step.kind === 'unknown') {
    if (/^(?:to amass [^,]+, )?put .+ \+1\/\+1 counters? on an army you control$/i.test(raw)) return true;
  }
  if (step.kind === 'unknown' || step.kind === 'add_types' || step.kind === 'grant_static_ability') {
    if (/^it's also an? [a-z][a-z' -]*$/i.test(raw)) return true;
  }
  if (step.kind === 'conditional') {
    const condition = String(step.condition?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
    const createsArmy = (step.steps || []).some(
      (nested) => nested.kind === 'create_token' && /\barmy\b/i.test(String((nested as { token?: unknown }).token || '')),
    );
    return condition === "you don't control an army" && createsArmy;
  }
  return false;
}

function lowerSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const next: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const clause = readConditionalAmassClause(step);
    const amassSteps = clause ? lowerAmassLead(clause.amassText) : null;
    if (!clause || !amassSteps) {
      next.push(step);
      continue;
    }
    changed = true;
    const sequence = (step as { sequence?: unknown }).sequence;
    next.push({
      kind: 'conditional',
      condition: { kind: 'if', raw: clause.condition },
      steps: amassSteps,
      ...(sequence ? { sequence } : {}),
      raw: `If ${clause.condition}, ${clause.amassText}`,
    } as unknown as OracleEffectStep);
    while (isAmassReminderFragment(steps[index + 1])) index += 1;
  }
  return changed ? next : null;
}

export function lowerConditionalAmassClauseAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = lowerSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}
