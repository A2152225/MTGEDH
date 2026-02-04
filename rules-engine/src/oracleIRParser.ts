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
      /^(?:(you|each player|each opponent|target player|target opponent)\s+)?create\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+(?:creature\s+)?token(?:s)?\b/i
    );
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      const token = String(m[3] || '').trim();
      return withMeta({ kind: 'create_token', who, amount, token, raw: rawClause });
    }
    const m2 = clause.match(/^create\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+(?:creature\s+)?token(?:s)?\b/i);
    if (m2) {
      return withMeta({ kind: 'create_token', who: { kind: 'you' }, amount: parseQuantity(m2[1]), token: String(m2[2] || '').trim(), raw: rawClause });
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
  const steps = clauses.map(parseEffectClauseToStep);

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
