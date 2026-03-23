import { normalizeClauseForParse, normalizeOracleText, parseQuantity } from './oracleIRParserUtils';

export type CreateTokenFollowupModifier = {
  entersTapped?: true;
  withCounters?: Record<string, number>;
  grantsHaste?: 'permanent' | 'until_end_of_turn';
  grantsAbilitiesUntilEndOfTurn?: readonly string[];
  atNextEndStep?: 'sacrifice' | 'exile';
  atEndOfCombat?: 'sacrifice' | 'exile';
};

export function tryParseCreateTokenFollowupModifier(rawClause: string): CreateTokenFollowupModifier | null {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalizeOracleText(normalized.clause);
  if (!clause) return null;

  // Haste follow-up: "It/They gain(s) haste (until end of turn)."
  // Note: Oracle frequently omits duration when the objects are short-lived anyway.
  {
    const m = clause.match(
      /^(it|they|that token|those tokens|the token|the tokens)\s+gain(?:s)?\s+haste(?:\s+until\s+end\s+of\s+turn)?\s*$/i
    );
    if (m) {
      const untilEot = /\buntil\s+end\s+of\s+turn\b/i.test(clause);
      return { grantsHaste: untilEot ? 'until_end_of_turn' : 'permanent' };
    }
  }

  // Keyword follow-up: "It/They gain(s) flying and trample until end of turn."
  // Conservative: only accept a small set of well-known keyword abilities.
  {
    const m = clause.match(
      /^(it|they|that token|those tokens|the token|the tokens)\s+gain(?:s)?\s+(.+?)\s+until\s+end\s+of\s+turn\s*$/i
    );
    if (m) {
      const abilitiesRaw = String(m[2] || '').trim();
      if (!abilitiesRaw) return null;

      const allowed = new Set([
        'flying',
        'trample',
        'vigilance',
        'lifelink',
        'deathtouch',
        'reach',
        'menace',
        'hexproof',
        'indestructible',
        'first strike',
        'double strike',
        'haste',
      ]);

      // Normalize separators: "flying, trample, and haste" -> ["flying", "trample", "haste"]
      const normalizedAbilities = abilitiesRaw
        .replace(/\(.*?\)/g, ' ')
        .replace(/[.;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const parts = normalizedAbilities
        .split(/\s*,\s*|\s+and\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);

      if (parts.length === 0) return null;

      const collected: string[] = [];
      for (const p of parts) {
        const key = p.toLowerCase();
        if (!allowed.has(key)) {
          return null;
        }
        if (!collected.includes(key)) collected.push(key);
      }

      if (collected.length === 0) return null;
      return { grantsAbilitiesUntilEndOfTurn: collected };
    }
  }

  // Delayed next-end-step follow-ups commonly paired with token creation:
  // - "Sacrifice it/them at the beginning of the next end step."
  // - "Exile it/them at the beginning of the next end step."
  // - "Sacrifice/Exile it/them at end of turn." (Oracle shorthand)
  {
    const m = clause.match(
      /^(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\s*$/i
    );
    if (m) {
      const verb = String(m[1] || '').toLowerCase();
      return { atNextEndStep: verb === 'exile' ? 'exile' : 'sacrifice' };
    }

    const m2 = clause.match(
      /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step,\s*(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s*$/i
    );
    if (m2) {
      const verb = String(m2[1] || '').toLowerCase();
      return { atNextEndStep: verb === 'exile' ? 'exile' : 'sacrifice' };
    }

    const m3 = clause.match(
      /^(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s+at\s+end\s+of\s+turn\s*$/i
    );
    if (m3) {
      const verb = String(m3[1] || '').toLowerCase();
      return { atNextEndStep: verb === 'exile' ? 'exile' : 'sacrifice' };
    }

    const m4 = clause.match(
      /^at\s+(?:the\s+)?end\s+of\s+turn\s*(?:[,;\-]\s*)?\s*(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s*$/i
    );
    if (m4) {
      const verb = String(m4[1] || '').toLowerCase();
      return { atNextEndStep: verb === 'exile' ? 'exile' : 'sacrifice' };
    }

    const verb2 = clause.match(/^(sacrifice|exile)\b/i)?.[1]?.toLowerCase();
    if (verb2 && /\bnext\s+end\s+step\b/i.test(clause) && /\bat\s+the\s+beginning\b/i.test(clause)) {
      return { atNextEndStep: verb2 === 'exile' ? 'exile' : 'sacrifice' };
    }

    const verb3 = clause.match(/\b(sacrifice|exile)\b/i)?.[1]?.toLowerCase();
    if (verb3 && /^at\s+the\s+beginning\b/i.test(clause) && /\bnext\s+end\s+step\b/i.test(clause)) {
      return { atNextEndStep: verb3 === 'exile' ? 'exile' : 'sacrifice' };
    }
  }

  // End-of-combat cleanup follow-ups commonly paired with token creation:
  // - "Exile those tokens at end of combat."
  // - "Sacrifice that token at end of combat."
  // - "At end of combat, exile those tokens."
  {
    const m = clause.match(
      /^(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s+at\s+end\s+of\s+combat\s*$/i
    );
    if (m) {
      const verb = String(m[1] || '').toLowerCase();
      return { atEndOfCombat: verb === 'exile' ? 'exile' : 'sacrifice' };
    }

    const m2 = clause.match(
      /^at\s+end\s+of\s+combat,\s*(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s*$/i
    );
    if (m2) {
      const verb = String(m2[1] || '').toLowerCase();
      return { atEndOfCombat: verb === 'exile' ? 'exile' : 'sacrifice' };
    }

    const verb3 = clause.match(/\b(sacrifice|exile)\b/i)?.[1]?.toLowerCase();
    if (verb3 && /\bend\s+of\s+combat\b/i.test(clause)) {
      return { atEndOfCombat: verb3 === 'exile' ? 'exile' : 'sacrifice' };
    }
  }

  // Only treat as a follow-up modifier if the whole clause is an "enters" sentence
  // referring to the immediately previous created token(s).
  const subjectMatch = clause.match(/^(it|they|that token|those tokens|the token|the tokens)\s+enter(?:s)?\b\s*(.*)$/i);
  if (!subjectMatch) return null;

  const rest = String(subjectMatch[2] || '').trim();
  if (!rest) return null;

  const out: { entersTapped?: true; withCounters?: Record<string, number> } = {};

  if (/\battacking\b/i.test(rest)) return null;
  if (/\buntapped\b/i.test(rest)) return null;

  let countersSegment: string | undefined;
  const withCounters = ((): Record<string, number> | undefined => {
    const s = rest;
    if (!/\bwith\b/i.test(s) || !/\bcounters?\b/i.test(s)) return undefined;
    const m = s.match(/\bwith\s+(a|an|\d+|x|[a-z]+)\s+([^,.]+?)\s+counters?\s+on\s+(?:it|them)\b/i);
    if (!m) return undefined;
    countersSegment = m[0];
    if (/\bof your choice\b/i.test(m[0])) return undefined;

    const qty = parseQuantity(m[1]);
    if (qty.kind !== 'number') return undefined;
    const n = Math.max(0, qty.value | 0);
    if (n <= 0) return undefined;

    let counterType = String(m[2] || '').trim();
    if (!counterType) return undefined;
    counterType = counterType
      .replace(/\s+/g, ' ')
      .replace(/\+\s*1\s*\/\s*\+\s*1/g, '+1/+1')
      .replace(/\-\s*1\s*\/\s*\-\s*1/g, '-1/-1');
    counterType = counterType.replace(/^additional\s+/i, '');
    counterType = counterType.replace(/\bcounters?\b/gi, '').trim();
    if (!counterType) return undefined;
    return { [counterType]: n };
  })();

  if (/\btapped\b/i.test(rest)) out.entersTapped = true;
  if (withCounters) out.withCounters = withCounters;

  if (!out.entersTapped && !out.withCounters) return null;

  {
    let leftover = rest;
    if (countersSegment) leftover = leftover.replace(countersSegment, ' ');
    leftover = leftover
      .replace(/\bthe battlefield\b/gi, ' ')
      .replace(/\btapped\b/gi, ' ')
      .replace(/\band\b/gi, ' ')
      .replace(/[(),]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (leftover) return null;
  }

  return out;
}
