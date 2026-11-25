// "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card."
// (Thought Erasure, Duress, Thoughtseize, Coercion, Corpse Traders): the middle sentence parses as a
// card-name choice (or a static grant), so the discard had no card to bind and its prompt listed an empty
// hand. Fold the choice into the discard: the controller chooses from the revealed player's hand, filtered
// by the sentence's card qualifier.
//
// Public entry points:
//   mergeRevealedHandChooseDiscardSteps, mergeRevealedHandChooseDiscardAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';

const CHOOSE_FROM_REVEALED_HAND =
  /^(?:then\s+)?you\s+choose\s+(?:an?|one)\s+((?:[a-z][a-z,\- ]*?\s+)?card)\s+from\s+(?:it|their\s+hand|that\s+hand|that\s+player's\s+hand)(?:\s+(with\s+mana\s+value\s+(?:\d+|x)\s+or\s+less))?$/i;

const CHOOSE_STEP_KINDS = new Set<string>(['choose_card_name', 'grant_static_ability', 'unknown']);

function normalizeRaw(raw: unknown): string {
  return String(raw || '')
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .trim();
}

/** Card filter text ("nonland card", "noncreature, nonland card with mana value 3 or less"), or null. */
export function revealedHandChooseFilter(step: OracleEffectStep | undefined): string | null {
  if (!step || !CHOOSE_STEP_KINDS.has(String(step.kind || ''))) return null;
  const match = normalizeRaw((step as { raw?: string }).raw).match(CHOOSE_FROM_REVEALED_HAND);
  if (!match) return null;
  return [match[1], match[2]].filter(Boolean).join(' ').toLowerCase().trim();
}

function isDiscardThatCardStep(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'discard') return false;
  const target = (step as { target?: { kind?: string; text?: string } }).target;
  return target?.kind === 'raw' && /^that card$/i.test(String(target.text || '').trim());
}

export function mergeRevealedHandChooseDiscardSteps(
  steps: readonly OracleEffectStep[],
): readonly OracleEffectStep[] {
  if (!Array.isArray(steps) || steps.length < 2) return steps;
  if (!steps.some((step) => step?.kind === 'reveal_hand' || step?.kind === 'look_hand')) return steps;

  const out: OracleEffectStep[] = [];
  let changed = false;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const filter = revealedHandChooseFilter(step);
    const next = steps[index + 1];
    if (filter && isDiscardThatCardStep(next)) {
      out.push({
        ...(next as any),
        target: { kind: 'raw', text: filter },
        chooser: { kind: 'you' },
        revealedHandChoice: true,
      } as OracleEffectStep);
      index += 1;
      changed = true;
      continue;
    }
    out.push(step);
  }
  return changed ? out : steps;
}

export function mergeRevealedHandChooseDiscardAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps || [];
    const merged = mergeRevealedHandChooseDiscardSteps(steps);
    return merged === steps ? ability : { ...ability, steps: [...merged] };
  });
}
