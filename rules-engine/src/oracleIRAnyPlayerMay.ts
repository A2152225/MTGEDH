/**
 * Shared "any player may <payment>. If a player does, <effect>" patterns
 * (Dash Hopes / Temporal Extortion / Phantasmagorian / Brain Gorgers).
 */
import type { OracleEffectStep } from './oracleIR';

export type AnyPlayerMayPayment =
  | { readonly kind: 'life'; readonly amount: number }
  | { readonly kind: 'half_life_rounded_up' }
  | { readonly kind: 'discard'; readonly amount: number }
  | { readonly kind: 'sacrifice'; readonly what: string };

const COMPOUND_RE =
  /^any\s+player\s+may\s+(.+?)\s*[.]\s*if\s+a\s+player\s+does,\s*counter\s+(.+)$/i;
const PAYMENT_ONLY_RE = /^any\s+player\s+may\s+(.+)$/i;
const COUNTER_IF_PLAYER_DOES_RE = /^if\s+a\s+player\s+does,\s*counter\s+(.+)$/i;

export function parseAnyPlayerMayPayment(paymentRaw: string): AnyPlayerMayPayment | null {
  const raw = String(paymentRaw || '').trim().replace(/\.$/, '');
  if (!raw) return null;

  const life = raw.match(/^pay\s+(\d+)\s+life$/i);
  if (life) {
    const amount = Number.parseInt(String(life[1] || '0'), 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { kind: 'life', amount };
  }

  if (/^pay\s+half\s+their\s+life,\s*rounded\s+up$/i.test(raw)) {
    return { kind: 'half_life_rounded_up' };
  }

  const discard = raw.match(/^discard\s+(a|an|one|two|three|four|five|\d+)\s+cards?$/i);
  if (discard) {
    const word = String(discard[1] || '').trim().toLowerCase();
    const map: Record<string, number> = {
      a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    };
    const amount = map[word] ?? Number.parseInt(word, 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { kind: 'discard', amount };
  }

  const sac = raw.match(/^sacrifice\s+((?:a|an|one)\s+creature(?:\s+of\s+their\s+choice)?)$/i);
  if (sac) {
    return { kind: 'sacrifice', what: String(sac[1] || 'a creature').trim() };
  }

  return null;
}

export function buildAnyPlayerMayStep(
  payment: AnyPlayerMayPayment,
  _counterTargetRaw: string,
  raw: string,
): OracleEffectStep {
  return {
    kind: 'any_player_may',
    payment,
    steps: [
      {
        kind: 'counter_spell',
        target: { kind: 'raw', text: 'this spell' },
        raw: 'counter this spell',
      } as OracleEffectStep,
    ],
    raw,
  } as OracleEffectStep;
}

/** Parse a single compound clause into any_player_may, or null. */
export function tryParseAnyPlayerMayCompoundClause(clause: string): OracleEffectStep | null {
  const normalized = String(clause || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const match = normalized.match(COMPOUND_RE);
  if (!match) return null;
  const payment = parseAnyPlayerMayPayment(String(match[1] || '').trim());
  if (!payment) return null;
  return buildAnyPlayerMayStep(payment, String(match[2] || 'this spell'), normalized);
}

function isAnyPlayerMayGrantStatic(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;
  const raw = String((step as any).raw || '').replace(/\s+/g, ' ').trim();
  const effectText = Array.isArray((step as any).effectText)
    ? String((step as any).effectText[0] || '')
    : '';
  const candidate = PAYMENT_ONLY_RE.test(raw) ? raw : effectText.replace(/\s+/g, ' ').trim();
  if (!PAYMENT_ONLY_RE.test(candidate)) return false;
  const paymentPart = candidate.replace(/^any\s+player\s+may\s+/i, '');
  return parseAnyPlayerMayPayment(paymentPart) !== null;
}

function isIfPlayerDoesCounter(step: OracleEffectStep): boolean {
  const raw = String((step as any).raw || '').replace(/\s+/g, ' ').trim();
  if (COUNTER_IF_PLAYER_DOES_RE.test(raw)) return true;
  if (step.kind === 'counter_spell' && /^if a player does,\s*counter\b/i.test(raw)) return true;
  return false;
}

/**
 * Merge adjacent grant_static("any player may …") + counter("If a player does…")
 * into a single any_player_may step.
 */
export function repairAnyPlayerMayTaxSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (!Array.isArray(steps) || steps.length === 0) return steps as OracleEffectStep[];

  const out: OracleEffectStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const next = steps[i + 1];

    if (next && isAnyPlayerMayGrantStatic(step) && isIfPlayerDoesCounter(next)) {
      const paymentRaw = String((step as any).raw || (step as any).effectText?.[0] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const paymentPart = paymentRaw.replace(/^any\s+player\s+may\s+/i, '');
      const payment = parseAnyPlayerMayPayment(paymentPart);
      const counterRaw = String((next as any).raw || '').replace(/\s+/g, ' ').trim();
      const counterMatch = counterRaw.match(COUNTER_IF_PLAYER_DOES_RE);
      if (payment) {
        const compoundRaw = `any player may ${describeAnyPlayerMayPayment(payment)}. ${counterRaw}`.trim();
        out.push(
          buildAnyPlayerMayStep(
            payment,
            String(counterMatch?.[1] || 'this spell'),
            compoundRaw,
          ),
        );
        i += 1;
        continue;
      }
    }

    if (step.kind === 'conditional' && Array.isArray((step as any).steps)) {
      const nested = repairAnyPlayerMayTaxSteps((step as any).steps);
      out.push(nested === (step as any).steps ? step : { ...step, steps: nested });
      continue;
    }

    out.push(step);
  }
  return out;
}

export function describeAnyPlayerMayPayment(payment: AnyPlayerMayPayment): string {
  switch (payment.kind) {
    case 'life':
      return `pay ${payment.amount} life`;
    case 'half_life_rounded_up':
      return 'pay half their life, rounded up';
    case 'discard':
      return `discard ${payment.amount} card${payment.amount === 1 ? '' : 's'}`;
    case 'sacrifice':
      return `sacrifice ${payment.what}`;
    default:
      return 'pay';
  }
}

export function resolveHalfLifeRoundedUp(lifeTotal: number): number {
  const life = Number(lifeTotal);
  if (!Number.isFinite(life) || life <= 0) return 0;
  return Math.ceil(life / 2);
}
