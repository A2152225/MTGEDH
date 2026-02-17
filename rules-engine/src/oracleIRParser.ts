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
    // Split modal bullet lists into separate clauses.
    // Example:
    // "Choose one —\n• Exile the top card ..." should yield a standalone "Exile ..." clause.
    const bulletSplit = p
      .split(/\n\s*[\u2022•]\s+/)
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
  const s = String(raw || '')
    .replace(/[’]/g, "'")
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

function isThatOwnerOrControllerSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
  return /^that [a-z0-9][a-z0-9 -]*'s (?:controller|owner)$/i.test(s);
}

function isThoseOpponentsSelector(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
  return s === 'each of those opponents' || s === 'those opponents' || s === 'all of those opponents' || s === 'all those opponents';
}

function isThoseOpponentsPossessiveSource(raw: string | undefined): boolean {
  const s = String(raw || '')
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
  return s.startsWith('each of those opponents') || s.startsWith('those opponents') || s.startsWith('all of those opponents') || s.startsWith('all those opponents');
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

  // Modal bullet lists often prefix effect lines with a bullet ("•").
  // Strip it so downstream regexes can match deterministically.
  working = working.replace(/^[\u2022•]\s+/, '');

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
    .replace(/^your\s+opponents\b/i, 'each opponent')
    .replace(/^all\s+of\s+those\s+opponents\b/i, 'each of those opponents')
    .replace(/^all\s+those\s+opponents\b/i, 'each of those opponents')
    .replace(/^those\s+opponents\b/i, 'each of those opponents')
    .replace(/\b(?:the\s+)?defending player['’]s\b/gi, "target opponent's")
    .replace(/\bhim or her\b/gi, 'he or she');

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
    const m = clause.match(/^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?draws?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
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
      /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?adds?\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*$/i
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
      /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?(?:scry|scries)\s+(a|an|\d+|x|[a-z]+)\b/i
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
      /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?(?:surveil|surveils)\s+(a|an|\d+|x|[a-z]+)\b/i
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
        /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?discards?\s+(?:your|their)\s+hand\b/i
      );
      if (mHand) {
        const who = parsePlayerSelector(mHand[1]);
        return withMeta({ kind: 'discard', who, amount: { kind: 'number', value: 9999 }, raw: rawClause });
      }

      const mAllInHand = clause.match(
        /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?discards?\s+all\s+cards?\s+in\s+(?:your|their)\s+hand\b/i
      );
      if (mAllInHand) {
        const who = parsePlayerSelector(mAllInHand[1]);
        return withMeta({ kind: 'discard', who, amount: { kind: 'number', value: 9999 }, raw: rawClause });
      }
    }

    const m = clause.match(/^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?discards?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
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
    const mUntilRevealLand = clause.match(
      /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?reveals?\s+cards?\s+from\s+the\s+top\s+of\s+(?:their|your|his or her)\s+library\s+until\s+(?:they|you)\s+reveal\s+a\s+land\s+card\b/i
    );
    if (mUntilRevealLand) {
      const who = parsePlayerSelector(mUntilRevealLand[1]);
      return withMeta({ kind: 'mill', who, amount: { kind: 'unknown', raw: 'until they reveal a land card' }, raw: rawClause });
    }

    const m = clause.match(
      /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?mill(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i
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

  // Temporary P/T modification (composable: target + base delta + duration + optional scaler)
  {
    const parseSignedPtComponent = (raw: string): { value: number; usesX: boolean } | null => {
      const s = String(raw || '').trim().toLowerCase();
      if (!s) return null;
      if (/^[+-]?x$/.test(s)) {
        return { value: s.startsWith('-') ? -1 : 1, usesX: true };
      }
      if (/^[+-]?\d+$/.test(s)) {
        return { value: parseInt(s, 10) || 0, usesX: false };
      }
      return null;
    };

    let workingClause = clause;
    let leadingCondition: any | undefined;
    const leadingIf = workingClause.match(/^if\s+([^,]+),\s*(.+)$/i);
    if (leadingIf) {
      leadingCondition = { kind: 'if', raw: String(leadingIf[1] || '').trim() };
      workingClause = String(leadingIf[2] || '').trim();
    }

    const m = workingClause.match(
      /^(?:then\s+)?(target\s+creature|the\s+creature)\s+gets\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+(.+)$/i
    );
    if (m) {
      const targetRaw = String(m[1] || '').trim().toLowerCase();
      const powerComponent = parseSignedPtComponent(String(m[2] || ''));
      const toughnessComponent = parseSignedPtComponent(String(m[3] || ''));
      if (!powerComponent || !toughnessComponent) {
        // fall through
      } else {
      let tail = normalizeOracleText(String(m[4] || ''))
        .replace(/[,.;]\s*$/g, '')
        .trim();

      if (/\buntil\s+end\s+of\s+turn\b/i.test(tail)) {
        tail = tail
          .replace(/\buntil\s+end\s+of\s+turn\b/i, '')
          .replace(/^,\s*/i, '')
          .trim();

        let scaler: any | undefined;
        let condition: any | undefined = leadingCondition;
        if (tail) {
          const mForEach = tail.match(/^for\s+each\s+(.+)$/i);
          if (mForEach) {
            const eachRaw = `for each ${String(mForEach[1] || '').trim()}`.trim();
            scaler = /^for\s+each\s+card\s+revealed\s+this\s+way$/i.test(eachRaw)
              ? { kind: 'per_revealed_this_way' }
              : { kind: 'unknown', raw: eachRaw };
          } else {
            const mIf = tail.match(/^if\s+(.+)$/i);
            if (mIf) {
              condition = { kind: 'if', raw: String(mIf[1] || '').trim() };
            } else {
              const mAsLongAs = tail.match(/^as\s+long\s+as\s+(.+)$/i);
              if (mAsLongAs) {
                condition = { kind: 'as_long_as', raw: String(mAsLongAs[1] || '').trim() };
              } else {
                const mWhere = tail.match(/^where\s+(.+)$/i);
                if (mWhere) {
                  condition = { kind: 'where', raw: String(mWhere[1] || '').trim() };
                }
              }
            }
          }
        }

        if (!tail || scaler || condition) {
          const step: any = {
            kind: 'modify_pt',
            target: targetRaw === 'the creature' ? { kind: 'equipped_creature' } : { kind: 'raw', text: 'target creature' },
            power: powerComponent.value,
            toughness: toughnessComponent.value,
            ...(powerComponent.usesX ? { powerUsesX: true } : {}),
            ...(toughnessComponent.usesX ? { toughnessUsesX: true } : {}),
            duration: 'end_of_turn',
            raw: rawClause,
          };
          if (scaler) step.scaler = scaler;
          if (condition) step.condition = condition;
          return withMeta(step as OracleEffectStep);
        }
      }
      }
    }
  }

  // Gain/Lose life
  {
    const gain = clause.match(/^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?gains?\s+(\d+|x|[a-z]+)\s+life\b/i);
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

    const lose = clause.match(/^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?loses?\s+(\d+|x|[a-z]+)\s+life\b/i);
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
      /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?create(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b/i
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
    const m = clause.match(/^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?sacrifices?\s+(.+)$/i);
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
    /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+)?create(?:s)?\s+(.+)$/i
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

function tryParseCreateTokenAndExileTopClause(rawClause: string): OracleEffectStep[] | null {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalized.clause;
  const sequence = normalized.sequence;
  const optional = normalized.optional;

  const lower = clause.toLowerCase();
  const splitNeedleCreateThenExile = ' and exile the top ';
  const splitNeedleExileThenCreate = ' and create ';
  const splitAtCreateThenExile = lower.indexOf(splitNeedleCreateThenExile);
  const splitAtExileThenCreate = lower.indexOf(splitNeedleExileThenCreate);
  if (splitAtCreateThenExile < 0 && splitAtExileThenCreate < 0) return null;

  const isCreateThenExile = splitAtCreateThenExile >= 0;
  const createPart = isCreateThenExile
    ? clause.slice(0, splitAtCreateThenExile).trim()
    : clause.slice(splitAtExileThenCreate + ' and '.length).trim();
  const exilePart = isCreateThenExile
    ? clause.slice(splitAtCreateThenExile + ' and '.length).trim()
    : clause.slice(0, splitAtExileThenCreate).trim();
  if (!createPart || !exilePart) return null;

  const created: OracleEffectStep[] | null =
    tryParseMultiCreateTokensClause(createPart) ||
    (() => {
      const step = parseEffectClauseToStep(createPart);
      return step.kind === 'create_token' ? [step] : null;
    })();
  if (!created || created.length === 0) return null;

  // We only support the exile-top portion when it is deterministic.
  const normalizePossessive = (s: string): string => String(s || '').replace(/’/g, "'").trim().toLowerCase();
  const clean = normalizeOracleText(exilePart).trim();

  let amount: OracleQuantity | null = null;
  let who: OraclePlayerSelector | null = null;

  {
    const mMany = clean.match(
      /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
    );
    if (mMany) {
      amount = parseQuantity(mMany[1]);
      const src = normalizePossessive(mMany[2]);
      if (src === 'your') who = { kind: 'you' };
      else if (src === "target player's") who = { kind: 'target_player' };
      else if (src === "target opponent's") who = { kind: 'target_opponent' };
      else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
      else if (src === "that opponent's") who = { kind: 'target_opponent' };
      else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
      else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) {
        who = { kind: 'each_opponent' };
      }
      else if (isThoseOpponentsPossessiveSource(src)) {
        who = { kind: 'each_of_those_opponents' };
      }
    }
  }

  if (!amount) {
    const mOne = clean.match(
      /^exile\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
    );
    if (mOne) {
      amount = { kind: 'number', value: 1 };
      const src = normalizePossessive(mOne[1]);
      if (src === 'your') who = { kind: 'you' };
      else if (src === "target player's") who = { kind: 'target_player' };
      else if (src === "target opponent's") who = { kind: 'target_opponent' };
      else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
      else if (src === "that opponent's") who = { kind: 'target_opponent' };
      else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
      else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) {
        who = { kind: 'each_opponent' };
      }
      else if (isThoseOpponentsPossessiveSource(src)) {
        who = { kind: 'each_of_those_opponents' };
      }
    }
  }

  if (!amount || !who) return null;

  const withMeta = <T extends OracleEffectStep>(step: T): T => {
    const out: any = { ...step };
    if (sequence) out.sequence = sequence;
    if (optional) out.optional = optional;
    return out;
  };

  const createdWithMeta = created.map((s, idx) =>
    withMeta({ ...(s as any), sequence: idx === 0 ? (sequence as any) : undefined } as any)
  );
  const exileTop = withMeta({
    kind: 'exile_top',
    who,
    amount,
    raw: clean.endsWith('.') ? clean : `${clean}.`,
  });

  // Preserve action order from the oracle text.
  return isCreateThenExile ? [...createdWithMeta, exileTop] : [exileTop, ...createdWithMeta];
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

function parseGlobalExiledWithSourceImpulsePermission(
  rawClause: string
): { readonly duration: 'as_long_as_control_source'; readonly permission: 'play' | 'cast'; readonly rawClause: string } | null {
  const normalized = normalizeOracleText(rawClause);
  if (!normalized) return null;

  let clause = normalized
    .trim()
    .replace(/^then\b\s*/i, '')
    .replace(/^once during each of your turns,?\s*/i, '')
    .replace(/,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\b/gi, '')
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!clause) return null;
  const lower = clause.toLowerCase();

  const exiledWithSourceRef =
    "(?:the )?(?:cards?|spells?) exiled with (?:this (?:creature|artifact|enchantment|planeswalker|permanent|class|saga)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',’]+)";

  // Hauken's Insight-style:
  // "Once during each of your turns, you may play a land or cast a spell from among the cards exiled with this permanent ..."
  {
    const m = lower.match(new RegExp(`^you may play a land or cast a spell from among ${exiledWithSourceRef}\\s*$`, 'i'));
    if (m) return { duration: 'as_long_as_control_source', permission: 'play', rawClause: normalized.trim() };
  }

  // General exiled-with-source permission clause (often with an optional During-your-turn prefix).
  {
    const m = lower.match(
      new RegExp(
        `^(?:during your turn,?\\s*)?(?:(?:for as long as|as long as) (?![^,]*remain(?:s)? exiled)[^,]+,\\s*)?you may (play|cast) ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'as_long_as_control_source', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // Exiled-with-source "play lands and cast spells from among ..." (treat as broad play).
  {
    const m = lower.match(new RegExp(`^(?:during your turn,?\\s*)?you may play lands and cast spells from among ${exiledWithSourceRef}\\s*$`, 'i'));
    if (m) return { duration: 'as_long_as_control_source', permission: 'play', rawClause: normalized.trim() };
  }

  return null;
}

function parseGlobalLooseImpulsePermission(
  rawClause: string
): {
  readonly duration:
    | 'this_turn'
    | 'during_resolution'
    | 'during_next_turn'
    | 'until_end_of_next_turn'
    | 'until_next_turn'
    | 'until_next_upkeep'
    | 'until_next_end_step'
    | 'until_end_of_combat_on_next_turn';
  readonly permission: 'play' | 'cast';
  readonly rawClause: string;
} | null {
  const normalized = normalizeOracleText(rawClause);
  if (!normalized) return null;

  let clause = normalized
    .trim()
    .replace(/^then\b\s*/i, '')
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!clause) return null;

  // Normalize third-person permissions into our "You may ..." templates.
  clause = clause
    .replace(/^(they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) (?:may|can)\b/i, 'You may')
    .replace(/^((?:until|through)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) (?:may|can)\b/i, '$1 you may')
    .replace(/^(during your next turn,?)\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) (?:may|can)\b/i, '$1 you may');

  // Normalize leading-duration forms into trailing-duration forms so they can reuse
  // the same duration recognizers as "You may cast ... until ..." templates.
  // Example: "Until your next turn, you may cast it." -> "You may cast it until your next turn"
  clause = clause.replace(/^((?:until|through)\b.*?)(?:,\s*|\s+)you (?:may|can)\s+(play|cast)\s+(.+)$/i, 'You may $2 $3 $1');

  // Strip unmodeled casting-cost riders so the core permission can be recognized.
  clause = clause
    .replace(/,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\b/gi, '')
    .replace(
      /,?\s+by paying\b.*\s+rather than paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();

  const lower = clause.toLowerCase();
  const permissionSubject =
    '(?:you|they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*[\'’]s (?:controller|owner))';
  const objectRef =
    '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|(?:the )?card they exiled this way|(?:the )?cards they exiled this way|(?:the )?spell they exiled this way|(?:the )?spells they exiled this way)';
  const objectRefWithLimit = `(?:up to (?:a|an|\d+|x|[a-z]+) of |one of )?${objectRef}`;

  // Leading-duration forms with explicit subject:
  // "Until your next turn, its owner may cast it."
  {
    const m = lower.match(
      new RegExp(`^(?:until|through) (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) return { duration: 'until_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the )?end of (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_end_of_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the beginning of )?(?:your|their|the) next upkeep,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_upkeep', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the beginning of )?(?:your|their|the) next end step,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_end_step', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(
        `^until (?:the )?end of combat on (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_end_of_combat_on_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(`^during (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) return { duration: 'during_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the )?end of (?:this |that )?turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'this_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card this turn"
  {
    const m = lower.match(new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} this turn\s*$`, 'i'));
    if (m) return { duration: 'this_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card until/through end of turn" (including this/that turn variants)
  {
    const m = lower.match(
      new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the )?end of (?:this |that )?turn\s*$`, 'i')
    );
    if (m) return { duration: 'this_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card during your/their next turn"
  {
    const m = lower.match(new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} during (?:your|their|the) next turn\s*$`, 'i'));
    if (m) return { duration: 'during_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card until/through end of your/their next turn"
  {
    const m = lower.match(
      new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the )?end of (?:your|their|the) next turn\s*$`, 'i')
    );
    if (m) return { duration: 'until_end_of_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card until (the) end of combat on your/their next turn"
  {
    const m = lower.match(
      new RegExp(
        `^you (?:may|can) (play|cast) ${objectRefWithLimit} until (?:the )?end of combat on (?:your|their|the) next turn\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_end_of_combat_on_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card until/through your/their next turn"
  {
    const m = lower.match(
      new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:your|their|the) next turn\s*$`, 'i')
    );
    if (m) return { duration: 'until_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card until/through (the beginning of) your/their next upkeep"
  {
    const m = lower.match(
      new RegExp(
        `^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the beginning of )?(?:your|their|the) next upkeep\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_upkeep', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card until/through (the beginning of) your/their next end step"
  {
    const m = lower.match(
      new RegExp(
        `^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the beginning of )?(?:your|their|the) next end step\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_end_step', permission: m[1] as any, rawClause: normalized.trim() };
  }

  // "You may play/cast that card" (implicit during-resolution permission)
  {
    const m = lower.match(new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit}\s*$`, 'i'));
    if (m) return { duration: 'during_resolution', permission: m[1] as any, rawClause: normalized.trim() };
  }

  return null;
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
      .replace(/^(?:the\s+)?defending player\s+may\b/i, 'that opponent may')
      .replace(/^then\b\s*/i, '')
      .replace(/^if you do,\s*/i, '')
      .replace(/^if you don[’']t,\s*/i, '')
      .replace(/^otherwise,?\s*/i, '')
      .replace(/^if you don[’']t cast (?:it|that card|the exiled card) this way,\s*/i, '')
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
    const chooseOnePattern =
      /^choose one(?: of (?:them|those cards|the exiled cards|the cards exiled this way|the cards they exiled this way))?(?: at random)?\s*$/i;
    if (chooseOnePattern.test(t)) return true;

    // Some impulse effects choose a specific exiled card before the permission clause.
    // Example: "Choose a card exiled this way." (often preceded by "then" in the source text)
    const chooseCardExiledThisWayPattern = /^choose (?:a|an|one) (?:card|spell) exiled this way\s*$/i;
    if (chooseCardExiledThisWayPattern.test(t)) return true;

    return false;
  };

  const parseImpulsePermissionClause = (
    clause: string
  ):
    | {
        readonly duration:
          | 'this_turn'
          | 'during_resolution'
          | 'during_next_turn'
          | 'until_end_of_next_turn'
          | 'until_end_of_combat_on_next_turn'
          | 'until_next_turn'
          | 'until_next_upkeep'
          | 'until_next_end_step'
          | 'as_long_as_remains_exiled'
          | 'as_long_as_control_source'
          | 'until_exile_another';
        readonly permission: 'play' | 'cast';
        readonly condition?:
          | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
          | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
          | { readonly kind: 'attacked_with'; readonly raw: string };
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
      .replace(/^(they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, 'You may')
      .replace(/^((?:until|through)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, '$1 you may')
      .replace(/^(during your next turn,?)\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, '$1 you may')
      .replace(
        /^((?:for as long as|as long as)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i,
        '$1 you may'
      );

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

    // Some templates insert a no-cost rider between the object and the duration.
    // Example: "You may play that card without paying its mana cost this turn."
    clauseToParse = clauseToParse
      .replace(/,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Normalize third-person duration phrasing into our second-person templates.
    clauseToParse = clauseToParse.replace(/\b(?:their|his or her)\s+next\s+turn\b/gi, 'your next turn');

    const objectRef =
      '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|(?:the )?card they exiled this way|(?:the )?cards they exiled this way)';
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

    // Some templates use "cast any number of <restricted> spells ...".
    // Drop the quantifier; we don't model it in IR.
    clauseToParse = clauseToParse.replace(/\bcast\s+any\s+number\s+of\s+/i, 'cast ');

    // Some templates use "cast up to N ...".
    // Drop the quantifier; we don't model it in IR.
    clauseToParse = clauseToParse.replace(/\bcast\s+up\s+to\s+(?:a|an|\d+|x|[a-z]+)\s+/i, 'cast ');

    // Many permission clauses include an extra "with mana value ..." restriction we don't model.
    // Strip it so the rest of the matcher remains conservative.
    clauseToParse = clauseToParse.replace(/\b(spells?)\s+with\s+mana\s+value\s+[^.]*?\s+from\s+among\b/gi, '$1 from among');

    let condition:
      | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
      | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
      | { readonly kind: 'attacked_with'; readonly raw: string }
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

    // Some templates use a leading conditional permission window.
    // Example: "During your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with this enchantment."
    // We don't model these conditions; strip them so the rest of the permission parsing can remain conservative.
    clauseToParse = clauseToParse.replace(/^during your turn,?\s*if\b[^,]+,\s*(you may\b)/i, 'During your turn, $1');

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

    // Strip alternative-cost riders we don't model yet.
    // Example: "You may cast that card by paying life equal to the spell’s mana value rather than paying its mana cost." ->
    // "You may cast that card"
    clauseToParse = clauseToParse
      .replace(
        /,?\s+by paying\b.*\s+rather than paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
        ''
      )
      .trim();

    // Some templates add a trailing restriction rider we don't model.
    // Example: "Until your next turn, players may play cards they exiled this way, and they can't play cards from their hand."
    clauseToParse = clauseToParse.replace(/,?\s+and\s+they\s+can(?:not|'t)\s+play\s+cards?\s+from\s+their\s+hands?\s*$/i, '').trim();

    const lowerClause = clauseToParse.toLowerCase();
    let duration:
      | 'this_turn'
      | 'during_resolution'
      | 'during_next_turn'
      | 'until_end_of_next_turn'
      | 'until_end_of_combat_on_next_turn'
      | 'until_next_turn'
      | 'until_next_upkeep'
      | 'until_next_end_step'
      | 'as_long_as_remains_exiled'
      | 'until_exile_another'
      | 'as_long_as_control_source'
      | null = null;
    let permission: 'play' | 'cast' | null = null;

    // "During any turn you attacked with a commander, you may play those cards."
    // Treat this as a remains-exiled permission window gated by an attacked-with condition.
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^during any turn you attacked with ([^,]+), you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        condition = { kind: 'attacked_with', raw: String(m[1] || '').trim() };
        permission = m[2] as any;
        duration = 'as_long_as_remains_exiled';
      }
    }

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
      '(?:(?:an?\\s+)?(?:artifact|creature|noncreature|enchantment|planeswalker|instant (?:or|and|and/or) sorcery|instant|sorcery|permanent)\\s+)?spells?';
    const colorWordRef = '(white|blue|black|red|green)';

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

    // "You may cast spells from among them/those cards for as long as they remain exiled"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^you may cast spells from among ${amongRef} (?:for as long as|as long as) (?:it|they) remain(?:s)? exiled\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = 'cast';
        duration = 'as_long_as_remains_exiled';
      }
    }

    // "You may cast red/blue/... spells from among them/those cards this turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast ${colorWordRef} spells from among ${amongRef} this turn\\s*$`, 'i'));
      if (m) {
        const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
          white: 'W',
          blue: 'U',
          black: 'B',
          red: 'R',
          green: 'G',
        };
        const c = colorMap[String(m[1] || '').trim().toLowerCase()];
        if (c) condition = { kind: 'color', color: c };
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

    // "You may cast red/blue/... spells from among them/those cards"
    // No explicit duration implies the permission is usable during the resolution of this effect.
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may cast ${colorWordRef} spells from among ${amongRef}\\s*$`, 'i'));
      if (m) {
        const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
          white: 'W',
          blue: 'U',
          black: 'B',
          red: 'R',
          green: 'G',
        };
        const c = colorMap[String(m[1] || '').trim().toLowerCase()];
        if (c) condition = { kind: 'color', color: c };
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

    // "Until end of turn, you may cast noncreature/creature/... spells from among them/those cards"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i')
      );
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

    // "You may play/cast <objectRef> until the end of your next turn"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of your next turn\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }

    // "You may play/cast <objectRef> until end of your next turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of your next turn\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }

    // "You may play/cast <objectRef> until end of next turn" (missing "your")
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of next turn\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_next_turn';
      }
    }

    // "You may play/cast <objectRef> until the end of next turn" (missing "your")
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of next turn\\s*$`, 'i'));
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

    // "Until your next turn, players may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^until your next turn, players may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
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

    // "Until end of combat on your next turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^until (?:the )?end of combat on your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_combat_on_next_turn';
      }
    }

    // "You may play/cast <objectRef> until end of combat on your next turn"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^you may (play|cast) ${objectRefWithLimit} until (?:the )?end of combat on your next turn\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_end_of_combat_on_next_turn';
      }
    }

    // "During your next turn, you may play/cast <objectRef>"
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(`^during your next turn,?\\s+you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
      );
      if (m) {
        permission = m[1] as any;
        duration = 'during_next_turn';
      }
    }

    // "You may play/cast <objectRef> during your next turn"
    if (!duration) {
      const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} during your next turn\\s*$`, 'i'));
      if (m) {
        permission = m[1] as any;
        duration = 'during_next_turn';
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

    // "You may play/cast <objectRef> for/as long as it/they remain(s) exiled"
    // Seen in real oracle text (suffix form) and is important for the pending upgrade path.
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^you may (play|cast) ${objectRefWithLimit} (?:for as long as|as long as) (?:it|they) remain(?:s)? exiled\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = m[1] as any;
        duration = 'as_long_as_remains_exiled';
      }
    }

    // "You may play/cast it for as long as you control <source>"
    // Seen in templates like Lightning, Security Sergeant.
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^you may (play|cast) ${objectRefWithLimit} (?:for as long as|as long as) you control (?:this (?:creature|artifact|enchantment|planeswalker|permanent)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',’]+)\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = m[1] as any;
        duration = 'as_long_as_control_source';
      }
    }

    // "You may play/cast it until you exile another card with this <permanent type>."
    // Seen in templates like Furious Rise / Unstable Amulet / similar.
    if (!duration) {
      const m = lowerClause.match(
        new RegExp(
          `^you may (play|cast) ${objectRefWithLimit} until you exile another card with this (?:creature|artifact|enchantment|planeswalker|permanent)\\s*$`,
          'i'
        )
      );
      if (m) {
        permission = m[1] as any;
        duration = 'until_exile_another';
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
        .replace(/^[\u2022•]\s+/g, '')
        .replace(/^(?:the\s+)?defending player\s+may\b/i, 'that opponent may')
        .replace(/^then\b\s*/i, '')
        .replace(/^if you do,\s*/i, '')
        .replace(/^if you don[’']t,\s*/i, '')
        .replace(/^otherwise,?\s*/i, '')
        .replace(/^if you don[’']t cast (?:it|that card|the exiled card) this way,\s*/i, '')
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

      // Some templates include a trailing "then choose ..." rider in the same sentence.
      // Strip it before attempting to match the exile seed.
      const firstCleanNoChoose = firstClean
        .replace(/,?\s*then\s+choose\s+(?:a|an|one)\s+(?:card|spell)\s+exiled\s+this\s+way\s*$/i, '')
        // Saga chapter markers prefix effect lines: "I —", "II —", etc.
        // Our normalizer maps em-dash to '-', so strip "I -"/"II -"/etc.
        .replace(/^(?:[ivx]+)\s*-\s+/i, '')
        // Modal mode labels and ability-word labels sometimes prefix effect lines: "Interrogate Them — Exile ..."
        // / "Mystic Arcanum — At the beginning of ...".
        // Strip a short "<Label> -" prefix only when followed by a known deterministic wrapper/seed.
        .replace(
          /^(?:[a-z0-9][a-z0-9\s'’\-.,]{0,80})\s*-\s+(?=(?:at the beginning of|when|whenever|if|exile|put|look)\b)/i,
          ''
        )
        // Wrapper used by many triggered templates.
        .replace(/^at the beginning of (?:the )?[^,]+,\s*/i, '')
        // Common prefix patterns that wrap an exile instruction inside a trigger/condition:
        // "Whenever <thing>, if <predicate>, exile ..."
        // "When/Whenever <thing>, exile ..."
        .replace(/^(?:when|whenever)\s+[^,]+,\s*/i, '')
        .replace(/^if\s+[^,]+,\s*/i, '')
        .trim();

      const m = firstCleanNoChoose.match(
        /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
      );
      if (m) {
        amount = parseQuantity(m[1]);
        const rawSrc = String(m[2] || '').trim();
        const src = normalizePossessive(rawSrc);
        if (src === 'your') who = { kind: 'you' };
        else if (src === "target player's") who = { kind: 'target_player' };
        else if (src === "target opponent's") who = { kind: 'target_opponent' };
        else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
        else if (src === "that opponent's") who = { kind: 'target_opponent' };
        else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
        else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
      } else {
        const m2 = firstCleanNoChoose.match(
          /^exile\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m2) {
          amount = { kind: 'number', value: 1 };
          const rawSrc = String(m2[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      // Variable-quantity form used by real oracle text:
      // "... exile that many cards from the top of your library."
      // We don't attempt to resolve what "that many" refers to here; represent it as an unknown quantity
      // so the impulse permission clause can still be parsed deterministically.
      if (!amount) {
        const mVar = firstCleanNoChoose.match(
          /^exile\s+that\s+many\s+cards?\s+from\s+(?:the\s+)?top\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s)\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
        );
        if (mVar) {
          amount = { kind: 'unknown', raw: 'that many' };
          const rawSrc = String(mVar[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
        }
      }

      // Alternate subject order: "Each player exiles the top card(s) of their library."
      if (!amount) {
        const m3 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m3) {
          amount = parseQuantity(m3[2]);
          who = parsePlayerSelector(m3[1]);
        }
      }
      if (!amount) {
        const m4 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m4) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(m4[1]);
        }
      }

      // Alternate verb: "Put the top card(s) of ... library into exile"
      if (!amount) {
        const m5 = firstCleanNoChoose.match(
          /^put\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m5) {
          amount = parseQuantity(m5[1]);
          const rawSrc = String(m5[2] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }
      if (!amount) {
        const m6 = firstCleanNoChoose.match(
          /^put\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|its owner['’]s|its controller['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?(?:,\s*where\s+[a-z]\s+(?:is|equals?)\s+.+)?\s*$/i
        );
        if (m6) {
          amount = { kind: 'number', value: 1 };
          const rawSrc = String(m6[1] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      // Subject-order with "put/puts": "Each player puts the top card(s) of their library into exile."
      if (!amount) {
        const m7 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m7) {
          amount = parseQuantity(m7[2]);
          who = parsePlayerSelector(m7[1]);
        }
      }
      if (!amount) {
        const m8 = firstCleanNoChoose.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m8) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(m8[1]);
        }
      }

      // Modal/third-person variant:
      // "Its controller may exile that many cards from the top of their library."
      if (!amount) {
        const m9 = firstCleanNoChoose.match(
          /^(its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)|that player|that opponent|defending player|the defending player|they|he or she)\s+may\s+exile\s+(that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+(their|his or her|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (m9) {
          amount = parseQuantity(m9[2]);
          const subj = String(m9[1] || '').trim().toLowerCase();
          if (subj === 'that player') who = { kind: 'target_player' };
          else if (subj === 'that opponent' || subj === 'defending player' || subj === 'the defending player') who = { kind: 'target_opponent' };
          else if (subj === 'its controller' || subj === 'its owner' || isThatOwnerOrControllerSelector(subj)) {
            who = { kind: 'target_player' };
          }
          else who = { kind: 'unknown', raw: String(m9[1] || '').trim() };
        }
      }

      // Variable-amount variant seen in real oracle text (corpus):
      // "(When ... ,) exile a number of/that many cards from the top of your library [equal to ...]"
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const m10 = firstCleanNoChoose.match(
          /^(?:(?:when|whenever)\s+[^,]+,\s*)?exile\s+(a number of|that many|a|an|\d+|x|[a-z]+)\s+cards?\s+from\s+the\s+top\s+of\s+your\s+library(?:\s+equal\s+to\s+[^,]+)?(?:\s+face down)?\s*$/i
        );
        if (m10) {
          const qtyRaw = String(m10[1] || '').trim().toLowerCase();
          if (qtyRaw === 'a number of') amount = { kind: 'unknown', raw: 'a number of' };
          else amount = parseQuantity(qtyRaw);
          who = { kind: 'you' };
        }
      }

      // Exile-until variant seen in real oracle text (corpus):
      // "Exile cards from the top of your library until you exile a legendary card."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const m10b = firstCleanNoChoose.match(
          /^exile\s+cards?\s+from\s+the\s+top\s+of\s+your\s+library\s+until\s+you\s+exile\s+a\s+legendary\s+card(?:\s+face down)?\s*$/i
        );
        if (m10b) {
          amount = { kind: 'unknown', raw: 'until you exile a legendary card' };
          who = { kind: 'you' };
        }
      }

      // Exile-until variant seen in real oracle text (corpus):
      // "Target opponent exiles cards from the top of their library until they exile an instant or sorcery card."
      // "Each opponent exiles cards from the top of their library until they exile a nonland card."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const m10c = firstCleanNoChoose.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?(each player|each opponent|you|target player|target opponent|that player|that opponent|defending player|the defending player|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(?:their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (m10c) {
          const subj = String(m10c[1] || '').trim().toLowerCase();
          if (subj === 'you') who = { kind: 'you' };
          else if (subj === 'each player') who = { kind: 'each_player' };
          else if (subj === 'each opponent') who = { kind: 'each_opponent' };
          else if (subj === 'target player' || subj === 'that player') who = { kind: 'target_player' };
          else if (subj === 'target opponent' || subj === 'that opponent' || subj === 'defending player' || subj === 'the defending player') who = { kind: 'target_opponent' };
          else if (subj === 'its controller' || subj === 'its owner' || isThatOwnerOrControllerSelector(subj)) {
            who = { kind: 'target_player' };
          }
          else who = { kind: 'unknown', raw: String(m10c[1] || '').trim() };

          const untilRaw = String(m10c[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = { kind: 'unknown', raw: `until ${untilRaw}` };
        }
      }

      // Exile-until variant with implied subject (often created by our clause-splitting on "then").
      // Example (corpus: Tibalt's Trickery):
      // "... mills that many cards, then exiles cards from the top of their library until they exile ..."
      // We treat the quantity as unknown in IR and map the pronoun source to our existing selectors.
      if (!amount) {
        const m10c2 = firstCleanNoChoose.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (m10c2) {
          const src = normalizePossessive(String(m10c2[1] || '').trim());
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else who = { kind: 'unknown', raw: String(m10c2[1] || '').trim() };

          const untilRaw = String(m10c2[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = { kind: 'unknown', raw: `until ${untilRaw}` };
        }
      }

      // Variable-amount variant seen in real oracle text (corpus):
      // "Exile cards equal to <expr> from the top of <player>'s library."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|their|his or her|its owner[\'’]s|its controller[\'’]s)';
        const m11 = firstCleanNoChoose.match(
          new RegExp(
            `^exile\\s+cards?\\s+equal\\s+to\\s+(.+?)\\s+from\\s+the\\s+top\\s+of\\s+${srcPattern}\\s+library(?:\\s+face down)?\\s*$`,
            'i'
          )
        );
        if (m11) {
          amount = { kind: 'unknown', raw: `cards equal to ${String(m11[1] || '').trim()}` };
          const rawSrc = String(m11[2] || '').trim();
          const src = normalizePossessive(rawSrc);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
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

        const lookMany = firstClean.match(
          /^look at the top (a|an|\d+|x|[a-z]+) cards? of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’]) librar(?:y|ies)\s*$/i
        );
        const look = firstClean.match(
          /^look at the top card of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’]) librar(?:y|ies)\s*$/i
        );
        const exileIt = /^(?:then\s+)?exile\s+(?:it|that card|them|those cards|the cards)(?:\s+face down)?\s*$/i;

        if ((lookMany || look) && exileIt.test(secondClean)) {
          amount = lookMany ? parseQuantity(lookMany[1]) : { kind: 'number', value: 1 };
          const src = normalizePossessive((lookMany ? lookMany[2] : look[1]) as string);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
          baseConsumed = 2;
        }
      }

      // Single-clause look+exile variant:
      // "Look at the top N cards of <library> and exile those cards (face down). You may play those cards ..."
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
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|each player[\'’]s|each players[\'’]|each opponent[\'’]s|each opponents[\'’]|each of your opponents[\'’]|each of those opponents[\'’]|those opponents[\'’]|all of those opponents[\'’]|all those opponents[\'’]|their|his or her)';

        // Explicit quantity: "top two cards"
        const m = firstClean.match(
          new RegExp(
            `^look at the top (a|an|\\d+|x|[a-z]+) cards? of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards)(?: face down)?\\s*$`,
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
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }

        // Implicit singular: "top card ... and exile it (face down)"
        if (!amount) {
          const m2 = firstClean.match(
            new RegExp(
              `^look at the top card of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards)(?: face down)?\\s*$`,
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
            else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
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
      const chooseOnePattern =
        /^choose one(?: of (?:them|those cards|the exiled cards|the cards exiled this way|the cards they exiled this way))?(?: at random)?\s*$/i;
      if (chooseOnePattern.test(t)) return true;

      // Some impulse effects choose a specific exiled card before the permission clause.
      const chooseCardExiledThisWayPattern = /^choose (?:a|an|one) (?:card|spell) exiled this way\s*$/i;
      if (chooseCardExiledThisWayPattern.test(t)) return true;

      return false;
    };

    const parseImpulsePermissionClause = (
      clause: string
    ):
      | {
          readonly duration:
            | 'this_turn'
            | 'during_resolution'
            | 'during_next_turn'
            | 'until_end_of_next_turn'
            | 'until_next_turn'
            | 'until_next_upkeep'
            | 'until_next_end_step'
            | 'until_end_of_combat_on_next_turn'
            | 'as_long_as_remains_exiled'
            | 'as_long_as_control_source';
          readonly permission: 'play' | 'cast';
          readonly condition?:
            | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
            | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
            | { readonly kind: 'attacked_with'; readonly raw: string };
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
        .replace(/^(they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, 'You may')
        .replace(/^((?:until|through)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, '$1 you may')
        .replace(/^(during your next turn,?)\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, '$1 you may')
        .replace(/^((?:for as long as|as long as)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner)) may\b/i, '$1 you may');

      // Some templates combine the look-at reminder with the permission.
      // Example: "You may look at and play that card this turn."
      clauseToParse = clauseToParse.replace(/^you may look at and (play|cast)\b/i, 'You may $1');

      // Some templates add a per-turn usage limiter we don't currently model.
      // Example: "Once during each of your turns, you may play a land or cast a spell from among ..."
      clauseToParse = clauseToParse.replace(/^once during each of your turns,?\s*/i, '');

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

      // Some templates insert a no-cost rider between the object and the duration.
      // Example: "You may play that card without paying its mana cost this turn."
      clauseToParse = clauseToParse
        .replace(/,?\s+without paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Normalize third-person duration phrasing into our second-person templates.
      clauseToParse = clauseToParse.replace(/\b(?:their|his or her)\s+next\s+turn\b/gi, 'your next turn');

      const objectRef =
        '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|(?:the )?card they exiled this way|(?:the )?cards they exiled this way)';
      const objectRefWithLimit = `(?:up to (?:a|an|\d+|x|[a-z]+) of |one of )?${objectRef}`;

      const exiledWithSourceRef =
        "(?:the )?(?:cards?|spells?) exiled with (?:this (?:creature|artifact|enchantment|planeswalker|permanent|class|saga)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',’]+)";

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
          /,?\s+and\s+they may spend mana as though it were mana of any (?:color|type) to cast (?:it|them|that spell|those spells)\s*$/i,
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

      // Some templates use "cast any number of <restricted> spells ...".
      // Drop the quantifier; we don't model it in IR.
      clauseToParse = clauseToParse.replace(/\bcast\s+any\s+number\s+of\s+/i, 'cast ');

      // Some templates use "cast up to N ...".
      // Drop the quantifier; we don't model it in IR.
      clauseToParse = clauseToParse.replace(/\bcast\s+up\s+to\s+(?:a|an|\d+|x|[a-z]+)\s+/i, 'cast ');

      // Many permission clauses include an extra "with mana value ..." restriction we don't model.
      // Strip it so the rest of the matcher remains conservative.
      clauseToParse = clauseToParse.replace(/\b(spells?)\s+with\s+mana\s+value\s+[^.]*?\s+from\s+among\b/gi, '$1 from among');

      let condition:
        | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
        | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
        | { readonly kind: 'attacked_with'; readonly raw: string }
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

      // Some templates use a leading conditional permission window.
      // Example: "During your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with this enchantment."
      // We don't model these conditions; strip them so the rest of the permission parsing can remain conservative.
      clauseToParse = clauseToParse.replace(/^during your turn,?\s*if\b[^,]+,\s*(you may\b)/i, 'During your turn, $1');

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

      // Strip alternative-cost riders we don't model yet.
      // Example: "You may cast that card by paying life equal to the spell’s mana value rather than paying its mana cost." ->
      // "You may cast that card"
      clauseToParse = clauseToParse
        .replace(
          /,?\s+by paying\b.*\s+rather than paying (?:its|their|that spell(?:'|’)s|those spells(?:'|’)) mana costs?\.?\s*$/i,
          ''
        )
        .trim();

      // Some templates add a trailing restriction rider we don't model.
      // Example: "Until your next turn, players may play cards they exiled this way, and they can't play cards from their hand."
      clauseToParse = clauseToParse.replace(/,?\s+and\s+they\s+can(?:not|'t)\s+play\s+cards?\s+from\s+their\s+hands?\s*$/i, '').trim();

      const lowerClause = clauseToParse.toLowerCase();
      let duration:
        | 'this_turn'
        | 'during_resolution'
        | 'during_next_turn'
        | 'until_end_of_next_turn'
        | 'until_next_turn'
        | 'until_next_upkeep'
        | 'until_next_end_step'
        | 'until_end_of_combat_on_next_turn'
        | 'as_long_as_remains_exiled'
        | 'as_long_as_control_source'
        | null = null;
      let permission: 'play' | 'cast' | null = null;

      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^during any turn you attacked with ([^,]+), you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
        );
        if (m) {
          condition = { kind: 'attacked_with', raw: String(m[1] || '').trim() };
          permission = m[2] as any;
          duration = 'as_long_as_remains_exiled';
        }
      }

      // "During each player's turn, that player may play a land or cast a spell from among cards exiled with this <permanent>"
      // Seen in real oracle text for effects that continuously seed exile-top.
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^during each player's turn, that player may play a land or cast a spell from among ${exiledWithSourceRef}\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = 'play';
          duration = 'as_long_as_control_source';
        }
      }

      // "(Once during each of your turns, ...) you may play a land or cast a spell from among cards exiled with this <permanent>"
      // Seen in real oracle text for continuous exile-from-top engines. We ignore the once-per-turn limiter.
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^(?:once during each of your turns,?\\s*)?you may play a land or cast a spell from among ${exiledWithSourceRef}\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = 'play';
          duration = 'as_long_as_control_source';
        }
      }

      // "(During your turn, ...) you may play/cast cards exiled with this <permanent>"
      // Seen in real oracle text for "exile top card" engines.
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^(?:during your turn,?\\s*)?(?:(?:for as long as|as long as) (?![^,]*remain(?:s)? exiled)[^,]+,\\s*)?you may (play|cast) ${exiledWithSourceRef}\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_control_source';
        }
      }

      // "(During your turn, if <condition>, ...) you may play lands and cast spells from among cards exiled with this <permanent>"
      // Seen in real oracle text for continuous exile-from-top engines. We don't model the condition.
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^(?:during your turn,?\\s*(?:if\\b[^,]+,\\s*)?)?you may play lands and cast spells from among ${exiledWithSourceRef}\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = 'play';
          duration = 'as_long_as_control_source';
        }
      }

      // "Until end of turn, you may play/cast cards exiled with this <permanent>"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^until (?:the )?end of (?:this )?turn, you may (play|cast) ${exiledWithSourceRef}\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = m[1] as any;
          duration = 'this_turn';
        }
      }

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
      const restrictedSpellRef =
        '(?:(?:an?\\s+)?(?:artifact|creature|noncreature|enchantment|planeswalker|instant (?:or|and|and/or) sorcery|instant|sorcery|permanent)\\s+)?spells?';
      const colorWordRef = '(white|blue|black|red|green)';

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

      // "You may cast spells from among them/those cards for as long as they remain exiled"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^you may cast spells from among ${amongRef} (?:for as long as|as long as) (?:it|they) remain(?:s)? exiled\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = 'cast';
          duration = 'as_long_as_remains_exiled';
        }
      }

      // "You may cast red/blue/... spells from among them/those cards this turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${colorWordRef} spells from among ${amongRef} this turn\\s*$`, 'i'));
        if (m) {
          const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
            white: 'W',
            blue: 'U',
            black: 'B',
            red: 'R',
            green: 'G',
          };
          const c = colorMap[String(m[1] || '').trim().toLowerCase()];
          if (c) condition = { kind: 'color', color: c };
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

      // "You may cast red/blue/... spells from among them/those cards"
      // No explicit duration implies the permission is usable during the resolution of this effect.
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may cast ${colorWordRef} spells from among ${amongRef}\\s*$`, 'i'));
        if (m) {
          const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
            white: 'W',
            blue: 'U',
            black: 'B',
            red: 'R',
            green: 'G',
          };
          const c = colorMap[String(m[1] || '').trim().toLowerCase()];
          if (c) condition = { kind: 'color', color: c };
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

      // "Until end of turn, you may cast noncreature/creature/... spells from among them/those cards"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i')
        );
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
          duration = 'during_next_turn';
        }
      }

      // "You may play/cast that card during your next turn"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} during your next turn\\s*$`, 'i'));
        if (m) {
          permission = m[1] as any;
          duration = 'during_next_turn';
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

      // "Until your next turn, players may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(new RegExp(`^until your next turn, players may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
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

      // "Until end of combat on your next turn, you may play/cast that card"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^until (?:the )?end of combat on your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_combat_on_next_turn';
        }
      }

      // "You may play/cast that card until end of combat on your next turn"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(`^you may (play|cast) ${objectRefWithLimit} until (?:the )?end of combat on your next turn\\s*$`, 'i')
        );
        if (m) {
          permission = m[1] as any;
          duration = 'until_end_of_combat_on_next_turn';
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

      // "You may play/cast it for as long as you control <source>"
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^you may (play|cast) ${objectRefWithLimit} (?:for as long as|as long as) you control (?:this (?:creature|artifact|enchantment|planeswalker|permanent)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',’]+)\\s*$`,
            'i'
          )
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_control_source';
        }
      }

      // "You may play/cast it for/as long as this <permanent> remains on the battlefield"
      // Seen in real oracle text (e.g. Saga chapters).
      if (!duration) {
        const m = lowerClause.match(
          new RegExp(
            `^you may (play|cast) ${objectRefWithLimit} (?:for as long as|as long as) this (?:creature|artifact|enchantment|planeswalker|permanent|saga) remains on the battlefield\s*$`,
            'i'
          )
        );
        if (m) {
          permission = m[1] as any;
          duration = 'as_long_as_control_source';
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
        if (!permissionInfo || (permissionInfo.duration === 'during_resolution' && parsed.duration !== 'during_resolution')) {
          permissionInfo = parsed;
          consumed = baseConsumed + (i + 1);
        }
        if (parsed.duration !== 'during_resolution') break;
        continue;
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

    const normalizedFirst = normalizeClauseForParse(first);
    const normalizedSecond = second ? normalizeClauseForParse(second) : null;
    const firstToParse = String(normalizedFirst.clause || '').trim();
    const secondToParse = normalizedSecond ? String(normalizedSecond.clause || '').trim() : '';

    const normalizePossessive = (s: string): string => String(s || '').replace(/’/g, "'").trim().toLowerCase();

    let amount: OracleQuantity | null = null;
    let who: OraclePlayerSelector | null = null;
    let consumed = 1;

    {
      const m = firstToParse.match(
        /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
      );
      if (m) {
        amount = parseQuantity(m[1]);
        const src = normalizePossessive(m[2]);
        if (src === 'your') who = { kind: 'you' };
        else if (src === "target player's") who = { kind: 'target_player' };
        else if (src === "target opponent's") who = { kind: 'target_opponent' };
        else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
        else if (src === "that opponent's") who = { kind: 'target_opponent' };
        else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
        else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
        else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
      } else {
        const m2 = firstToParse.match(
          /^exile\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
        );
        if (m2) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(m2[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      if (!amount) {
        const mExilesMany = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (mExilesMany) {
          amount = parseQuantity(mExilesMany[2]);
          who = parsePlayerSelector(mExilesMany[1]);
        }
      }

      if (!amount) {
        const mExilesOne = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+exiles\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library(?:\s+face down)?\s*$/i
        );
        if (mExilesOne) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(mExilesOne[1]);
        }
      }

      if (!amount) {
        const m3 = firstToParse.match(
          /^put\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m3) {
          amount = parseQuantity(m3[1]);
          const src = normalizePossessive(m3[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }
      if (!amount) {
        const m4 = firstToParse.match(
          /^put\s+the\s+top\s+card\s+of\s+(your|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|their|his or her|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’])\s+librar(?:y|ies)\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m4) {
          amount = { kind: 'number', value: 1 };
          const src = normalizePossessive(m4[1]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === "target player's") who = { kind: 'target_player' };
          else if (src === "target opponent's") who = { kind: 'target_opponent' };
          else if (src === 'their' || src === 'his or her' || src === "that player's") who = { kind: 'target_player' };
          else if (src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }
      }

      if (!amount) {
        const m5 = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m5) {
          amount = parseQuantity(m5[2]);
          who = parsePlayerSelector(m5[1]);
        }
      }
      if (!amount) {
        const m6 = firstToParse.match(
          /^(each player|each opponent|you|target player|target opponent|defending player|the defending player)\s+puts?\s+the\s+top\s+card\s+of\s+(?:their|your)\s+library\s+into\s+exile(?:\s+face down)?\s*$/i
        );
        if (m6) {
          amount = { kind: 'number', value: 1 };
          who = parsePlayerSelector(m6[1]);
        }
      }

      // Exile-until variant seen in real oracle text (corpus):
      // "Target opponent exiles cards from the top of their library until they exile an instant or sorcery card."
      // "Each opponent exiles cards from the top of their library until they exile a nonland card."
      // We treat the quantity as unknown in IR.
      if (!amount) {
        const mUntil = firstToParse.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?(each player|each opponent|each of those opponents|those opponents|all of those opponents|all those opponents|you|target player|target opponent|that player|that opponent|defending player|the defending player|its controller|its owner|that [a-z0-9][a-z0-9 -]*['’]s (?:controller|owner))\s+exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(?:their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (mUntil) {
          const subj = String(mUntil[1] || '').trim().toLowerCase();
          if (subj === 'you') who = { kind: 'you' };
          else if (subj === 'each player') who = { kind: 'each_player' };
          else if (subj === 'each opponent') who = { kind: 'each_opponent' };
          else if (isThoseOpponentsSelector(subj)) who = { kind: 'each_of_those_opponents' };
          else if (subj === 'target player' || subj === 'that player') who = { kind: 'target_player' };
          else if (subj === 'target opponent' || subj === 'that opponent' || subj === 'defending player' || subj === 'the defending player') who = { kind: 'target_opponent' };
          else if (subj === 'its controller' || subj === 'its owner' || isThatOwnerOrControllerSelector(subj)) {
            who = { kind: 'target_player' };
          }
          else who = { kind: 'unknown', raw: String(mUntil[1] || '').trim() };

          const untilRaw = String(mUntil[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = { kind: 'unknown', raw: `until ${untilRaw}` };
        }
      }

      // Exile-until variant with implied subject (often created by our clause-splitting on "then").
      // Example (corpus: Tibalt's Trickery):
      // "... mills that many cards, then exiles cards from the top of their library until they exile ..."
      if (!amount) {
        const mUntilImplied = firstToParse.match(
          /^(?:(?:when|whenever|if)\s+[^,]+,\s*)?exiles?\s+cards?\s+from\s+the\s+top\s+of\s+(their|your|his or her)\s+library\s+until\s+(.+?)(?:\s+face down)?\s*$/i
        );
        if (mUntilImplied) {
          const src = normalizePossessive(String(mUntilImplied[1] || '').trim());
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else who = { kind: 'unknown', raw: String(mUntilImplied[1] || '').trim() };

          const untilRaw = String(mUntilImplied[2] || '')
            .trim()
            .replace(/[,;]\s*then\b.*$/i, '')
            .replace(/\s+then\b.*$/i, '')
            .trim();

          amount = { kind: 'unknown', raw: `until ${untilRaw}` };
        }
      }

      // 2-clause face-down variant:
      // "Look at the top card(s) of <library>, then exile it/those cards face down."
      if (!amount && second) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(firstToParse);
        const secondClean = clean(secondToParse);

        const look = firstClean.match(
          /^look at the top (?:(a|an|\d+|x|[a-z]+) cards?|card) of (your|their|his or her|target player['’]s|target opponent['’]s|that player['’]s|that opponent['’]s|each player['’]s|each players['’]|each opponent['’]s|each opponents['’]|each of your opponents['’]|each of those opponents['’]|those opponents['’]|all of those opponents['’]|all those opponents['’]) librar(?:y|ies)\s*$/i
        );
        const exileIt = /^(?:then\s+)?exile\s+(?:it|that card|them|those cards|the cards)(?:\s+face down)?\s*$/i;

        if (look && exileIt.test(secondClean)) {
          amount = look[1] ? parseQuantity(look[1]) : { kind: 'number', value: 1 };
          const src = normalizePossessive(look[2]);
          if (src === 'your') who = { kind: 'you' };
          else if (src === 'their' || src === 'his or her') who = { kind: 'target_player' };
          else if (src === "target player's" || src === "that player's") who = { kind: 'target_player' };
          else if (src === "target opponent's" || src === "that opponent's") who = { kind: 'target_opponent' };
          else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
          else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) who = { kind: 'each_opponent' };
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
          consumed = 2;
        }
      }

      // Single-clause look+exile variant:
      // "Look at the top N cards of <library> and exile those cards (face down)."
      // Only supported when it deterministically exiles all looked-at cards.
      if (!amount) {
        const clean = (s: string): string =>
          normalizeOracleText(String(s || ''))
            .trim()
            .replace(/^then\b\s*/i, '')
            .replace(/,+\s*$/g, '')
            .trim();
        const firstClean = clean(firstToParse);

        const srcPattern =
          '(your|target player[\'’]s|target opponent[\'’]s|that player[\'’]s|that opponent[\'’]s|each player[\'’]s|each players[\'’]|each opponent[\'’]s|each opponents[\'’]|each of your opponents[\'’]|each of those opponents[\'’]|those opponents[\'’]|all of those opponents[\'’]|all those opponents[\'’]|their|his or her)';

        const mLookMany = firstClean.match(
          new RegExp(
            `^look at the top (a|an|\\d+|x|[a-z]+) cards? of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:them|those cards|the cards)(?: face down)?\\s*$`,
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
          else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
        }

        if (!amount) {
          const mLookOne = firstClean.match(
            new RegExp(
              `^look at the top card of ${srcPattern} librar(?:y|ies)(?:,)? and exile (?:it|that card|them|those cards|the cards)(?: face down)?\\s*$`,
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
            else if (isThoseOpponentsPossessiveSource(src)) who = { kind: 'each_of_those_opponents' };
          }
        }
      }
    }

    if (!amount) return null;
    if (!who) return null;

    const out: any = {
      kind: 'exile_top',
      who,
      amount,
      raw:
        clauses
          .slice(idx, idx + consumed)
          .map(c => String(c || '').trim())
          .filter(Boolean)
          .join('. ') +
        '.',
    };
    if (normalizedFirst.sequence) out.sequence = normalizedFirst.sequence;
    if (normalizedFirst.optional) out.optional = true;

    return {
      step: out,
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
        // Scan ahead a few clauses to find the best matching permission clause.
        // Prefer explicit durations over the weak "during_resolution" match when multiple clauses exist.
        const maxClauseIndex = Math.min(clauses.length, pendingImpulseFromExileTop.clauseIndex + 5);
        let best: ReturnType<typeof parseImpulsePermissionClause> | null = null;
        let bestClauseIndex: number | null = null;

        for (let j = i; j < maxClauseIndex; j++) {
          const parsed = parseImpulsePermissionClause(cleanImpulseClause(clauses[j]));
          if (parsed) {
            if (!best || (best.duration === 'during_resolution' && parsed.duration !== 'during_resolution')) {
              best = parsed;
              bestClauseIndex = j;
            }
            if (parsed.duration !== 'during_resolution') break;
            continue;
          }

          // Stop at the first non-ignorable intervening clause.
          if (!isIgnorableImpulseReminderClause(cleanImpulseClause(clauses[j]))) break;
        }

        if (best && bestClauseIndex !== null) {
          const prev: any = steps[pendingImpulseFromExileTop.stepIndex];
          if (prev && prev.kind === 'exile_top') {
            const combinedRaw = `${String(prev.raw || '').trim()} ${String(clauses[bestClauseIndex] || '').trim()}`.trim();
            steps[pendingImpulseFromExileTop.stepIndex] = {
              kind: 'impulse_exile_top',
              who: prev.who,
              amount: prev.amount,
              duration: best.duration,
              permission: best.permission,
              ...(best.condition ? { condition: best.condition } : {}),
              ...(prev.optional ? { optional: prev.optional } : {}),
              ...(prev.sequence ? { sequence: prev.sequence } : {}),
              raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
            } as any;

            pendingImpulseFromExileTop = null;
            lastCreateTokenStepIndexes = null;
            i = bestClauseIndex + 1;
            continue;
          }
          pendingImpulseFromExileTop = null;
        }
      }
    }

    const createAndExileTop = tryParseCreateTokenAndExileTopClause(clauses[i]);
    if (createAndExileTop) {
      const startIdx = steps.length;
      steps.push(...createAndExileTop);

      const createIndexes = createAndExileTop
        .map((s, off) => ({ s, idx: startIdx + off }))
        .filter(x => x.s.kind === 'create_token')
        .map(x => x.idx);
      lastCreateTokenStepIndexes = createIndexes.length > 0 ? createIndexes : null;

      // Track the exile_top step for a follow-up impulse permission window.
      const exileIdxWithin = (() => {
        for (let off = createAndExileTop.length - 1; off >= 0; off--) {
          if (createAndExileTop[off]?.kind === 'exile_top') return off;
        }
        return null;
      })();
      if (exileIdxWithin !== null) {
        pendingImpulseFromExileTop = { stepIndex: startIdx + exileIdxWithin, clauseIndex: i };
      } else {
        pendingImpulseFromExileTop = null;
      }
      i += 1;
      continue;
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

  let abilities = parsed.abilities.map(parseAbilityToIRAbility);

  // Cross-ability impulse upgrade (conservative):
  // Some engines (e.g. Hauken's Insight) have the exile-top seed and the permission window
  // in different abilities, linked via "cards exiled with this <permanent>" wording.
  // When we detect that permission anywhere in the oracle text, upgrade any `exile_top`
  // from your library into an `impulse_exile_top` so deterministic simulations can treat it
  // as an impulse engine.
  const globalPermission = (() => {
    const allClauses = splitIntoClauses(normalizedOracleText);
    for (const c of allClauses) {
      const parsed = parseGlobalExiledWithSourceImpulsePermission(c);
      if (parsed) return parsed;
    }
    return null;
  })();

  if (globalPermission) {
    abilities = abilities.map((ability) => {
      let changed = false;
      const upgradedSteps = ability.steps.map((step) => {
        if (step.kind !== 'exile_top') return step;
        if (step.who.kind !== 'you') return step;

        changed = true;
        const combinedRaw = `${String(step.raw || '').trim()} ${String(globalPermission.rawClause || '').trim()}`.trim();
        return {
          kind: 'impulse_exile_top',
          who: step.who,
          amount: step.amount,
          duration: globalPermission.duration,
          permission: globalPermission.permission,
          ...(step.optional ? { optional: step.optional } : {}),
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
        } as const;
      });

      return changed ? { ...ability, steps: upgradedSteps } : ability;
    });
  }

  // Cross-ParsedAbility impulse upgrade (conservative):
  // oracleTextParser currently splits many spell texts into multiple STATIC abilities
  // (often one sentence per ParsedAbility). For templates like Tibalt's Trickery,
  // the exile-until seed and the permission window appear in separate ParsedAbility
  // entries but still refer to the same exiled card.
  const globalLoosePermission = (() => {
    const allClauses = splitIntoClauses(normalizedOracleText);
    for (const c of allClauses) {
      const parsed = parseGlobalLooseImpulsePermission(c);
      if (parsed) return parsed;
    }
    return null;
  })();

  if (globalLoosePermission) {
    abilities = abilities.map((ability) => {
      let changed = false;
      const upgradedSteps = ability.steps.map((step) => {
        if (step.kind !== 'exile_top') return step;
        if (step.amount.kind === 'unknown') {
          const raw = String((step.amount as any).raw || '').trim().toLowerCase();
          if (!raw.startsWith('until ')) return step;
        } else if (step.amount.kind === 'number' && step.amount.value === 1) {
          const permissionRaw = String(globalLoosePermission.rawClause || '').toLowerCase();
          const singularPermissionRef = /\b(it|that card|the exiled card|that spell|the exiled spell|the card exiled this way|the spell exiled this way|the card they exiled this way|the spell they exiled this way)\b/i.test(
            permissionRaw
          );
          if (!singularPermissionRef) return step;
        } else if (step.amount.kind === 'number' && step.amount.value > 1) {
          const permissionRaw = String(globalLoosePermission.rawClause || '').toLowerCase();
          const pluralPermissionRef =
            /\b(them|those cards|those spells|the exiled cards|the exiled spells|cards exiled this way|spells exiled this way|cards they exiled this way|spells they exiled this way)\b/i.test(
              permissionRaw
            );
          if (!pluralPermissionRef) return step;
        } else {
          return step;
        }

        changed = true;
        const combinedRaw = `${String(step.raw || '').trim()} ${String(globalLoosePermission.rawClause || '').trim()}`.trim();
        return {
          kind: 'impulse_exile_top',
          who: step.who,
          amount: step.amount,
          duration: globalLoosePermission.duration,
          permission: globalLoosePermission.permission,
          ...(step.optional ? { optional: step.optional } : {}),
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
        } as const;
      });

      return changed ? { ...ability, steps: upgradedSteps } : ability;
    });
  }

  // Cross-ParsedAbility reveal-followup merge (conservative):
  // oracleTextParser can split triggered attack text into a triggered ability plus
  // a trailing static sentence (e.g. Trepanation Blade).
  // When a trailing static ability references "revealed this way", merge supported
  // follow-up steps into the immediately preceding triggered ability.
  {
    const merged: OracleIRAbility[] = [];
    for (let i = 0; i < abilities.length; i++) {
      const current = abilities[i];
      const next = abilities[i + 1];

      const canMergeIntoTriggered =
        current?.type === 'triggered' &&
        Array.isArray(current.steps) &&
        current.steps.some((s) => s.kind === 'mill' && s.amount.kind === 'unknown' && /reveal a land card/i.test(String((s.amount as any).raw || '')));

      const nextLooksLikeRevealFollowup =
        next?.type === 'static' &&
        /revealed this way/i.test(String(next.effectText || next.text || ''));

      if (!canMergeIntoTriggered || !nextLooksLikeRevealFollowup) {
        merged.push(current);
        continue;
      }

      const followupSteps = (next.steps || []).filter((s) => s.kind !== 'unknown');
      merged.push({
        ...current,
        steps: [...current.steps, ...followupSteps],
      });
      i += 1;
    }
    abilities = merged;
  }

  return {
    normalizedOracleText,
    abilities,
    keywords: parsed.keywords,
  };
}
