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
    // Also split after parenthetical sentences that end with ".)"/";)".
    // Without this, reminders like "(You may look at it any time.)" can prevent subsequent
    // sentences from being split into separate clauses.
    .split(/(?:(?<=[.;])|(?<=\.\))|(?<=;\)))\s+/)
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
    .map(p => p.replace(/[.,;]\s*$/g, '').trim())
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

  // Normalize common multiplayer phrasing variants.
  // This keeps downstream regexes small while preserving semantics for the supported step kinds.
  // Examples:
  // - "Each of your opponents draws a card." -> "Each opponent draws a card."
  // - "Your opponents lose 1 life." -> "Each opponent lose 1 life." (parser accepts both lose/loses)
  // Note: We intentionally only rewrite at the beginning of a clause.
  working = working
    .replace(/^each\s+of\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^each\s+of\s+the\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+of\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+opponents\b/i, 'each opponent')
    .replace(/^your\s+opponents\b/i, 'each opponent');

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
    const m = clause.match(
      /^(?:(you|each player|each opponent|target player|target opponent)\s+)?adds?\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*$/i
    );
    if (m) {
      const mana = String(m[2] || '').trim();
      if (mana && !/\bor\b/i.test(clause)) {
        return withMeta({ kind: 'add_mana', who: parsePlayerSelector(m[1]), mana, raw: rawClause });
      }
    }
  }

  // Scry
  {
    const m = clause.match(
      /^(?:(you|each player|each opponent|target player|target opponent)\s+)?(?:scry|scries)\s+(a|an|\d+|x|[a-z]+)\b/i
    );
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'scry', who, amount, raw: rawClause });
    }
  }

  // Surveil
  {
    const m = clause.match(
      /^(?:(you|each player|each opponent|target player|target opponent)\s+)?(?:surveil|surveils)\s+(a|an|\d+|x|[a-z]+)\b/i
    );
    if (m) {
      const who = parsePlayerSelector(m[1]);
      const amount = parseQuantity(m[2]);
      return withMeta({ kind: 'surveil', who, amount, raw: rawClause });
    }
  }

  // Discard
  {
    // Discard hand (deterministic amount)
    // Represent as a very large numeric discard so the deterministic executor can safely discard the entire hand.
    // (Executor only applies discard when hand size <= amount, so this cannot force a choice.)
    {
      const mHand = clause.match(
        /^(?:(you|each player|each opponent|target player|target opponent)\s+)?discards?\s+(?:your|their)\s+hand\b/i
      );
      if (mHand) {
        const who = parsePlayerSelector(mHand[1]);
        return withMeta({ kind: 'discard', who, amount: { kind: 'number', value: 9999 }, raw: rawClause });
      }

      const mAllInHand = clause.match(
        /^(?:(you|each player|each opponent|target player|target opponent)\s+)?discards?\s+all\s+cards?\s+in\s+(?:your|their)\s+hand\b/i
      );
      if (mAllInHand) {
        const who = parsePlayerSelector(mAllInHand[1]);
        return withMeta({ kind: 'discard', who, amount: { kind: 'number', value: 9999 }, raw: rawClause });
      }
    }

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
    const m = clause.match(
      /^(?:(you|each player|each opponent|target player|target opponent)\s+)?mill(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i
    );
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

    // "Exile <what> from <zone>" (e.g. "Exile all creature cards from your graveyard.")
    // Parse as a move_zone step so deterministic executor can handle simple non-battlefield zone moves.
    {
      const mFrom = clause.match(/^exile\s+(.+?)\s+from\s+(.+)$/i);
      if (mFrom) {
        const whatRaw = `${String(mFrom[1] || '').trim()} from ${String(mFrom[2] || '').trim()}`.trim();
        const what = parseObjectSelector(whatRaw);
        return withMeta({ kind: 'move_zone', what, to: 'exile', toRaw: 'exile', raw: rawClause });
      }
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
      const battlefieldController =
        to === 'battlefield'
          ? /\bunder\s+your\s+control\b/i.test(toRaw)
            ? ({ kind: 'you' } as const)
            : /\bunder\s+(?:its\s+owner['’]s\s+control|their\s+owners['’]\s+control|their\s+owners['’]s\s+control)\b/i.test(
                  toRaw
                )
              ? ({ kind: 'owner_of_moved_cards' } as const)
              : undefined
          : undefined;
      const entersTapped =
        to === 'battlefield' && !/\buntapped\b/i.test(toRaw) && /\btapped\b/i.test(toRaw) ? true : undefined;
      return withMeta({ kind: 'move_zone', what, to, toRaw, battlefieldController, entersTapped, raw: rawClause });
    }

    // Put ... into ... (zone moves)
    {
      const mPut = clause.match(/^put\s+(.+?)\s+into\s+(.+)$/i);
      if (mPut) {
        const what = parseObjectSelector(mPut[1]);
        const toRaw = String(mPut[2] || '').trim();
        const to = inferZoneFromDestination(toRaw);
        const battlefieldController =
          to === 'battlefield'
            ? /\bunder\s+your\s+control\b/i.test(toRaw)
              ? ({ kind: 'you' } as const)
              : /\bunder\s+(?:its\s+owner['’]s\s+control|their\s+owners['’]\s+control|their\s+owners['’]s\s+control)\b/i.test(
                    toRaw
                  )
                ? ({ kind: 'owner_of_moved_cards' } as const)
                : undefined
            : undefined;
        const entersTapped =
          to === 'battlefield' && !/\buntapped\b/i.test(toRaw) && /\btapped\b/i.test(toRaw) ? true : undefined;
        return withMeta({ kind: 'move_zone', what, to, toRaw, battlefieldController, entersTapped, raw: rawClause });
      }
    }

    // Put ... onto ... (zone moves)
    {
      const mPut = clause.match(/^put\s+(.+?)\s+onto\s+(.+)$/i);
      if (mPut) {
        const what = parseObjectSelector(mPut[1]);
        const toRaw = String(mPut[2] || '').trim();
        const to = inferZoneFromDestination(toRaw);
        const battlefieldController =
          to === 'battlefield'
            ? /\bunder\s+your\s+control\b/i.test(toRaw)
              ? ({ kind: 'you' } as const)
              : /\bunder\s+(?:its\s+owner['’]s\s+control|their\s+owners['’]\s+control|their\s+owners['’]s\s+control)\b/i.test(
                    toRaw
                  )
                ? ({ kind: 'owner_of_moved_cards' } as const)
                : undefined
            : undefined;
        const entersTapped =
          to === 'battlefield' && !/\buntapped\b/i.test(toRaw) && /\btapped\b/i.test(toRaw) ? true : undefined;
        return withMeta({ kind: 'move_zone', what, to, toRaw, battlefieldController, entersTapped, raw: rawClause });
      }
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
  if (/\bhands?\b/.test(s)) return 'hand';
  if (/\bbattlefields?\b/.test(s)) return 'battlefield';
  if (/\bgraveyards?\b/.test(s)) return 'graveyard';
  if (/\bexile\b/.test(s)) return 'exile';
  if (/\blibraries?\b/.test(s)) return 'library';
  if (/\bstacks?\b/.test(s)) return 'stack';
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

  const cleanImpulseClause = (s: string): string =>
    normalizeOracleText(String(s || ''))
      .trim()
      .replace(/^then\b\s*/i, '')
      .replace(/^if you do,\s*/i, '')
      .replace(/,+\s*$/g, '')
      .trim();

  const isIgnorableImpulseReminderClause = (clause: string): boolean => {
    let t = normalizeOracleText(String(clause || '')).trim();
    if (!t) return false;

    // Many clause splits preserve "then" as a prefix.
    t = t.replace(/^then\b\s*/i, '').trim();

    // Normalize away surrounding parentheses/brackets and trailing punctuation.
    // Many reminder sentences are formatted like "(You may ... .)".
    t = t.replace(/^[\(\[]\s*/g, '').trim();
    // Strip punctuation and closing parens in either order (".)" vs ").").
    t = t.replace(/[.!]+\s*$/g, '').trim();
    t = t.replace(/\s*[\)\]]\s*$/g, '').trim();
    t = t.replace(/[.!]+\s*$/g, '').trim();
    t = t.toLowerCase();

    // Common reminder between exile and permission:
    // "You may look at that card for as long as it remains exiled."
    // "You may look at the exiled cards for as long as they remain exiled."
    const lookAtPattern =
      /^you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards)(?: for as long as (?:it|they) remain(?:s)? exiled| at any time| any time)?\s*$/i;
    if (lookAtPattern.test(t)) return true;

    // Some impulse effects include an extra reminder about spending mana.
    // We treat it as ignorable metadata for now.
    // Examples:
    // - "You may spend mana as though it were mana of any color to cast it."
    // - "You may spend mana as though it were mana of any type to cast those spells."
    const spendManaPattern =
      /^you may spend mana as though it were mana of any (?:color|type)(?: to cast (?:it|them|that spell|those spells))?\s*$/i;
    if (spendManaPattern.test(t)) return true;

    // Some impulse effects exile multiple cards then require choosing one.
    // We don't model the choice deterministically, but we can still parse the exile + permission window.
    const chooseOnePattern = /^choose one of (?:them|those cards)(?: at random)?\s*$/i;
    if (chooseOnePattern.test(t)) return true;

    return false;
  };

  const parseImpulsePermissionClause = (
    clause: string
  ):
    | {
        readonly duration:
          | 'this_turn'
          | 'during_resolution'
          | 'until_end_of_next_turn'
          | 'until_next_turn'
          | 'until_next_upkeep'
          | 'until_next_end_step'
          | 'as_long_as_remains_exiled';
        readonly permission: 'play' | 'cast';
        readonly condition?:
          | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
          | { readonly kind: 'type'; readonly type: 'land' | 'nonland' };
      }
    | null => {
    // Second clause: permission window for playing/casting the exiled card(s).
    // We only emit an impulse step if we can confidently determine the duration.
    const normalizedClause = normalizeOracleText(clause);
    let clauseToParse = normalizedClause.trim();

    // Some templates combine the look-at reminder with the permission.
    // Example: "You may look at and play that card this turn."
    clauseToParse = clauseToParse.replace(/^you may look at and (play|cast)\b/i, 'You may $1');

    // Some templates combine a leading remains-exiled window with a look-at reminder and then the permission.
    // Example: "For as long as those cards remain exiled, you may look at them, you may cast permanent spells from among them ..."
    clauseToParse = clauseToParse
      .replace(
        /^(for as long as .*? remain(?:s)? exiled),\s*you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards),\s*/i,
        '$1, '
      )
      .replace(
        /^(as long as .*? remain(?:s)? exiled),\s*you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards),\s*/i,
        '$1, '
      );

    const objectRef =
      '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|the card they exiled this way|the cards they exiled this way)';
    const objectRefWithLimit = `(?:up to (?:a|an|\d+|x|[a-z]+) of |one of )?${objectRef}`;

    // Strip common mana-spend reminder suffix seen in oracle text.
    clauseToParse = clauseToParse
      .replace(/,?\s+and\s+mana of any type can be spent to cast (?:that|those|the exiled) spells?\s*$/i, '')
      .replace(/,?\s+and\s+mana of any type can be spent to cast (?:it|them)\s*$/i, '')
      .replace(/,?\s+and\s+mana of any type can be spent to cast that spell\s*$/i, '')
      .replace(/,?\s*mana of any type can be spent to cast (?:that|those|the exiled) spells?\s*$/i, '')
      .replace(/,?\s*mana of any type can be spent to cast (?:it|them)\s*$/i, '')
      .replace(/,?\s*mana of any type can be spent to cast that spell\s*$/i, '')
      .replace(
        /,?\s+and\s+you may spend mana as though it were mana of any (?:color|type) to cast (?:it|them|that spell|those spells)\s*$/i,
        ''
      )
      .replace(
        /,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
        ''
      );

    // Some templates use "cast any number of spells from among ...".
    // Normalize this to our simpler "cast spells from among ..." so the rest of the matcher can stay small.
    clauseToParse = clauseToParse.replace(/\bcast\s+any\s+number\s+of\s+spells\s+from\s+among\b/i, 'cast spells from among');

    let condition:
      | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
      | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
      | undefined;

    // Support: "If it's a red/nonland card, you may cast it this turn."
    // Also accept common variants.
    {
      const m = clauseToParse.match(
        /^if\s+(?:it|they|that card|those cards|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|the card they exiled this way|the cards they exiled this way)(?:\s+is|(?:'|’)s|(?:'|’)re)\s+(?:a|an)?\s*([^,]+),\s*(.*)$/i
      );
      if (m) {
        const predicate = String(m[1] || '').trim().toLowerCase();
        const rest = String(m[2] || '').trim();

        // We only model a small set of conditions (color/land/nonland). If the condition is
        // something else (e.g. a creature type/subtype/spell kind), we ignore it and still
        // parse the permission window so deterministic exile parsing continues to work.
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
        }

        clauseToParse = rest;
      }
    }

    // Strip trailing restrictions we don't model yet, e.g.
    // "... you may play it if you control a Kavu." / "... you may cast it if it's a creature spell."
    // This keeps the deterministic impulse exile parsing working.
    clauseToParse = clauseToParse.replace(/,?\s+if\b.*$/i, '').trim();

    // Re-strip "without paying ... mana cost" after dropping trailing restrictions.
    // Example:
    // "You may cast it without paying its mana cost if it's a spell with lesser mana value." ->
    // "You may cast it"
    clauseToParse = clauseToParse
      .replace(
        /,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
        ''
      )
      .trim();

    const lowerClause = clauseToParse.toLowerCase();
    let duration:
      | 'this_turn'
      | 'during_resolution'
      | 'until_end_of_next_turn'
      | 'until_next_turn'
      | 'until_next_upkeep'
      | 'until_next_end_step'
      | 'as_long_as_remains_exiled'
      | null = null;
    let permission: 'play' | 'cast' | null = null;

    // "You may play/cast that card this turn"
    {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} this turn\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }

    // "You may play/cast that card until end of turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of turn\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }

    // "You may play/cast that card until the end of turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of turn\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }

    // "You may play/cast that card"
    // Some oracle text grants the permission without an explicit duration. In practice this means
    // the action can be taken during the resolution of this ability/spell.
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'during_resolution';
      }
    }
    const amongRef =
      '(?:them|those (?:exiled )?cards(?: exiled this way)?|the exiled cards|(?:the )?cards exiled this way)';
    const restrictedSpellRef =
      '(?:an?\\s+(?:artifact|creature|noncreature|enchantment|planeswalker|instant or sorcery)\\s+)?spell';

    // "You may play lands and cast spells from among them/those cards ..."
    // We treat this as equivalent to a broad "play" permission.
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may play lands and cast spells from among ${amongRef} this turn\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'this_turn';
      }
    }

    // "You may play lands and cast spells from among ... through (the) end of (this) turn"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^you may play lands and cast spells from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = 'play';
        duration = 'this_turn';
      }
    }
    // "Through (the) end of (this) turn, you may play lands and cast spells from among ..."
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^through (?:the )?end of (?:this )?turn, you may play lands and cast spells from among ${amongRef}\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = 'play';
        duration = 'this_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may play lands and cast spells from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'this_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until (?:the )?end of (?:this )?turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'this_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until the end of your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'until_end_of_next_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until end of your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'until_end_of_next_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^until your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i'));
      if (m) {
        permission = 'play';
        duration = 'until_next_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until your next end step, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'until_next_end_step';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may play lands and cast spells from among ${amongRef} until the end of your next turn\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'until_end_of_next_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may play lands and cast spells from among ${amongRef} until end of your next turn\\s*$`, 'i')
      );
      if (m) {
        permission = 'play';
        duration = 'until_end_of_next_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until your next turn\\s*$`, 'i'));
      if (m) {
        permission = 'play';
        duration = 'until_next_turn';
      }
    }
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until your next end step\\s*$`, 'i'));
      if (m) {
        permission = 'play';
        duration = 'until_next_end_step';
      }
    }

    // "You may cast spells from among them/those cards this turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} this turn\\s*$`, 'i'));
      if (m) {
        permission = 'cast';
        duration = 'this_turn';
      }
    }

    // "You may cast spells from among them/those cards"
    // No explicit duration implies the permission is usable during the resolution of this effect.
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef}\\s*$`, 'i'));
      if (m) {
        permission = 'cast';
        duration = 'during_resolution';
      }
    }

    // "You may cast an artifact/creature/... spell from among them/those cards this turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} this turn\\s*$`, 'i'));
      if (m) {
        permission = 'cast';
        duration = 'this_turn';
      }
    }

    // "You may cast an artifact/creature/... spell from among them/those cards"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
      if (m) {
        permission = 'cast';
        duration = 'during_resolution';
      }
    }

    // "You may cast spells from among ... through (the) end of (this) turn"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may cast spells from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
      );
      if (m) {
        permission = 'cast';
        duration = 'this_turn';
      }
    }
    // "Through (the) end of (this) turn, you may cast spells from among ..."
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^through (?:the )?end of (?:this )?turn, you may cast spells from among ${amongRef}\\s*$`, 'i')
      );
      if (m) {
        permission = 'cast';
        duration = 'this_turn';
      }
    }
    // "You may cast a spell from among them/those cards this turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} this turn\\s*$`, 'i'));
      if (m) {
        permission = 'cast';
        duration = 'this_turn';
      }
    }

    // Additional common duration patterns (kept conservative). These are especially important
    // when the exile clause was parsed separately (e.g. because deterministic text intervened).

    // "Until end of turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^until end of turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }

    // "Until the end of turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until the end of turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'this_turn';
      }
    }

    // "Until the end of your next turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until the end of your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }

    // "Until end of your next turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until end of your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }

    // "Until your next turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^until your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'until_next_turn';
      }
    }

    // "Until your next upkeep, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until (?:the beginning of )?your next upkeep, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_next_upkeep';
      }
    }

    // "Until your next end step, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until your next end step, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_next_end_step';
      }
    }

    // "For/as long as <objectRef> remains exiled, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^(?:for as long as|as long as) ${objectRef} remain(?:s)? exiled, you may (play|cast) ${objectRefWithLimit}\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = m[1] as any;
        duration = 'as_long_as_remains_exiled';
      }
    }

    if (!duration) return null;
    if (!permission) return null;
    return { duration, permission, ...(condition ? { condition } : {}) };
  };

  const tryParseImpulseExileTop = (idx: number): { step: OracleEffectStep; consumed: number } | null => {
    const first = String(clauses[idx] || '').trim();
    const second = String(clauses[idx + 1] || '').trim();
    const third = String(clauses[idx + 2] || '').trim();
    const fourth = String(clauses[idx + 3] || '').trim();
    const fifth = String(clauses[idx + 4] || '').trim();
    if (!first || !second) return null;

    const cleanImpulseClause = (s: string): string =>
      normalizeOracleText(String(s || ''))
        .trim()
        .replace(/^then\b\s*/i, '')
        .replace(/^if you do,\s*/i, '')
        .replace(/,+\s*$/g, '')
        .trim();

    const normalizePossessive = (s: string): string => String(s || '').replace(/’/g, "'").trim().toLowerCase();

    // First clause: "Exile the top card(s) of your library"
    // Support both explicit quantity and the common implicit "top card".
    let amount: OracleQuantity | null = null;
    let who: OraclePlayerSelector | null = null;
    let baseConsumed = 1;
    {
      const firstClean = cleanImpulseClause(first);

      const m = firstClean.match(
        /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
      );
      if (m) {
        amount = parseQuantity(m[1]);
        const rawSrc = String(m[2] || '').trim();
        const src = normalizePossessive(rawSrc);
        if (src === 'your') who = { kind: 'you' };
        else if (src === "target player's") who = { kind: 'target_player' };
        else if (src === "target opponent's") who = { kind: 'target_opponent' };
        else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
        else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        else if (src.startsWith('each of those opponents')) who = { kind: 'unknown', raw: rawSrc };
      } else {
        const m2 = firstClean.match(
          /^exile\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m2) {
          amount = { kind: 'number', value: 1 };
          const rawSrc = String(m2[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (src.startsWith('each of those opponents')) who = { kind: 'unknown', raw: rawSrc };
        }
      }

      // Alternate subject order: "Each player exiles the top card(s) of their library."
      if (!amount) {
        const m3 = firstClean.match(
          /^(each player|each opponent|you|target player|target opponent)\s+exiles\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m3) {
          amount = parseQuantity(m3[2]);
          const src = String(m3[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }
      if (!amount) {
        const m4 = firstClean.match(
          /^(each player|each opponent|you|target player|target opponent)\s+exiles\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m4) {
          amount = { kind: 'number', value: 1 };
          const src = String(m4[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }

      // Alternate verb: "Put the top card(s) of ... library into exile"
      if (!amount) {
        const m5 = firstClean.match(
          /^put\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m5) {
          amount = parseQuantity(m5[1]);
          const rawSrc = String(m5[2] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (src.startsWith('each of those opponents')) who = { kind: 'unknown', raw: rawSrc };
        }
      }
      if (!amount) {
        const m6 = firstClean.match(
          /^put\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m6) {
          amount = { kind: 'number', value: 1 };
          const rawSrc = String(m6[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (src.startsWith('each of those opponents')) who = { kind: 'unknown', raw: rawSrc };
        }
      }

      // Subject-order with "put/puts": "Each player puts the top card(s) of their library into exile."
      if (!amount) {
        const m7 = firstClean.match(
          /^(each player|each opponent|you|target player|target opponent)\s+puts?\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m7) {
          amount = parseQuantity(m7[2]);
          const src = String(m7[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }
      if (!amount) {
        const m8 = firstClean.match(
          /^(each player|each opponent|you|target player|target opponent)\s+puts?\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m8) {
          amount = { kind: 'number', value: 1 };
          const src = String(m8[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }

      // 2-clause face-down variant:
      // "Look at the top card of <library>, then exile it face down. You may play/cast ..."
      // This shows up in oracle text for "steal"-style effects (e.g., "that player's library").
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(first);
        const secondClean = clean(second);

        const look = firstClean.match(
          /^look at the top card of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s) librar(?:y|ies)\s*$/i
        );
        const exileIt = /^(?:then\s+)?exile\s+(?:it|that card)\s+face down\s*$/i;

        if (look && exileIt.test(secondClean)) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(look[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          baseConsumed = 2;
        }
      }

      // Single-clause face-down variant:
      // "Look at the top N cards of <library> and exile those cards face down. You may play those cards ..."
      // Only supported when it deterministically exiles all looked-at cards.
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(first);

        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|each player[\'’]s|each players[\'’]|each opponent[\'’]s|each opponents[\'’]|each of your opponents[\'’]|their|his or her)';

        // Explicit quantity: "top two cards"
        const m = firstClean.match(
          new RegExp(
            `^look at the top (a|an|\\d+|x|[a-z]+) cards? of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards) face down\\s*$`,
            'i'
          )
        );
        if (m) {
          amount = parseQuantity(m[1]);
          const src = normalizePossessive(m[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        }

        // Implicit singular: "top card ... and exile it face down"
        if (!amount) {
          const m2 = firstClean.match(
            new RegExp(
              `^look at the top card of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards) face down\\s*$`,
              'i'
            )
          );
          if (m2) {
            amount = { kind: 'number', value: 1 };
            const src = normalizePossessive(m2[1]);
            if (src === 'your') who = { kind: 'you' };
            else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
            else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
            else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
            else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
            else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          }
        }
      }
    }
    if (!amount) return null;
    if (!who) return null;

    const isIgnorableImpulseReminderClause = (clause: string): boolean => {
      let t = normalizeOracleText(String(clause || '')).trim();
      if (!t) return false;

      // Many clause splits preserve "then" as a prefix.
      t = t.replace(/^then\b\s*/i, '').trim();

      // Normalize away surrounding parentheses/brackets and trailing punctuation.
      // Many reminder sentences are formatted like "(You may ... .)".
      t = t.replace(/^[\(\[]\s*/g, '').trim();
      // Strip punctuation and closing parens in either order (".)" vs ").").
      t = t.replace(/[.!]+\s*$/g, '').trim();
      t = t.replace(/\s*[\)\]]\s*$/g, '').trim();
      t = t.replace(/[.!]+\s*$/g, '').trim();
      t = t.toLowerCase();

      // Common reminder between exile and permission:
      // "You may look at that card for as long as it remains exiled."
      // "You may look at the exiled cards for as long as they remain exiled."
      const lookAtPattern =
        /^you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards)(?: for as long as (?:it|they) remain(?:s)? exiled| at any time| any time)?\s*$/i;
      if (lookAtPattern.test(t)) return true;

      // Some impulse effects include an extra reminder about spending mana.
      // We treat it as ignorable metadata for now.
      // Examples:
      // - "You may spend mana as though it were mana of any color to cast it."
      // - "You may spend mana as though it were mana of any type to cast those spells."
      const spendManaPattern =
        /^you may spend mana as though it were mana of any (?:color|type)(?: to cast (?:it|them|that spell|those spells))?\s*$/i;
      if (spendManaPattern.test(t)) return true;

      // Some impulse effects exile multiple cards then require choosing one.
      // We don't model the choice deterministically, but we can still parse the exile + permission window.
      const chooseOnePattern = /^choose one of (?:them|those cards)(?: at random)?\s*$/i;
      if (chooseOnePattern.test(t)) return true;

      return false;
    };

    const parseImpulsePermissionClause = (
      clause: string
    ):
      | {
          readonly duration:
            | 'this_turn'
            | 'during_resolution'
            | 'until_end_of_next_turn'
            | 'until_next_turn'
            | 'until_next_upkeep'
            | 'until_next_end_step'
            | 'as_long_as_remains_exiled';
          readonly permission: 'play' | 'cast';
          readonly condition?:
            | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
            | { readonly kind: 'type'; readonly type: 'land' | 'nonland' };
        }
      | null => {
      // Second clause: permission window for playing/casting the exiled card(s).
      // We only emit an impulse step if we can confidently determine the duration.
      const normalizedClause = normalizeOracleText(clause);
      let clauseToParse = normalizedClause.trim();

      // Some oracle text grants the permission to a previously mentioned player:
      // "They may play it this turn." / "That player may cast it until ..." / "That opponent may ..."
      // Normalize these into our existing "You may ..." templates.
      clauseToParse = clauseToParse
        .replace(/^(they|that player|that opponent|he or she) may\b/i, 'You may')
        .replace(/^((?:until|through)\b[^,]*,),\s*(?:they|that player|that opponent|he or she) may\b/i, '$1 you may')
        .replace(/^(during your next turn,?)\s*(?:they|that player|that opponent|he or she) may\b/i, '$1 you may')
        .replace(/^((?:for as long as|as long as)\b[^,]*,),\s*(?:they|that player|that opponent|he or she) may\b/i, '$1 you may');

      // Some templates combine the look-at reminder with the permission.
      // Example: "You may look at and play that card this turn."
      clauseToParse = clauseToParse.replace(/^you may look at and (play|cast)\b/i, 'You may $1');

      // Some templates combine a leading remains-exiled window with a look-at reminder and then the permission.
      // Example: "For as long as those cards remain exiled, you may look at them, you may cast permanent spells from among them ..."
      clauseToParse = clauseToParse
        .replace(
          /^(for as long as .*? remain(?:s)? exiled),\s*you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards),\s*/i,
          '$1, '
        )
        .replace(
          /^(as long as .*? remain(?:s)? exiled),\s*you may look at (?:that card|those cards|them|it|the exiled card|the exiled cards),\s*/i,
          '$1, '
        );

      const objectRef =
        '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|the card they exiled this way|the cards they exiled this way)';
      const objectRefWithLimit = `(?:up to (?:a|an|\d+|x|[a-z]+) of |one of )?${objectRef}`;

      // Strip common mana-spend reminder suffix seen in oracle text.
      clauseToParse = clauseToParse
        .replace(
          /,?\s+and\s+mana of any type can be spent to cast (?:that|those|the exiled) spells?\s*$/i,
          ''
        )
        .replace(/,?\s+and\s+mana of any type can be spent to cast (?:it|them)\s*$/i, '')
        .replace(/,?\s+and\s+mana of any type can be spent to cast that spell\s*$/i, '')
        .replace(/,?\s*mana of any type can be spent to cast (?:that|those|the exiled) spells?\s*$/i, '')
        .replace(/,?\s*mana of any type can be spent to cast (?:it|them)\s*$/i, '')
        .replace(/,?\s*mana of any type can be spent to cast that spell\s*$/i, '')
        .replace(
          /,?\s+and\s+you may spend mana as though it were mana of any (?:color|type) to cast (?:it|them|that spell|those spells)\s*$/i,
          ''
        )
        .replace(
          /,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
          ''
        );

      // Some templates use "cast any number of spells from among ...".
      // Normalize this to our simpler "cast spells from among ..." so the rest of the matcher can stay small.
      clauseToParse = clauseToParse.replace(
        /\bcast\s+any\s+number\s+of\s+spells\s+from\s+among\b/i,
        'cast spells from among'
      );

      let condition:
        | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
        | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
        | undefined;

      // Support: "If it's a red/nonland card, you may cast it this turn."
      // Also accept common variants.
      {
        const m = clauseToParse.match(
          /^if\s+(?:it|they|that card|those cards|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|the card they exiled this way|the cards they exiled this way)(?:\s+is|(?:'|’)s|(?:'|’)re)\s+(?:a|an)?\s*([^,]+),\s*(.*)$/i
        );
        if (m) {
          const predicate = String(m[1] || '').trim().toLowerCase();
          const rest = String(m[2] || '').trim();

          // We only model a small set of conditions (color/land/nonland). If the condition is
          // something else (e.g. a creature type/subtype/spell kind), we ignore it and still
          // parse the permission window so deterministic exile parsing continues to work.
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
          }

          clauseToParse = rest;
        }
      }

      // Strip trailing restrictions we don't model yet, e.g.
      // "... you may play it if you control a Kavu." / "... you may cast it if it's a creature spell."
      // This keeps the deterministic impulse exile parsing working.
      clauseToParse = clauseToParse.replace(/,?\s+if\b.*$/i, '').trim();

      // Re-strip "without paying ... mana cost" after dropping trailing restrictions.
      // Example:
      // "You may cast it without paying its mana cost if it's a spell with lesser mana value." ->
      // "You may cast it"
      clauseToParse = clauseToParse
        .replace(
          /,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
          ''
        )
        .trim();

      const lowerClause = clauseToParse.toLowerCase();
      let duration:
        | 'this_turn'
        | 'during_resolution'
        | 'until_end_of_next_turn'
        | 'until_next_turn'
        | 'until_next_upkeep'
        | 'until_next_end_step'
        | 'as_long_as_remains_exiled'
        | null = null;
      let permission: 'play' | 'cast' | null = null;

      // "You may play/cast that card this turn"
      {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} this turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }

      // "You may play/cast that card"
      // Some oracle text grants the permission without an explicit duration. In practice this means
      // the action can be taken during the resolution of this ability/spell.
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'during_resolution';
        }
      }
      const amongRef =
        '(?:them|those (?:exiled )?cards(?: exiled this way)?|the exiled cards|(?:the )?cards exiled this way)';
      const restrictedSpellRef = '(?:an?\\s+(?:artifact|creature|noncreature|enchantment|planeswalker|instant or sorcery)\\s+)?spell';

      // "You may play lands and cast spells from among them/those cards ..."
      // We treat this as equivalent to a broad "play" permission.
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} this turn\\s*$`, 'i'));
        if (m) {
          permission = 'play';
          duration = 'this_turn';
        }
      }

      // "You may play lands and cast spells from among ... through (the) end of (this) turn"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may play lands and cast spells from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'this_turn';
        }
      }
      // "Through (the) end of (this) turn, you may play lands and cast spells from among ..."
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^through (?:the )?end of (?:this )?turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'this_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may play lands and cast spells from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'this_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until (?:the )?end of (?:this )?turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'this_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until the end of your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until end of your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'play';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until your next end step, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'until_next_end_step';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may play lands and cast spells from among ${amongRef} until the end of your next turn\\s*$`, 'i')
        );
        if (m) {
          permission = 'play';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'play';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'play';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until your next end step\\s*$`, 'i'));
        if (m) {
          permission = 'play';
          duration = 'until_next_end_step';
        }
      }

      // "You may cast spells from among them/those cards this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} this turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }

      // "You may cast spells from among them/those cards"
      // No explicit duration implies the permission is usable during the resolution of this effect.
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'during_resolution';
        }
      }

      // "You may cast an artifact/creature/... spell from among them/those cards this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} this turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }

      // "You may cast an artifact/creature/... spell from among them/those cards"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'during_resolution';
        }
      }

      // "You may cast spells from among ... through (the) end of (this) turn"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may cast spells from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "Through (the) end of (this) turn, you may cast spells from among ..."
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^through (?:the )?end of (?:this )?turn, you may cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "You may cast a spell from among them/those cards this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} this turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }

      // "You may cast a spell from among ... through (the) end of (this) turn"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may cast a spell from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "Through (the) end of (this) turn, you may cast a spell from among ..."
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^through (?:the )?end of (?:this )?turn, you may cast a spell from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "You may cast spells from among them/those cards until end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "You may cast a spell from among them/those cards until end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }

      // Next-turn durations for "cast (a) spell(s) from among ..."
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until the end of your next turn, you may cast spells from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until the end of your next turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until the end of your next turn, you may cast a spell from among ${amongRef}\\s*$`, 'i')
        );
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of your next turn, you may cast spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of your next turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of your next turn, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until the end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until the end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until the end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_end_of_next_turn';
        }
      }

      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next turn, you may cast spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next turn, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_turn';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until your next turn\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_turn';
        }
      }

      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next end step, you may cast spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_end_step';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next end step, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_end_step';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next end step, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_end_step';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until your next end step\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_end_step';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until your next end step\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_end_step';
        }
      }
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until your next end step\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'until_next_end_step';
        }
      }

      // "During your next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^during your next turn,?\\s+you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }

      // "You may play/cast that card during your next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} during your next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "Until the end of your next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until the end of your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "Until end of turn, you may cast spells from among them/those cards"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "Until end of turn, you may cast a spell from among them/those cards"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          permission = 'cast';
          duration = 'this_turn';
        }
      }
      // "Until your next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_turn';
        }
      }
      // "Until your next end step, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next end step, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_end_step';
        }
      }

      // "Until the beginning of your next upkeep, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until the beginning of your next upkeep, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_upkeep';
        }
      }
      // "Until your next end step, each player may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until your next end step, each player may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_end_step';
        }
      }
      // "Until the end of next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until the end of next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "Until end of your next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "Until end of next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "Until end of the next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of the next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "Until the end of the turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until the end of the turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "Until the end of this turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until the end of this turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "Until the end of that turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until the end of that turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "Until the end of turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until the end of turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "Until end of turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "Until end of this turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of this turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "Until end of that turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until end of that turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card until the end of your next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card until your next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until your next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_turn';
        }
      }
      // "You may play/cast that card until your next end step"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until your next end step\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_end_step';
        }
      }
      // "Each player may play/cast that card until your next end step"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^each player may (play|cast) ${objectRefWithLimit} until your next end step\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_next_end_step';
        }
      }
      // "You may play/cast that card until the end of next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card until end of your next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of your next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card until end of next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card until end of the next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of the next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card until end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card through end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through end of turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card through end of next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through end of next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card through the end of next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through the end of next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_next_turn';
        }
      }
      // "You may play/cast that card through end of this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through end of this turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card through the end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through the end of turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card through the end of this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through the end of this turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card until end of this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of this turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }

      // "You may play/cast that card until end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card until end of that turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of that turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }

      // "You may play/cast that card until the end of the turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of the turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }

      // "You may play/cast that card until the end of turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card until the end of this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of this turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }
      // "You may play/cast that card until the end of that turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of that turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }

      // "For as long as that card remains exiled, you may play/cast it"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^for as long as ${objectRef} remain(?:s)? exiled, you may (play|cast) ${objectRefWithLimit}\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_remains_exiled';
        }
      }

      // "As long as that card remains exiled, you may play/cast it"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^as long as ${objectRef} remain(?:s)? exiled, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_remains_exiled';
        }
      }

      // "You may play/cast that card for as long as it remains exiled"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may (play|cast) ${objectRefWithLimit} for as long as (?:it|they) remain(?:s)? exiled\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_remains_exiled';
        }
      }

      // "You may play/cast that card as long as it remains exiled"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may (play|cast) ${objectRefWithLimit} as long as (?:it|they) remain(?:s)? exiled\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_remains_exiled';
        }
      }

      if (!duration) return null;
      if (!permission) return null;

      return { duration, permission, ...(condition ? { condition } : {}) };
    };

    // Allow a small number of intervening reminder/metadata clauses between the exile clause and the permission clause.
    // Be conservative: only specific known reminder/metadata clauses are skippable.
    // We scan up to 4 follow-up clauses to tolerate templates like:
    // exile -> (look reminder) -> (spend-mana reminder) -> (choose one) -> permission
    const candidateClauses = clauses
      .slice(idx + baseConsumed, idx + baseConsumed + 4)
      .map(c => String(c || '').trim())
      .filter(Boolean);
    let permissionInfo: ReturnType<typeof parseImpulsePermissionClause> | null = null;
    let consumed = 0;
    const maxIgnorableInterveningClauses = 3;
    for (let i = 0; i < candidateClauses.length; i++) {
      const cRaw = candidateClauses[i];
      const c = cleanImpulseClause(cRaw);
      const parsed = parseImpulsePermissionClause(c);
      if (parsed) {
        permissionInfo = parsed;
        consumed = baseConsumed + (i + 1);
        break;
      }

      if (i >= maxIgnorableInterveningClauses) break;
      if (!isIgnorableImpulseReminderClause(c)) {
        // As soon as we see a non-permission, non-ignorable clause, abort.
        break;
      }
    }
    if (!permissionInfo) return null;

    return {
      step: {
        kind: 'impulse_exile_top',
        who,
        amount,
        duration: permissionInfo.duration,
        permission: permissionInfo.permission,
        condition: permissionInfo.condition,
        raw: clauses
          .slice(idx, idx + consumed)
          .map(c => String(c || '').trim())
          .filter(Boolean)
          .join('. ') +
          '.',
      },
      consumed,
    };
  };

  const tryParseExileTopOnly = (idx: number): { step: OracleEffectStep; consumed: number } | null => {
    const first = String(clauses[idx] || '').trim();
    const second = String(clauses[idx + 1] || '').trim();
    if (!first) return null;

    const normalizePossessive = (s: string): string => String(s || '').replace(/’/g, "'").trim().toLowerCase();

    let amount: OracleQuantity | null = null;
    let who: OraclePlayerSelector | null = null;
    let consumed = 1;

    {
      const m = first.match(
        /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
      );
      if (m) {
        amount = parseQuantity(m[1]);
        const src = normalizePossessive(m[2]);
        if (src === 'your') who = { kind: 'you' };
        else if (src === "target player's") who = { kind: 'target_player' };
        else if (src === "target opponent's") who = { kind: 'target_opponent' };
        else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
        else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
      } else {
        const m2 = first.match(
          /^exile\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
        );
        if (m2) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(m2[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        }
      }

      if (!amount) {
        const mExilesMany = first.match(
          /^(each player|each opponent|you|target player|target opponent)\s+exiles\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (mExilesMany) {
          amount = parseQuantity(mExilesMany[2]);
          const src = String(mExilesMany[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }

      if (!amount) {
        const mExilesOne = first.match(
          /^(each player|each opponent|you|target player|target opponent)\s+exiles\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (mExilesOne) {
          amount = { kind: 'number', value: 1 };
          const src = String(mExilesOne[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }

      if (!amount) {
        const m3 = first.match(
          /^put\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m3) {
          amount = parseQuantity(m3[1]);
          const src = normalizePossessive(m3[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        }
      }
      if (!amount) {
        const m4 = first.match(
          /^put\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m4) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(m4[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        }
      }

      if (!amount) {
        const m5 = first.match(
          /^(each player|each opponent|you|target player|target opponent)\s+puts?\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m5) {
          amount = parseQuantity(m5[2]);
          const src = String(m5[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }
      if (!amount) {
        const m6 = first.match(
          /^(each player|each opponent|you|target player|target opponent)\s+puts?\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m6) {
          amount = { kind: 'number', value: 1 };
          const src = String(m6[1] || '').trim().toLowerCase();
          if (src === 'you') who = { kind: 'you' };
          else if (src === 'each player') who = { kind: 'each_player' };
          else if (src === 'each opponent') who = { kind: 'each_opponent' };
          else if (src === 'target player') who = { kind: 'target_player' };
          else if (src === 'target opponent') who = { kind: 'target_opponent' };
        }
      }

      // 2-clause face-down variant:
      // "Look at the top card of <library>, then exile it face down."
      if (!amount && second) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(first);
        const secondClean = clean(second);

        const look = firstClean.match(
          /^look at the top card of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s) librar(?:y|ies)\s*$/i
        );
        const exileIt = /^(?:then\s+)?exile\s+(?:it|that card)\s+face down\s*$/i;

        if (look && exileIt.test(secondClean)) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(look[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          consumed = 2;
        }
      }

      // Single-clause face-down variant:
      // "Look at the top N cards of <library> and exile those cards face down."
      // Only supported when it deterministically exiles all looked-at cards.
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(first);

        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|each player[\'’]s|each players[\'’]|each opponent[\'’]s|each opponents[\'’]|each of your opponents[\'’]|their|his or her)';

        const mLookMany = firstClean.match(
          new RegExp(
            `^look at the top (a|an|\\d+|x|[a-z]+) cards? of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards) face down\\s*$`,
            'i'
          )
        );
        if (mLookMany) {
          amount = parseQuantity(mLookMany[1]);
          const src = normalizePossessive(mLookMany[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        }

        if (!amount) {
          const mLookOne = firstClean.match(
            new RegExp(
              `^look at the top card of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards) face down\\s*$`,
              'i'
            )
          );
          if (mLookOne) {
            amount = { kind: 'number', value: 1 };
            const src = normalizePossessive(mLookOne[1]);
            if (src === 'your') who = { kind: 'you' };
            else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
            else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
            else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
            else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
            else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          }
        }
      }
    }

    if (!amount) return null;
    if (!who) return null;

    return {
      step: {
        kind: 'exile_top',
        who,
        amount,
        raw: clauses
          .slice(idx, idx + consumed)
          .map(c => String(c || '').trim())
          .filter(Boolean)
          .join('. ') +
          '.',
      },
      consumed,
    };
  };

  let lastCreateTokenStepIndexes: number[] | null = null;
  let pendingImpulseFromExileTop: { stepIndex: number; clauseIndex: number } | null = null;

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

    // If we previously parsed an exile_top step but couldn't parse the combined impulse
    // (because other deterministic text intervened), upgrade that exile_top into an
    // impulse_exile_top when we later encounter a matching permission clause.
    if (pendingImpulseFromExileTop) {
      const age = i - pendingImpulseFromExileTop.clauseIndex;
      if (age > 4) {
        pendingImpulseFromExileTop = null;
      } else {
        const permissionInfo = parseImpulsePermissionClause(cleanImpulseClause(clauses[i]));
        if (permissionInfo) {
          const prev: any = steps[pendingImpulseFromExileTop.stepIndex];
          if (prev && prev.kind === 'exile_top') {
            const combinedRaw = `${String(prev.raw || '').trim()} ${String(clauses[i] || '').trim()}`.trim();
            steps[pendingImpulseFromExileTop.stepIndex] = {
              kind: 'impulse_exile_top',
              who: prev.who,
              amount: prev.amount,
              duration: permissionInfo.duration,
              permission: permissionInfo.permission,
              ...(permissionInfo.condition ? { condition: permissionInfo.condition } : {}),
              ...(prev.optional ? { optional: prev.optional } : {}),
              ...(prev.sequence ? { sequence: prev.sequence } : {}),
              raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
            } as any;

            pendingImpulseFromExileTop = null;
            lastCreateTokenStepIndexes = null;
            i += 1;
            continue;
          }
          pendingImpulseFromExileTop = null;
        }
      }
    }

    const impulse = tryParseImpulseExileTop(i);
    if (impulse) {
      steps.push(impulse.step);
      lastCreateTokenStepIndexes = null;
      pendingImpulseFromExileTop = null;
      i += impulse.consumed;
      continue;
    }

    const exileTopOnly = tryParseExileTopOnly(i);
    if (exileTopOnly) {
      steps.push(exileTopOnly.step);
      lastCreateTokenStepIndexes = null;
      pendingImpulseFromExileTop = { stepIndex: steps.length - 1, clauseIndex: i };
      i += exileTopOnly.consumed;
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
