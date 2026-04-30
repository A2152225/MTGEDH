import { parseNumberFromText } from '../../shared/src/textUtils';
import type { OracleObjectSelector, OraclePlayerSelector, OracleQuantity } from './oracleIR';

export function normalizeOracleText(text: string): string {
  return String(text || '')
    .replace(/Ã¢â‚¬Â¢|â€¢/g, '\u2022')
    .replace(/â€™/g, "'")
    .replace(/Ã¢â‚¬â€|Ã¢â‚¬â€œ|â€”|â€“/g, '-')
    .replace(/[\u2019]/g, "'")
    .replace(/[\u2212\u2013\u2014]/g, '-')
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
  if (/^that (much|many)$/i.test(trimmed)) return { kind: 'reference_amount', raw: trimmed.toLowerCase() };
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
  if (s === 'each player') return { kind: 'each_player' };
  if (s === 'each opponent') return { kind: 'each_opponent' };
  if (s === 'each of your opponents') return { kind: 'each_opponent' };
  if (s === 'your opponents') return { kind: 'each_opponent' };
  if (isThoseOpponentsSelector(s)) return { kind: 'each_of_those_opponents' };
  if (s === 'target player') return { kind: 'target_player' };
  if (s === 'target opponent') return { kind: 'target_opponent' };
  if (s === 'that player' || s === 'he or she' || s === 'him or her' || s === 'they') return { kind: 'target_player' };
  if (s === 'that opponent' || s === 'defending player' || s === 'the defending player') return { kind: 'target_opponent' };
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
    .replace(/^-+\s+(?=[a-z])/i, '')
    .replace(
      /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+-\s+(?=(?:at|when|whenever|if|during|until|you|each|target|return|put|exile|draw|destroy|create|look|choose|search|investigate|populate|proliferate|surveil|scry|mill|discard|tap|untap|gain|lose|deal)\b)/i,
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
