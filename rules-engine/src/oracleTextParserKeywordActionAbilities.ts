import { AbilityType, type ParsedAbility } from './oracleTextParser';

export function parseKeywordActionAbility(text: string): ParsedAbility | null {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;

  const scryMatch = cleaned.match(/^scry\s+(\d+|x)$/i);
  if (scryMatch) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: `Scry ${String(scryMatch[1] || '').toUpperCase()}.`,
    };
  }

  const surveilMatch = cleaned.match(/^surveil\s+(\d+|x)$/i);
  if (surveilMatch) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: `Surveil ${String(surveilMatch[1] || '').toUpperCase()}.`,
    };
  }

  const millMatch = cleaned.match(/^mill\s+(\d+|x)$/i);
  if (millMatch) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: `Mill ${String(millMatch[1] || '').toUpperCase()} cards.`,
    };
  }

  if (/^proliferate$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Proliferate.',
    };
  }

  if (/^investigate$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Investigate.',
    };
  }

  if (/^populate$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Populate.',
    };
  }

  if (/^the ring tempts you\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'The Ring tempts you.',
    };
  }

  const bolsterMatch = cleaned.match(/^bolster\s+(\d+)$/i);
  if (bolsterMatch) {
    const amount = Number.parseInt(String(bolsterMatch[1] || '0'), 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    return {
      type: AbilityType.STATIC,
      text,
      effect:
        amount === 1
          ? 'Put a +1/+1 counter on target creature you control with the least toughness among creatures you control.'
          : `Put ${amount} +1/+1 counters on target creature you control with the least toughness among creatures you control.`,
    };
  }

  const supportMatch = cleaned.match(/^support\s+(\d+)$/i);
  if (supportMatch) {
    const amount = Number.parseInt(String(supportMatch[1] || '0'), 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    return {
      type: AbilityType.STATIC,
      text,
      effect:
        amount === 1
          ? 'Put a +1/+1 counter on up to one other target creature.'
          : `Put a +1/+1 counter on each of up to ${amount} other target creatures.`,
    };
  }

  return null;
}
