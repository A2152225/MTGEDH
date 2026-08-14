import { AbilityType } from './oracleTextParser';
import { parseOracleTextToIR } from './oracleIRParser';
import { buildSelfReferenceAliases } from './oracleTextParserPreprocess';
import type { OracleEffectStep } from './oracleIR';

export type SelfEntryCounterContext = {
  readonly oracleText: string;
  readonly cardName?: string;
  readonly xValue?: number;
  readonly wasKicked?: boolean;
};

function isSelfEntryCounterTarget(step: OracleEffectStep, cardName?: string): boolean {
  if (step.kind !== 'add_counter') return false;
  const text = String((step as { target?: { text?: string; raw?: string } }).target?.text
    || (step as { target?: { text?: string; raw?: string } }).target?.raw
    || '').trim();
  if (!text) return true;
  const normalized = text.toLowerCase();
  if (/^(this(?:\s+(?:permanent|creature|artifact|enchantment|land))+|it|he|she)$/i.test(normalized)) {
    return true;
  }
  if (!cardName) return false;
  return buildSelfReferenceAliases(cardName).some((alias) => {
    const aliasText = alias.trim().toLowerCase();
    return Boolean(aliasText) && (normalized === aliasText || normalized.startsWith(`${aliasText} `));
  });
}

function resolveSelfEntryCounterAmount(
  amount: { readonly kind: string; readonly value?: number },
  xValue?: number,
): number | null {
  if (amount.kind === 'number') {
    const value = Number(amount.value);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
  }
  if (amount.kind === 'x') {
    const resolved = Number(xValue);
    return Number.isFinite(resolved) ? Math.max(0, Math.floor(resolved)) : null;
  }
  return null;
}

function replacementRequiresKicker(ability: { readonly triggerCondition?: string; readonly text?: string; readonly effectText?: string }): boolean {
  const text = `${ability.triggerCondition || ''} ${ability.text || ''} ${ability.effectText || ''}`;
  return /\bwas kicked\b/i.test(text);
}

/**
 * Resolve self-entry counter replacements such as "Grenzo enters with X +1/+1 counters on it."
 * X uses the spell's chosen X; kicker replacements apply only when the spell was kicked.
 */
export function deriveSelfEntryCountersFromOracleIR(
  args: SelfEntryCounterContext,
): Record<string, number> | undefined {
  const oracleText = String(args.oracleText || '').trim();
  if (!oracleText) return undefined;

  let ir;
  try {
    ir = parseOracleTextToIR(oracleText, args.cardName);
  } catch {
    return undefined;
  }

  const counters: Record<string, number> = {};
  for (const ability of ir.abilities) {
    if (ability.type !== AbilityType.REPLACEMENT) continue;
    if (replacementRequiresKicker(ability) && !args.wasKicked) continue;

    for (const step of ability.steps || []) {
      if (step.kind !== 'add_counter') continue;
      if (!isSelfEntryCounterTarget(step, args.cardName)) continue;
      const amount = resolveSelfEntryCounterAmount(step.amount, args.xValue);
      if (amount === null || amount <= 0) continue;
      const counter = String(step.counter || '').trim();
      if (!counter) continue;
      counters[counter] = (counters[counter] || 0) + amount;
    }
  }

  return Object.keys(counters).length > 0 ? counters : undefined;
}
