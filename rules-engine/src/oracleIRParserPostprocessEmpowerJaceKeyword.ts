// Comp Rules 20260925 / 701.71 — lower "Empower Jace N" keyword actions into executable IR steps.
//
// Mirrors amass/recruit lowering: expand the keyword (and prune duplicated reminder text).

import type { OracleEffectStep, OracleIRAbility, OracleQuantity } from './oracleIR';
import { normalizeReminderStepRaw } from './oracleIRParserPostprocessKeywordReminderPrunes';
import { normalizeOracleText, parseQuantity } from './oracleIRParserUtils';

const JACE_TOKEN_DESC =
  'blue Jace planeswalker token with 0 loyalty, "[-1]: Surveil 1," and "[-3]: Draw a card."';

function parseEmpowerJaceAmount(raw: string): { amountText: string; amount: OracleQuantity } | null {
  const normalized = normalizeOracleText(String(raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const match = normalized.match(/^(?:you\s+)?empower\s+jace\s+(\d+|x)$/i);
  if (!match) return null;
  const amountText = String(match[1] || '').trim().toUpperCase();
  return { amountText, amount: parseQuantity(String(match[1] || '').trim()) };
}

function isEmpowerJaceReminderTail(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'unknown') return false;
  const raw = normalizeReminderStepRaw(step).toLowerCase();
  if (!raw) return false;
  if (/put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) loyalty counters? on a jace/i.test(raw)) {
    return true;
  }
  if (/if you don't control one, first create a blue jace/i.test(raw)) return true;
  if (/create a blue jace planeswalker token/i.test(raw) && /surveil/i.test(raw)) return true;
  return false;
}

function buildEmpowerJaceSteps(
  amountText: string,
  amount: OracleQuantity,
  sequence?: 'then',
): OracleEffectStep[] {
  const counterWord = amountText === '1' ? 'counter' : 'counters';
  return [
    {
      kind: 'conditional',
      condition: { kind: 'if', raw: "you don't control a Jace planeswalker token" },
      steps: [
        {
          kind: 'create_token',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          token: JACE_TOKEN_DESC,
          raw: `create a ${JACE_TOKEN_DESC}`,
        },
      ],
      ...(sequence ? { sequence } : {}),
      raw: `If you don't control a Jace planeswalker token, create a ${JACE_TOKEN_DESC}`,
    } as unknown as OracleEffectStep,
    {
      kind: 'add_counter',
      amount,
      counter: 'loyalty',
      target: { kind: 'raw', text: 'Jace planeswalker token you control' },
      raw: `Put ${amountText} loyalty ${counterWord} on a Jace planeswalker token you control`,
    } as unknown as OracleEffectStep,
  ];
}

function tryLowerEmpowerJaceKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.kind !== 'unknown') {
      nextSteps.push(step);
      continue;
    }

    const parsed = parseEmpowerJaceAmount(String(step.raw || ''));
    if (!parsed) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    nextSteps.push(...buildEmpowerJaceSteps(parsed.amountText, parsed.amount, step.sequence));

    while (index + 1 < steps.length && isEmpowerJaceReminderTail(steps[index + 1])) {
      index += 1;
    }
  }

  return changed ? nextSteps : null;
}

export function lowerEmpowerJaceKeywordAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const fullMatch = normalizedText.match(/^(?:you\s+)?empower\s+jace\s+(\d+|x)\b/i);
    const unknownOnly =
      ability.steps.length > 0 &&
      ability.steps.every((step) => step.kind === 'unknown' || isEmpowerJaceReminderTail(step));

    if (unknownOnly && fullMatch) {
      const amountText = String(fullMatch[1] || '').trim().toUpperCase();
      return {
        ...ability,
        steps: [...buildEmpowerJaceSteps(amountText, parseQuantity(String(fullMatch[1] || '').trim()))],
      };
    }

    const lowered = tryLowerEmpowerJaceKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

export function pruneRedundantEmpowerJaceReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('empower jace')) return ability;
    const nextSteps = ability.steps.filter((step) => !isEmpowerJaceReminderTail(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}
