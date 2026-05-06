import { parseNumberFromText } from '../../shared/src/textUtils';
import type { OracleObjectSelector, OraclePlayerSelector, OracleQuantity } from './oracleIR';

export function normalizeOracleText(text: string): string {
  return String(text || '')
    .replace(/Ã¢â‚¬Â¢|â€¢/g, '\u2022')
    .replace(/â€™/g, "'")
    .replace(/Ã¢â‚¬â€|Ã¢â‚¬â€œ|â€”|â€“/g, '-')
    .replace(/[\u2019]/g, "'")
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/Magic:\s+The Gathering Online/g, 'Magic The Gathering Online')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

export function splitIntoClauses(line: string): string[] {
  const parts: string[] = [];

  const firstPass = String(line)
    .split(/(?:(?<=[.;])|(?<=\.\))|(?<=;\)))\s+/)
    .map(p => p.trim())
    .filter(Boolean);

  for (const p of firstPass) {
    const bulletSplit = p
      .split(/\n\s*[\u2022]\s+/)
      .map(x => x.trim())
      .filter(Boolean);

    for (const b of bulletSplit) {
      const thenSplit = b.split(/\bthen\b/i).map(x => x.trim()).filter(Boolean);
      if (thenSplit.length === 1) {
        parts.push(b);
      } else {
        for (let idx = 0; idx < thenSplit.length; idx++) {
          const chunk = thenSplit[idx];
          if (!chunk) continue;
          parts.push(idx === 0 ? chunk : `then ${chunk}`);
        }
      }
    }
  }

  return parts
    .map(p => p.replace(/[.,;]\s*$/g, '').trim())
    .filter(Boolean);
}

export function parseQuantity(raw: string | undefined): OracleQuantity {
  if (!raw) return { kind: 'unknown' };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown' };
  if (/^that$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'that' };
  if (/^that (much|many)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the difference$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the difference' };
  if (/^a\s+for\s+each\s+color\s+of\s+mana\s+spent\s+to\s+cast\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^a\s+for\s+each\s+time\s+it\s+was\s+kicked$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^1\s+for\s+each\s+creature\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^1\s+for\s+each\s+card\s+in\s+your\s+hand$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each card in your hand' };
  if (/^1\s+for\s+each\s+creature\s+on\s+the\s+battlefield$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each creature on the battlefield' };
  if (/^the number of creatures you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of artifacts you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of artifacts you control' };
  if (/^the number of lands you control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the number of lands you control' };
  if (/^the number of cards in (?:your|their) hand$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^the number of [a-z0-9 +/\-]+ counters on it$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  if (/^1\s+for\s+each\s+attacking\s+creature$/i.test(trimmed)) return { kind: 'reference_amount', raw: '1 for each attacking creature' };
  if (/^that spell'?s mana value$/i.test(trimmed)) return { kind: 'reference_amount', raw: "that spell's mana value" };
  if (/^the damage prevented this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage prevented this way' };
  if (/^the damage dealt this way$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'the damage dealt this way' };
  if (/^a\s+card\s+for\s+each\s+card\s+exiled\s+from\s+their\s+hand\s+this\s+way$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
  }
  if (/^until\s+you\s+exile\s+a\s+nonland\s+card$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'until you exile a nonland card' };
  }
  if (/^the\s+number\s+of\s+cards\s+in\s+that\s+player(?:'|â€™)?s\s+hand$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: "the number of cards in that player's hand" };
  }
  if (/^the\s+number\s+of\s+mountains\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'the number of mountains you control' };
  }
  if (/^a\s+card\s+for\s+each\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each +1/+1 counter on it' };
  }
  if (/^a\s+card\s+for\s+each\s+creature\s+you\s+control\s+with\s+power\s+4\s+or\s+greater$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each creature you control with power 4 or greater' };
  }
  if (/^a\s+card\s+for\s+each\s+Island\s+you\s+control$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a card for each Island you control' };
  if (/^a\s+for\s+each\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a for each creature card in your graveyard' };
  if (/^a\s+for\s+each\s+creature\s+that\s+died\s+this\s+turn$/i.test(trimmed)) return { kind: 'reference_amount', raw: 'a for each creature that died this turn' };
  if (/^a\s+card\s+for\s+each\s+creature\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each creature you control' };
  }
  if (/^a\s+card\s+for\s+each\s+color\s+among\s+permanents\s+you\s+control$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'a card for each color among permanents you control' };
  }
  if (/^a\s+number\s+equal\s+to\s+the\s+amount\s+of\s+mana\s+spent\s+to\s+cast\s+it$/i.test(trimmed)) {
    return { kind: 'reference_amount', raw: 'the amount of mana spent to cast it' };
  }
  if (/^the sacrificed creature'?s toughness$/i.test(trimmed)) {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'toughness' };
  }
  if (/^any number$/i.test(trimmed)) return { kind: 'any_number' };
  {
    const nonlandMvMatch = trimmed.match(/^until (?:they|you) exile a nonland card with mana value (\d+) or less$/i);
    if (nonlandMvMatch) {
      const value = Number.parseInt(String(nonlandMvMatch[1] || '0'), 10);
      if (Number.isFinite(value)) return { kind: 'until_nonland_mana_value_lte', value };
    }
  }
  if (/^x$/i.test(trimmed)) return { kind: 'x' };
  if (/^all$/i.test(trimmed)) return { kind: 'all' };
  if (/^(a|an)$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^\d+$/.test(trimmed)) return { kind: 'number', value: parseInt(trimmed, 10) };

  const maybe = parseNumberFromText(trimmed, NaN as any);
  if (typeof maybe === 'number' && Number.isFinite(maybe)) {
    return { kind: 'number', value: maybe };
  }

  return { kind: 'unknown', raw: trimmed };
}

export function isThatOwnerOrControllerSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  return /^that [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

export function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}

export function isThoseOpponentsPossessiveSource(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  return s.startsWith('each of those opponents') || s.startsWith('those opponents') || s.startsWith('all of those opponents') || s.startsWith('all those opponents');
}

export function parsePlayerSelector(raw: string | undefined): OraclePlayerSelector {
  const s = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  if (!s) return { kind: 'you' };

  if (s === 'you') return { kind: 'you' };
  if (s === 'you and that player' || s === 'you and target player') return { kind: 'you_and_target_player' };
  if (s === 'you and that opponent' || s === 'you and target opponent') return { kind: 'you_and_target_opponent' };
  if (s === 'each player') return { kind: 'each_player' };
  if (s === 'each other player') return { kind: 'each_opponent' };
  if (s === 'each opponent') return { kind: 'each_opponent' };
  if (s === 'each of your opponents') return { kind: 'each_opponent' };
  if (s === 'your opponents') return { kind: 'each_opponent' };
  if (s === 'any number of target opponents') return { kind: 'any_number_of_target_opponents' };
  if (s === 'any number of target players' || s === 'any number of target players other than that player') return { kind: 'any_number_of_target_players' };
  if (isThoseOpponentsSelector(s)) return { kind: 'each_of_those_opponents' };
  if (s === 'target player') return { kind: 'target_player' };
  if (s === 'target opponent') return { kind: 'target_opponent' };
  if (s === 'an opponent' || s === 'the opponent') return { kind: 'target_opponent' };
  if (s === 'the player') return { kind: 'target_player' };
  if (s === 'that player' || s === 'he or she' || s === 'him or her' || s === 'they') return { kind: 'target_player' };
  if (s === 'that opponent' || s === 'defending player' || s === 'the defending player') return { kind: 'target_opponent' };
  if (/^enchanted\s+[a-z0-9 -]+(?:'s)?\s+controller$/.test(s)) return { kind: 'target_player' };
  if (s === 'its controller') return { kind: 'target_player' };
  if (s === 'its owner') return { kind: 'target_player' };
  if (isThatOwnerOrControllerSelector(s)) return { kind: 'target_player' };

  return { kind: 'unknown', raw: raw ?? '' };
}

export function parseObjectSelector(text: string | undefined): OracleObjectSelector {
  const s = String(text || '').trim();
  if (!s) return { kind: 'unknown', raw: '' };
  return { kind: 'raw', text: s };
}

export function normalizeClauseForParse(clause: string): {
  clause: string;
  sequence?: 'then';
  optional?: boolean;
} {
  let working = clause.trim();
  let sequence: 'then' | undefined;
  let optional: boolean | undefined;

  working = working.replace(/^[\u2022]\s+/, '');
  working = working.replace(/^\(\s*(\{T\}\s*:\s*.+?)\s*\)?$/i, '$1');
  working = working.replace(/^\(\s*((?:look at|reveal)\s+the\s+top\s+.+?)\s*\)?$/i, '$1');

  if (/^then\b/i.test(working)) {
    sequence = 'then';
    working = working.replace(/^then\b\s*/i, '');
  }

  if (/^you\s+may\b/i.test(working)) {
    optional = true;
    working = working.replace(/^you\s+may\b\s*/i, '');
  }

  // Saga chapter lines commonly prefix the real clause with a roman numeral marker
  // like "III -", but corpus text can arrive with mojibake punctuation as well.
  // Strip the whole marker so downstream clause parsers see the action text.
  working = working.replace(/^(?:[ivxlcdm]+)\s*(?:[-?]|[^\w\s])+\s*/i, '');

  working = working
    .replace(/^\+\s*\{[^}]+\}\s*[-|]\s*/i, '')
    .replace(/^\d+\s*(?:\||[-—])\s*/i, '')
    .replace(/^\d+\+\s*\|\s*/i, '')
    .replace(/^-+\s+(?=[a-z])/i, '')
    .replace(
      /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+-\s+(?=(?:at|when|whenever|if|during|until|you|each|target|return|put|exile|draw|destroy|create|look|choose|search|investigate|populate|proliferate|surveil|scry|mill|discard|tap|untap|gain|lose|deal|counter|copy|cast|play|switch|double|roll|sacrifice)\b)/i,
      ''
    );

  working = working
    .replace(/^each\s+of\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^each\s+of\s+the\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+of\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+opponents\b/i, 'each opponent')
    .replace(/^your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+of\s+those\s+opponents\b/i, 'each of those opponents')
    .replace(/^all\s+those\s+opponents\b/i, 'each of those opponents')
    .replace(/^those\s+opponents\b/i, 'each of those opponents')
    .replace(/\b(?:the\s+)?defending player(?:'|[\u2019])s\b/gi, "target opponent's")
    .replace(/\bhim or her\b/gi, 'he or she');

  return {
    clause: working,
    ...(sequence ? { sequence } : {}),
    ...(optional ? { optional } : {}),
  };
}
