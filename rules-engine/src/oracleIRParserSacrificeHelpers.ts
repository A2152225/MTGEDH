import { AbilityType, type ParsedAbility } from './oracleTextParser';
import type {
  OracleBattlefieldObjectCondition,
  OracleClauseCondition,
  OracleEffectStep,
  OracleIRAbility,
  OracleQuantity,
  OracleZone,
} from './oracleIR';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseQuantity,
  splitIntoClauses,
} from './oracleIRParserUtils';

export function normalizeCounterName(counter: string): string {
  return String(counter || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\+\s*1\s*\/\s*\+\s*1/g, '+1/+1')
    .replace(/\-\s*1\s*\/\s*\-\s*1/g, '-1/-1')
    .replace(/\bcounters?\b/gi, '')
    .trim();
}

export function parseBattlefieldObjectCondition(rawText: string): OracleBattlefieldObjectCondition | undefined {
  const text = normalizeOracleText(rawText).replace(/[.]+$/g, '').trim();
  if (!text.startsWith('if ')) return undefined;

  const manaValueMatch = text.match(/^if it has mana value (a|an|\d+|x|[a-z]+) or (less|fewer|more|greater)$/i);
  if (manaValueMatch) {
    const value = parseQuantity(String(manaValueMatch[1] || '').trim());
    if (value.kind !== 'number') return undefined;
    return {
      kind: 'mana_value_compare',
      comparator: /less|fewer/i.test(String(manaValueMatch[2] || '')) ? 'lte' : 'gte',
      value: Math.max(0, value.value | 0),
      subject: 'it',
    };
  }

  const counterMatch = text.match(/^if it has (a|an|\d+|x|[a-z]+) or (less|fewer|more|greater) (.+?) counters? on it$/i);
  if (counterMatch) {
    const value = parseQuantity(String(counterMatch[1] || '').trim());
    if (value.kind !== 'number') return undefined;
    const counter = normalizeCounterName(String(counterMatch[3] || ''));
    if (!counter) return undefined;
    return {
      kind: 'counter_compare',
      counter,
      comparator: /less|fewer/i.test(String(counterMatch[2] || '')) ? 'lte' : 'gte',
      value: Math.max(0, value.value | 0),
      subject: 'it',
    };
  }

  const zeroCounterMatch = text.match(/^if there are no (.+?) counters? on it$/i);
  if (zeroCounterMatch) {
    const counter = normalizeCounterName(String(zeroCounterMatch[1] || ''));
    if (!counter) return undefined;
    return {
      kind: 'counter_compare',
      counter,
      comparator: 'eq',
      value: 0,
      subject: 'it',
    };
  }

  return undefined;
}

export function splitSacrificeObjectAndCondition(rawText: string): {
  readonly objectText: string;
  readonly condition?: OracleBattlefieldObjectCondition;
} {
  const text = String(rawText || '').trim();
  if (!text) return { objectText: text };

  const conditional = text.match(/^(.+?)\s+if\s+(.+)$/i);
  if (!conditional) return { objectText: text };

  const condition = parseBattlefieldObjectCondition(`if ${String(conditional[2] || '').trim()}`);
  if (!condition) return { objectText: text };

  return {
    objectText: String(conditional[1] || '').trim(),
    condition,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSelfReferenceAliases(cardName?: string): string[] {
  const raw = String(cardName || '').trim();
  if (!raw) return [];

  const aliases = new Set<string>();
  const pushAlias = (value: string): void => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    aliases.add(normalized.toLowerCase());
  };

  pushAlias(raw);

  for (const face of raw.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    pushAlias(face);

    const commaHead = face.split(',')[0]?.trim();
    if (commaHead && commaHead.length >= 4) {
      pushAlias(commaHead);
    }
  }

  return [...aliases];
}

export function normalizeLeadingConditionalCondition(rawText: string, cardName?: string): string {
  let normalized = String(rawText || '').trim();
  if (!normalized) return normalized;

  for (const alias of buildSelfReferenceAliases(cardName)) {
    if (!alias) continue;
    const escaped = escapeRegExp(alias);
    normalized = normalized
      .replace(new RegExp(`\\b${escaped}'s\\b`, 'ig'), "this permanent's")
      .replace(new RegExp(`\\b${escaped}\\b`, 'ig'), 'this permanent');
  }

  return normalized.trim();
}

export function abilityEffectText(ability: ParsedAbility): string {
  return String(ability.effect || ability.text || '').trim();
}

export function inferZoneFromDestination(destination: string): OracleZone {
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

export function isSafeSacrificeFollowupClause(
  rawClause: string,
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep
): boolean {
  const parsed = parseEffectClauseToStep(rawClause);
  if (parsed.kind !== 'unknown') return true;

  const normalized = normalizeClauseForParse(rawClause);
  const clause = String(normalized.clause || '').trim();
  if (!clause) return false;

  return /^(?:open|counter|draw|create|destroy|exile|return|put|gain|lose|deal|tap|untap|mill|discard|surveil|scry|goad)\b/i.test(
    clause
  ) ||
    /^(?:target|that|those|its|it|each|he|they|you)\b/i.test(clause) ||
    /^(?:enchanted player|enchanted creature|defending player|the defending player)\b/i.test(clause);
}

export function isExplicitSelfSacrificeReference(text: string): boolean {
  return /^(?:it|this creature|this artifact|this enchantment|this aura|this equipment|this land|this planeswalker|this battle|this vehicle|this permanent|this attraction)$/i.test(
    String(text || '').trim()
  );
}

export function isExplicitOrNamedSelfSacrificeReference(text: string, cardName?: string): boolean {
  if (isExplicitSelfSacrificeReference(text)) return true;
  const normalized = String(text || '').trim().toLowerCase();
  return normalized.length > 0 && buildSelfReferenceAliases(cardName).includes(normalized);
}

export function splitConservativeSacrificeLeadClause(args: {
  rawClause: string;
  cardName?: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, cardName, parseEffectClauseToStep } = args;
  const normalized = normalizeClauseForParse(rawClause);
  const clause = String(normalized.clause || '').trim();
  if (!clause || normalized.optional || !/^sacrifice\b/i.test(clause)) return null;

  const delimiterMatches: readonly { readonly objectText: string; readonly secondRaw: string }[] = [
    ...(() => {
      const m = clause.match(/^sacrifice\s+(.+?),\s*then\s+(.+)$/i);
      return m
        ? [
            {
              objectText: String(m[1] || '').trim(),
              secondRaw: `then ${String(m[2] || '').trim()}`,
            },
          ]
        : [];
    })(),
    ...(() => {
      const m = clause.match(/^sacrifice\s+(.+?)\s+and\s+(.+)$/i);
      return m
        ? [
            {
              objectText: String(m[1] || '').trim(),
              secondRaw: String(m[2] || '').trim(),
            },
          ]
        : [];
    })(),
  ];

  for (const candidate of delimiterMatches) {
    const objectText = candidate.objectText;
    const secondRaw = candidate.secondRaw;
    if (!objectText || !secondRaw) continue;
    if (/[,:;]/.test(objectText) || /\band\/or\b/i.test(objectText) || /\bor\b/i.test(objectText)) continue;
    if (/^it\b/i.test(secondRaw) && !isExplicitOrNamedSelfSacrificeReference(objectText, cardName)) continue;

    const firstRaw = `Sacrifice ${objectText}`;
    const firstStep = parseEffectClauseToStep(firstRaw);
    if (firstStep.kind !== 'sacrifice') continue;
    if (!isSafeSacrificeFollowupClause(secondRaw, parseEffectClauseToStep)) continue;

    return [firstRaw, secondRaw];
  }

  return null;
}

export function splitLeadingConditionalBody(args: {
  body: string;
  cardName?: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): readonly string[] {
  const { body, cardName, parseEffectClauseToStep } = args;
  const out: string[] = [];

  for (const clause of splitIntoClauses(body)) {
    if (/^sacrifice\b/i.test(clause) && clause.includes(',')) {
      const segments = clause.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
      if (
        segments.length > 1 &&
        /^sacrifice\b/i.test(String(segments[0] || '')) &&
        segments.slice(1).every(part => isSafeSacrificeFollowupClause(part.replace(/^and\s+/i, ''), parseEffectClauseToStep))
      ) {
        out.push(String(segments[0] || '').trim());
        for (let i = 1; i < segments.length; i += 1) {
          out.push(String(segments[i] || '').replace(/^and\s+/i, '').trim());
        }
        continue;
      }
    }

    const split = splitConservativeSacrificeLeadClause({
      rawClause: clause,
      cardName,
      parseEffectClauseToStep,
    });
    if (split) {
      out.push(...split);
      continue;
    }

    out.push(clause);
  }

  return out;
}

export function tryParseLeadingConditionalStep(args: {
  rawClause: string;
  cardName?: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): OracleEffectStep | null {
  const { rawClause, cardName, parseEffectClauseToStep } = args;
  const normalized = normalizeClauseForParse(rawClause);
  const clause = String(normalized.clause || '').trim();
  if (!clause) return null;

  const match = clause.match(/^if\s+([^,]+),\s*(.+)$/i);
  if (!match) return null;

  const conditionRaw = normalizeLeadingConditionalCondition(String(match[1] || '').trim(), cardName);
  const body = String(match[2] || '').trim();
  if (!conditionRaw || !body) return null;

  const innerClauses = splitLeadingConditionalBody({
    body,
    cardName,
    parseEffectClauseToStep,
  });
  if (innerClauses.length <= 0) return null;

  const innerSteps = innerClauses.map(part => parseEffectClauseToStep(part));
  const hasSacrificeWrapperShape =
    innerSteps.length > 1 && innerSteps.some(step => step.kind === 'sacrifice');
  if (!hasSacrificeWrapperShape) return null;

  const step: {
    kind: 'conditional';
    condition: OracleClauseCondition;
    steps: readonly OracleEffectStep[];
    optional?: boolean;
    sequence?: 'then';
    raw: string;
  } = {
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: innerSteps,
    raw: rawClause,
  };

  if (normalized.optional) step.optional = normalized.optional;
  if (normalized.sequence) step.sequence = normalized.sequence;
  return step;
}

export function buildMockSpellAbility(modeEffectText: string): ParsedAbility {
  return {
    type: AbilityType.SPELL,
    text: modeEffectText,
    effect: modeEffectText,
  };
}
