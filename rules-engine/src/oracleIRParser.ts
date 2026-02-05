import { parseNumberFromText } from '../../shared/src/textUtils';
import {
  type ParsedAbility,
  type OracleTextParseResult,
  parseOracleText,
} from './oracleTextParser';
import type {
  OracleEffectStep,
  OracleIRAbility,
  OracleIRResult,
  OracleObjectSelector,
  OraclePlayerSelector,
  OracleQuantity,
  OracleZone,
} from './oracleIR';

function normalizeOracleText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function splitIntoClauses(line: string): string[] {
  const parts: string[] = [];

  const firstPass = String(line)
    .split(/(?<=[.;])\s+/)
    .map(p => p.trim())
    .filter(Boolean);

  for (const p of firstPass) {
    const thenSplit = p.split(/\bthen\b/i).map(x => x.trim()).filter(Boolean);
    if (thenSplit.length === 1) {
      parts.push(p);
    } else {
      for (let idx = 0; idx < thenSplit.length; idx++) {
        const chunk = thenSplit[idx];
        if (!chunk) continue;
        parts.push(idx === 0 ? chunk : `then ${chunk}`);
      }
    }
  }

  return parts
    .map(p => p.replace(/[.;]\s*$/g, '').trim())
    .filter(Boolean);
}

function parseQuantity(raw: string | undefined): OracleQuantity {
  if (!raw) return { kind: 'unknown' };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown' };
  if (/^x$/i.test(trimmed)) return { kind: 'x' };
  if (/^(a|an)$/i.test(trimmed)) return { kind: 'number', value: 1 };
  if (/^\d+$/.test(trimmed)) return { kind: 'number', value: parseInt(trimmed, 10) };

  // Words like "two", "three", etc.
  const maybe = parseNumberFromText(trimmed, NaN as any);
  if (typeof maybe === 'number' && Number.isFinite(maybe)) {
    return { kind: 'number', value: maybe };
  }

  return { kind: 'unknown', raw: trimmed };
}

function parsePlayerSelector(raw: string | undefined): OraclePlayerSelector {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return { kind: 'you' };

  if (s === 'you') return { kind: 'you' };
  if (s === 'each player') return { kind: 'each_player' };
  if (s === 'each opponent') return { kind: 'each_opponent' };
  if (s === 'target player') return { kind: 'target_player' };
  if (s === 'target opponent') return { kind: 'target_opponent' };

  return { kind: 'unknown', raw: raw ?? '' };
}

function parseObjectSelector(text: string | undefined): OracleObjectSelector {
  const s = String(text || '').trim();
  if (!s) return { kind: 'unknown', raw: '' };
  return { kind: 'raw', text: s };
}

function normalizeClauseForParse(clause: string): {
  clause: string;
  sequence?: 'then';
  optional?: boolean;
} {
  let working = clause.trim();
  let sequence: 'then' | undefined;
  let optional: boolean | undefined;

  if (/^then\b/i.test(working)) {
    sequence = 'then';
    working = working.replace(/^then\b\s*/i, '');
  }

  // "You may ..." is common; treat as optional and strip the modal.
  if (/^you\s+may\b/i.test(working)) {
    optional = true;
    working = working.replace(/^you\s+may\b\s*/i, '');
    // Many cards then start with an imperative verb after stripping.
  }

  return { clause: working.trim(), sequence, optional };
}

function parseEffectClauseToStep(rawClause: string): OracleEffectStep {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalized.clause;
  const sequence = normalized.sequence;
  const optional = normalized.optional;

  const withMeta = <T extends OracleEffectStep>(step: T): T => {
    const out: any = { ...step };
    if (sequence) out.sequence = sequence;
    if (optional) out.optional = optional;
    return out;
  };

  const parseWithCountersFromClause = (clauseText: string): Record<string, number> | undefined => {
    const s = normalizeOracleText(clauseText);
    if (!/\bwith\b/i.test(s) || !/\bcounters?\b/i.test(s)) return undefined;

    // Conservative: only handle a single "with N <counter> counters on it/them" segment.
    // Examples:
    // - "with two +1/+1 counters on it"
    // - "with a shield counter on it"
    // - "with three oil counters on them"
    const m = s.match(/\bwith\s+(a|an|\d+|x|[a-z]+)\s+([^,.]+?)\s+counters?\s+on\s+(?:it|them)\b/i);
    if (!m) return undefined;

    // Skip clearly choice-y variants.
    if (/\bof your choice\b/i.test(m[0])) return undefined;

    const qty = parseQuantity(m[1]);
    if (qty.kind !== 'number') return undefined;
    const n = Math.max(0, qty.value | 0);
    if (n <= 0) return undefined;

    let counterType = String(m[2] || '').trim();
    if (!counterType) return undefined;

    // Normalize common +1/+1 spellings.
    counterType = counterType
      .replace(/\s+/g, ' ')
      .replace(/\+\s*1\s*\/\s*\+\s*1/g, '+1/+1')
      .replace(/\-\s*1\s*\/\s*\-\s*1/g, '-1/-1');

    // Oracle text often says "an additional <counter> counter".
    counterType = counterType.replace(/^additional\s+/i, '');

    // Drop trailing words like "counter"/"counters" if they sneak in.
    counterType = counterType.replace(/\bcounters?\b/gi, '').trim();
    if (!counterType) return undefined;

    return { [counterType]: n };
  };

  // Draw
  {
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?draws?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'draw', who, amount, raw: rawClause });
    }
    const m2 = clause.match(/^draw\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (m2) {
      return withMeta({ kind: 'draw', who: { kind: 'you' }, amount: parseQuantity(m2[1]), raw: rawClause });
    }
  }

  // Add mana (deterministic only)
  {
    // Examples: "Add {R}{R}{R}." / "Add {2}{C}." / "Add {G}."
    // We intentionally avoid parsing "Add {R} or {G}" etc. (player choice).
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?add\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*$/i);
    if (m) {
      const mana = String(m[2] || '').trim();
      if (mana && !/\bor\b/i.test(clause)) {
        return withMeta({ kind: 'add_mana', who: parsePlayerSelector(m[1]), mana, raw: rawClause });
      }
    }
  }

  // Scry
  {
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?scry\s+(a|an|\d+|x|[a-z]+)\b/i);
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'scry', who, amount, raw: rawClause });
    }
  }

  // Surveil
  {
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?surveil\s+(a|an|\d+|x|[a-z]+)\b/i);
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'surveil', who, amount, raw: rawClause });
    }
  }

  // Discard
  {
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?discards?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'discard', who, amount, raw: rawClause });
    }
    const m2 = clause.match(/^discard\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (m2) {
      return withMeta({ kind: 'discard', who: { kind: 'you' }, amount: parseQuantity(m2[1]), raw: rawClause });
    }
  }

  // Mill
  {
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?mills?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'mill', who, amount, raw: rawClause });
    }
    const m2 = clause.match(/^mill\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (m2) {
      return withMeta({ kind: 'mill', who: { kind: 'you' }, amount: parseQuantity(m2[1]), raw: rawClause });
    }
  }

  // Gain/Lose life
  {
    const gain = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?gains?\s+(\d+|x|[a-z]+)\s+life\b/i);
    if (gain) {
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(gain[1]),
        amount: parseQuantity(gain[2]),
        raw: rawClause,
      });
    }
    const gain2 = clause.match(/^gain\s+(\d+|x|[a-z]+)\s+life\b/i);
    if (gain2) {
      return withMeta({ kind: 'gain_life', who: { kind: 'you' }, amount: parseQuantity(gain2[1]), raw: rawClause });
    }

    const lose = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?loses?\s+(\d+|x|[a-z]+)\s+life\b/i);
    if (lose) {
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(lose[1]),
        amount: parseQuantity(lose[2]),
        raw: rawClause,
      });
    }
    const lose2 = clause.match(/^lose\s+(\d+|x|[a-z]+)\s+life\b/i);
    if (lose2) {
      return withMeta({ kind: 'lose_life', who: { kind: 'you' }, amount: parseQuantity(lose2[1]), raw: rawClause });
    }
  }

  // Deal damage
  {
    const m = clause.match(/^deal\s+(\d+|x|[a-z]+)\s+damage\s+to\s+(.+)$/i);
    if (m) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(m[1]),
        target: parseObjectSelector(m[2]),
        raw: rawClause,
      });
    }
    const m2 = clause.match(/^(?:it|this (?:permanent|spell))\s+deals?\s+(\d+|x|[a-z]+)\s+damage\s+to\s+(.+)$/i);
    if (m2) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(m2[1]),
        target: parseObjectSelector(m2[2]),
        raw: rawClause,
      });
    }
  }

  // Create token(s)
  {
    const m = clause.match(
      /^(?:(you|each player|each opponent|target player|target opponent)\s+)?create(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b/i
    );
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      const entersTapped = Boolean(m[3]) || /\btoken(?:s)?\s+tapped\b/i.test(clause);
      const token = String(m[4] || '').trim();
      const withCounters = parseWithCountersFromClause(clause);
      return withMeta({ kind: 'create_token', who, amount, token, entersTapped: entersTapped || undefined, withCounters, raw: rawClause });
    }
    const m2 = clause.match(/^create(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b/i);
    if (m2) {
      const entersTapped = Boolean(m2[2]) || /\btoken(?:s)?\s+tapped\b/i.test(clause);
      const withCounters = parseWithCountersFromClause(clause);
      return withMeta({ kind: 'create_token', who: { kind: 'you' }, amount: parseQuantity(m2[1]), token: String(m2[3] || '').trim(), entersTapped: entersTapped || undefined, withCounters, raw: rawClause });
    }
  }

  // Destroy / Exile
  {
    const m = clause.match(/^destroy\s+(.+)$/i);
    if (m) {
      return withMeta({ kind: 'destroy', target: parseObjectSelector(m[1]), raw: rawClause });
    }
    const m2 = clause.match(/^exile\s+(.+)$/i);
    if (m2) {
      return withMeta({ kind: 'exile', target: parseObjectSelector(m2[1]), raw: rawClause });
    }
  }

  // Sacrifice
  {
    const m = clause.match(/^(?:(you|each player|each opponent|target player|target opponent)\s+)?sacrifices?\s+(.+)$/i);
    if (m) {
      return withMeta({
        kind: 'sacrifice',
        who: parsePlayerSelector(m[1]),
        what: parseObjectSelector(m[2]),
        raw: rawClause,
      });
    }
    const m2 = clause.match(/^sacrifice\s+(.+)$/i);
    if (m2) {
      return withMeta({ kind: 'sacrifice', who: { kind: 'you' }, what: parseObjectSelector(m2[1]), raw: rawClause });
    }
  }

  // Move / Return
  {
    const m = clause.match(/^return\s+(.+?)\s+to\s+(.+)$/i);
    if (m) {
      const what = parseObjectSelector(m[1]);
      const toRaw = String(m[2] || '').trim();
      const to = inferZoneFromDestination(toRaw);
      return withMeta({ kind: 'move_zone', what, to, toRaw, raw: rawClause });
    }
  }

  return withMeta({ kind: 'unknown', raw: rawClause });
}

function tryParseMultiCreateTokensClause(rawClause: string): OracleEffectStep[] | null {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalized.clause;
  const sequence = normalized.sequence;
  const optional = normalized.optional;

  const withMeta = <T extends OracleEffectStep>(step: T, meta: { sequence?: 'then'; optional?: boolean }): T => {
    const out: any = { ...step };
    if (meta.sequence) out.sequence = meta.sequence;
    if (meta.optional) out.optional = meta.optional;
    return out;
  };

  const prefix = clause.match(
    /^(?:(you|each player|each opponent|target player|target opponent)\s+)?create(?:s)?\s+(.+)$/i
  );
  if (!prefix) return null;

  const who = parsePlayerSelector(prefix[1]);
  const rest = String(prefix[2] || '').trim();
  if (!rest) return null;

  // Detect multiple token specs in a single clause:
  // e.g. "Create a Treasure token and a Clue token." / "Create two Treasure tokens, a Food token, and a Clue token."
  // Be conservative: only accept when we can parse at least two explicit "<qty> <desc> token" segments.
  const tokenRegex =
    /\b((?:(?!and\b)(?!then\b)(?:a|an|\d+|x|[a-z]+)))\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b(\s+tapped\b)?/gi;
  const matches: { amount: OracleQuantity; token: string; entersTapped?: boolean }[] = [];

  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(rest)) !== null) {
    const amount = parseQuantity(m[1]);
    const entersTapped = Boolean(m[2]) || Boolean(m[4]);
    const token = String(m[3] || '').trim();
    if (!token) continue;
    matches.push({ amount, token, entersTapped: entersTapped || undefined });
    // Prevent runaway loops on zero-length matches.
    if (tokenRegex.lastIndex === m.index) tokenRegex.lastIndex++;
  }

  if (matches.length < 2) return null;

  // Ensure the clause is *only* a list of token creations (comma/and separators),
  // not something like "Create a Treasure token and draw a card.".
  {
    const tokenRegexForReplace = new RegExp(tokenRegex.source, 'gi');
    const leftover = String(rest)
      .replace(tokenRegexForReplace, ' ')
      .replace(/[(),]/g, ' ')
      .replace(/\b(and|then)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (leftover && /[a-z0-9]/i.test(leftover)) return null;
  }

  const steps: OracleEffectStep[] = [];
  for (let idx = 0; idx < matches.length; idx++) {
    const meta = {
      sequence: idx === 0 ? sequence : undefined,
      optional,
    };
    steps.push(
      withMeta(
        {
          kind: 'create_token',
          who,
          amount: matches[idx].amount,
          token: matches[idx].token,
          entersTapped: matches[idx].entersTapped,
          raw: rawClause,
        },
        meta
      )
    );
  }

  return steps;
}

function inferZoneFromDestination(destination: string): OracleZone {
  const s = String(destination || '').toLowerCase();
  if (/\bhand\b/.test(s)) return 'hand';
  if (/\bbattlefield\b/.test(s)) return 'battlefield';
  if (/\bgraveyard\b/.test(s)) return 'graveyard';
  if (/\bexile\b/.test(s)) return 'exile';
  if (/\blibrary\b/.test(s)) return 'library';
  if (/\bstack\b/.test(s)) return 'stack';
  if (/\bcommand\b/.test(s) || /\bcommander zone\b/.test(s)) return 'command';
  return 'unknown';
}

function abilityEffectText(ability: ParsedAbility): string {
  return String(ability.effect || ability.text || '').trim();
}

function parseAbilityToIRAbility(ability: ParsedAbility): OracleIRAbility {
  const effectText = abilityEffectText(ability);
  const clauses = splitIntoClauses(effectText);

  const steps: OracleEffectStep[] = [];

  const tryParseCreateTokenFollowupModifier = (rawClause: string): {
    entersTapped?: true;
    withCounters?: Record<string, number>;
    grantsHaste?: 'permanent' | 'until_end_of_turn';
    grantsAbilitiesUntilEndOfTurn?: readonly string[];
    atNextEndStep?: 'sacrifice' | 'exile';
    atEndOfCombat?: 'sacrifice' | 'exile';
  } | null => {
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

      // Triggered-template ordering used by many spells:
      // "At the beginning of the next end step, sacrifice/exile it/them."
      const m2 = clause.match(
        /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step,\s*(sacrifice|exile)\s+(it|them|that token|those tokens|the token|the tokens)\s*$/i
      );
      if (m2) {
        const verb = String(m2[1] || '').toLowerCase();
        return { atNextEndStep: verb === 'exile' ? 'exile' : 'sacrifice' };
      }

      // Oracle shorthand:
      // "Sacrifice/Exile it/them at end of turn." / "At end of turn, sacrifice/exile it/them."
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

      // Fallback: tolerate minor variations while staying conservative about timing.
      // Example: "Sacrifice them at the beginning of the next end step"
      const verb2 = clause.match(/^(sacrifice|exile)\b/i)?.[1]?.toLowerCase();
      if (verb2 && /\bnext\s+end\s+step\b/i.test(clause) && /\bat\s+the\s+beginning\b/i.test(clause)) {
        return { atNextEndStep: verb2 === 'exile' ? 'exile' : 'sacrifice' };
      }

      const verb3 = clause.match(/\b(sacrifice|exile)\b/i)?.[1]?.toLowerCase();
      if (verb3 && /^at\s+the\s+beginning\b/i.test(clause) && /\bnext\s+end\s+step\b/i.test(clause)) {
        // Conservatively only accept the known cleanup verbs, and only for the next end step.
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
        // Conservatively only accept known cleanup verbs and this specific timing.
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

    // Reject clearly out-of-scope variants for now (would need additional targeting/attack plumbing).
    if (/\battacking\b/i.test(rest)) return null;
    if (/\buntapped\b/i.test(rest)) return null;

    // Detect a conservative "with N <counter> counters on it/them" segment.
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

    // Tapped can appear alone or combined with counters: "tapped and with ..." / "with ... and tapped".
    if (/\btapped\b/i.test(rest)) out.entersTapped = true;
    if (withCounters) out.withCounters = withCounters;

    // If there are no modifiers, this isn't a recognized follow-up.
    if (!out.entersTapped && !out.withCounters) return null;

    // Conservativeness: ensure the rest of the clause contains only
    // "(the battlefield) tapped (and) (with ... counters on it/them)" in any order.
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
  };

  const tryParseImpulseExileTop = (idx: number): { step: OracleEffectStep; consumed: number } | null => {
    const first = String(clauses[idx] || '').trim();
    const second = String(clauses[idx + 1] || '').trim();
    if (!first || !second) return null;

    // First clause: "Exile the top card(s) of your library"
    // Support both explicit quantity and the common implicit "top card".
    let amount: OracleQuantity | null = null;
    {
      const m = first.match(/^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+your\s+library\s*$/i);
      if (m) {
        amount = parseQuantity(m[1]);
      } else if (/^exile\s+the\s+top\s+card\s+of\s+your\s+library\s*$/i.test(first)) {
        amount = { kind: 'number', value: 1 };
      }
    }
    if (!amount) return null;

    // Second clause: permission window for playing/casting the exiled card(s).
    // We only emit an impulse step if we can confidently determine the duration.
    const normalizedSecond = normalizeOracleText(second);
    let secondToParse = normalizedSecond.trim();

    let condition:
      | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
      | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
      | undefined;

    // Support: "If it's a red/nonland card, you may cast it this turn."
    // Also accept common variants like:
    // - "If that card is red, you may cast it ..."
    // - "If the exiled card is a nonland card, you may cast that card ..."
    // - (plural) "If they're nonland cards, you may cast them ..."
    // Be conservative: only accept a single simple condition we recognize.
    {
      const m = secondToParse.match(
        /^if\s+(?:it|they|that card|those cards|the exiled card)(?:\s+is|(?:'|’)s|(?:'|’)re)\s+(?:a|an)?\s*([^,]+),\s*(.*)$/i
      );
      if (m) {
        const predicate = String(m[1] || '').trim().toLowerCase();
        const rest = String(m[2] || '').trim();

        // Reject complex predicates for now.
        if (predicate.includes(' or ') || predicate.includes(' and ')) return null;

        if (predicate.includes('nonland')) {
          condition = { kind: 'type', type: 'nonland' };
        } else if (predicate.includes('land')) {
          condition = { kind: 'type', type: 'land' };
        } else {
          const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
            white: 'W',
            blue: 'U',
            black: 'B',
            red: 'R',
            green: 'G',
          };
          const colorWord = predicate.replace(/\bcard\b/g, '').trim();
          const c = colorMap[colorWord];
          if (c) condition = { kind: 'color', color: c };
          else return null;
        }

        secondToParse = rest;
      }
    }

    const lowerSecond = secondToParse.toLowerCase();
    let duration: 'this_turn' | 'until_end_of_next_turn' | null = null;
    let permission: 'play' | 'cast' | null = null;

    // "You may play/cast that card this turn"
    {
      const m = lowerSecond.match(/^you may (play|cast) (?:that card|those cards|them|it) this turn\s*$/i);
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }
    // "Until the end of your next turn, you may play/cast that card"
    if (!duration) {
      const m = lowerSecond.match(
        /^until the end of your next turn, you may (play|cast) (?:that card|those cards|them|it)\s*$/i
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }
    // "Until end of turn, you may play/cast that card"
    if (!duration) {
      const m = lowerSecond.match(/^until end of turn, you may (play|cast) (?:that card|those cards|them|it)\s*$/i);
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }
    // "You may play/cast that card until the end of your next turn"
    if (!duration) {
      const m = lowerSecond.match(
        /^you may (play|cast) (?:that card|those cards|them|it) until the end of your next turn\s*$/i
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }
    // "You may play/cast that card until end of turn"
    if (!duration) {
      const m = lowerSecond.match(/^you may (play|cast) (?:that card|those cards|them|it) until end of turn\s*$/i);
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }

    if (!duration) return null;
    if (!permission) return null;

    return {
      step: {
        kind: 'impulse_exile_top',
        who: { kind: 'you' },
        amount,
        duration,
        permission,
        condition,
        raw: `${first}. ${second}.`,
      },
      consumed: 2,
    };
  };

  let lastCreateTokenStepIndexes: number[] | null = null;

  for (let i = 0; i < clauses.length; ) {
    // Follow-up modifiers like "It enters tapped." should apply to the immediately
    // previous create_token step(s), and should not produce standalone IR steps.
    if (lastCreateTokenStepIndexes && lastCreateTokenStepIndexes.length > 0) {
      const mod = tryParseCreateTokenFollowupModifier(clauses[i]);
      if (mod) {
        for (const idx of lastCreateTokenStepIndexes) {
          const prev: any = steps[idx];
          if (!prev || prev.kind !== 'create_token') continue;
          steps[idx] = {
            ...prev,
            ...(mod.entersTapped ? { entersTapped: true } : {}),
            ...(mod.withCounters ? { withCounters: { ...(prev.withCounters || {}), ...mod.withCounters } } : {}),
            ...(mod.grantsHaste ? { grantsHaste: mod.grantsHaste } : {}),
            ...(mod.grantsAbilitiesUntilEndOfTurn
              ? {
                  grantsAbilitiesUntilEndOfTurn: Array.from(
                    new Set([...(prev.grantsAbilitiesUntilEndOfTurn || []), ...mod.grantsAbilitiesUntilEndOfTurn])
                  ),
                }
              : {}),
            ...(mod.atNextEndStep ? { atNextEndStep: mod.atNextEndStep } : {}),
            ...(mod.atEndOfCombat ? { atEndOfCombat: mod.atEndOfCombat } : {}),
          } as any;
        }
        i += 1;
        continue;
      }
    }

    const impulse = tryParseImpulseExileTop(i);
    if (impulse) {
      steps.push(impulse.step);
      lastCreateTokenStepIndexes = null;
      i += impulse.consumed;
      continue;
    }

    const multiCreate = tryParseMultiCreateTokensClause(clauses[i]);
    if (multiCreate) {
      const startIdx = steps.length;
      steps.push(...multiCreate);
      lastCreateTokenStepIndexes = Array.from({ length: multiCreate.length }, (_, off) => startIdx + off);
      i += 1;
      continue;
    }

    const next = parseEffectClauseToStep(clauses[i]);
    steps.push(next);
    lastCreateTokenStepIndexes = next.kind === 'create_token' ? [steps.length - 1] : null;
    i += 1;
  }

  return {
    type: ability.type,
    text: ability.text,
    cost: ability.cost,
    triggerCondition: ability.triggerCondition,
    effectText,
    steps,
  };
}

export function parseOracleTextToIR(oracleText: string, cardName?: string): OracleIRResult {
  const normalizedOracleText = normalizeOracleText(oracleText);
  const parsed: OracleTextParseResult = parseOracleText(normalizedOracleText, cardName);

  return {
    normalizedOracleText,
    abilities: parsed.abilities.map(parseAbilityToIRAbility),
    keywords: parsed.keywords,
  };
}
