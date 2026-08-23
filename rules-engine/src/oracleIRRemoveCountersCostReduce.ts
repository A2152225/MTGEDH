/**
 * Generic "remove all counters from up to one target permanent or opponent"
 * + "next spell costs {1} less for each counter removed this way" patterns
 * (Mutated Cultist-style).
 */
import type { OracleEffectStep } from './oracleIR';

const REMOVE_ALL_COUNTERS_RE =
  /^remove\s+all\s+counters\s+from\s+(up\s+to\s+one\s+target\s+permanent(?:\s+or\s+opponent)?|target\s+permanent(?:\s+or\s+opponent)?|up\s+to\s+one\s+target\s+opponent|target\s+opponent)$/i;

const NEXT_SPELL_COST_REDUCE_RE =
  /^the\s+next\s+spell\s+you\s+cast\s+this\s+turn\s+costs\s+(\{[^}]+\})\s+less\s+to\s+cast\s+for\s+each\s+counter\s+removed\s+this\s+way$/i;

export function tryParseRemoveAllCountersFromTargetClause(clause: string): OracleEffectStep | null {
  const raw = String(clause || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const match = raw.match(REMOVE_ALL_COUNTERS_RE);
  if (!match) return null;
  const targetText = String(match[1] || '').trim();
  const optional = /^up\s+to\s+/i.test(targetText);
  return {
    kind: 'remove_counter',
    amount: { kind: 'all' },
    counter: 'any',
    target: { kind: 'raw', text: targetText },
    optional: optional || undefined,
    raw,
  } as OracleEffectStep;
}

export function tryParseNextSpellCostReduceForCountersRemovedClause(
  clause: string,
): OracleEffectStep | null {
  const raw = String(clause || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const match = raw.match(NEXT_SPELL_COST_REDUCE_RE);
  if (!match) return null;
  const mana = String(match[1] || '{1}').trim();
  return {
    kind: 'grant_next_spell_cost_reduction',
    mana,
    perCountersRemoved: true,
    duration: 'until_end_of_turn',
    raw,
  } as OracleEffectStep;
}

export function repairRemoveCountersCostReduceSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (!Array.isArray(steps) || steps.length === 0) return steps as OracleEffectStep[];
  const out: OracleEffectStep[] = [];
  for (const step of steps) {
    if (step.kind === 'grant_static_ability') {
      const raw = String((step as any).raw || (step as any).effectText?.[0] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const remove = tryParseRemoveAllCountersFromTargetClause(raw);
      if (remove) {
        out.push(remove);
        continue;
      }
      const reduce = tryParseNextSpellCostReduceForCountersRemovedClause(raw);
      if (reduce) {
        out.push(reduce);
        continue;
      }
    }
    if (step.kind === 'conditional' && Array.isArray((step as any).steps)) {
      const nested = repairRemoveCountersCostReduceSteps((step as any).steps);
      out.push(nested === (step as any).steps ? step : { ...step, steps: nested });
      continue;
    }
    out.push(step);
  }
  return out;
}
