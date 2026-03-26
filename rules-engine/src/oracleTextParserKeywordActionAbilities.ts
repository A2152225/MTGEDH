import { AbilityType, type ParsedAbility } from './oracleTextParser';

function singularizeAmassSubtype(rawSubtype: string): string {
  const normalized = String(rawSubtype || '').trim();
  if (!normalized) return normalized;

  const parts = normalized.split(/\s+/g).filter(Boolean);
  if (parts.length === 0) return normalized;

  const last = parts[parts.length - 1];
  const singularLast =
    /ies$/i.test(last) ? `${last.slice(0, -3)}y` :
    /s$/i.test(last) && !/ss$/i.test(last) ? last.slice(0, -1) :
    last;

  parts[parts.length - 1] = singularLast;
  return parts.join(' ');
}

function articleForSubtype(subtype: string): 'a' | 'an' {
  return /^[aeiou]/i.test(String(subtype || '').trim()) ? 'an' : 'a';
}

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

  const fatesealMatch = cleaned.match(/^fateseal\s+(\d+|x)$/i);
  if (fatesealMatch) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: `Fateseal ${String(fatesealMatch[1] || '').toUpperCase()}.`,
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

  if (/^manifest the top card of (?:your|that player's|target player's|target opponent's) library\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: cleaned.endsWith('.') ? cleaned : `${cleaned}.`,
    };
  }

  if (/^manifest dread\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Manifest dread.',
    };
  }

  if (/^learn\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'You may discard a card. If you do, draw a card.',
    };
  }

  if (/^cloak the top card of (?:your|that player's|target player's|target opponent's) library\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: cleaned.endsWith('.') ? cleaned : `${cleaned}.`,
    };
  }

  if (/^forage\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Forage.',
    };
  }

  if (/^clash with an opponent\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Clash with an opponent.',
    };
  }

  if (/^explore\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Explore.',
    };
  }

  const timeTravelMatch = cleaned.match(/^time travel(?:\s+(\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+times?)?\.?$/i);
  if (timeTravelMatch) {
    const repeatText = String(timeTravelMatch[1] || '').trim();
    return {
      type: AbilityType.STATIC,
      text,
      effect: repeatText ? `Time travel ${repeatText} times.` : 'Time travel.',
    };
  }

  const conniveMatch = cleaned.match(/^connive(?:\s+(\d+|x))?\.?$/i);
  if (conniveMatch) {
    const amountText = String(conniveMatch[1] || '').toUpperCase();
    return {
      type: AbilityType.STATIC,
      text,
      effect: amountText ? `Connive ${amountText}.` : 'Connive.',
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

  if (/^goad target creature\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Goad target creature.',
    };
  }

  if (/^suspect target creature\.?$/i.test(cleaned)) {
    return {
      type: AbilityType.STATIC,
      text,
      effect: 'Suspect target creature.',
    };
  }

  const incubateMatch = cleaned.match(/^incubate\s+(\d+|x)\.?$/i);
  if (incubateMatch) {
    const amountText = String(incubateMatch[1] || '').toUpperCase();
    return {
      type: AbilityType.STATIC,
      text,
      effect: `Create an Incubator token with ${amountText} +1/+1 counter${amountText === '1' ? '' : 's'} on it.`,
    };
  }

  const amassMatch = cleaned.match(/^amass(?:\s+([a-z][a-z' -]*?))?\s+(\d+|x)\.?$/i);
  if (amassMatch) {
    const rawSubtype = String(amassMatch[1] || '').trim();
    const singularSubtype = singularizeAmassSubtype(rawSubtype || 'Zombie');
    const subtypeArticle = articleForSubtype(singularSubtype);
    const amountText = String(amassMatch[2] || '').toUpperCase();
    const baseEffect =
      `If you don't control an Army creature, create a 0/0 black ${singularSubtype} Army creature token. ` +
      `Choose an Army creature you control. Put ${amountText} +1/+1 counter${amountText === '1' ? '' : 's'} on that creature.`;

    return {
      type: AbilityType.STATIC,
      text,
      effect:
        rawSubtype.length > 0
          ? `${baseEffect} If it isn't ${subtypeArticle} ${singularSubtype}, it becomes ${subtypeArticle} ${singularSubtype} in addition to its other types.`
          : baseEffect,
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
