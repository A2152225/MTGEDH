import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const STATIC_KEYWORD_ABILITIES = new Set([
  'banding',
  'flying',
  'trample',
  'vigilance',
  'lifelink',
  'deathtouch',
  'reach',
  'menace',
  'shroud',
  'hexproof',
  'indestructible',
  'fear',
  'intimidate',
  'shadow',
  'horsemanship',
  'first strike',
  'double strike',
  'haste',
  'ward',
  'myriad',
]);

function parseKeywordAbilityList(raw: string): string[] {
  const normalized = normalizeOracleText(raw)
    .replace(/"[^"]*"/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.;]/g, ' ')
    .replace(/\band\s*$/i, ' ')
    .replace(/^and\s+/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return [];

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);

  const abilities: string[] = [];
  for (const part of parts) {
    if (!STATIC_KEYWORD_ABILITIES.has(part)) return [];
    if (!abilities.includes(part)) abilities.push(part);
  }

  return abilities;
}

function extractQuotedAbilityText(raw: string): string[] {
  const abilities: string[] = [];
  const text = normalizeOracleText(raw);
  const quoted = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(text)) !== null) {
    const abilityText = String(match[1] || '').trim();
    if (abilityText && !abilities.includes(abilityText)) abilities.push(abilityText);
  }
  return abilities;
}

function parseSignedInt(raw: string | undefined): number | undefined {
  const value = String(raw || '').trim();
  if (!/^[+-]?\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Object.is(parsed, -0) ? 0 : parsed;
}

function isEphemeralGrantedAbilityTarget(raw: string): boolean {
  const normalized = normalizeOracleText(raw).trim().toLowerCase();
  return /^(?:it|them|they|that (?:card|creature|permanent|artifact|enchantment|land|planeswalker|token)|those (?:cards|creatures|permanents|artifacts|enchantments|lands|planeswalkers|tokens))$/.test(normalized);
}

export function tryParseStaticAbilityGrantClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;
  if (/\buntil\s+end\s+of\s+turn\b/i.test(normalized)) return null;
  if (/^during your turn,\s+/i.test(normalized)) return null;
  if (/^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)\s*\(/i.test(normalized)) return null;

  const parentheticalManaMatch = normalized.match(/^\(?\s*\{T\}\s*:\s*add\s+(\{[^}]+\}(?:\s+or\s+\{[^}]+\})+|\{[^}]+\}(?:\s*\{[^}]+\})*)\s*\)?$/i);
  if (parentheticalManaMatch) {
    const symbols = String(parentheticalManaMatch[1] || '').match(/\{[^}]+\}/g) || [];
    if (symbols.length > 0) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(undefined),
        mana: symbols[0],
        ...(symbols.length > 1 ? { manaOptions: symbols } : {}),
        raw: rawClause,
      });
    }
  }

  const staticLookTopMatch = normalized.match(/^you\s+may\s+look\s+at\s+the\s+top\s+(?:(a|an|\d+|x|[a-z]+)\s+cards?|card)\s+of\s+your\s+library\s+any\s+time$/i);
  if (staticLookTopMatch) {
    return withMeta({
      kind: 'look_top',
      who: { kind: 'you' },
      amount: staticLookTopMatch[1] ? parseQuantity(String(staticLookTopMatch[1] || '').trim()) : { kind: 'number', value: 1 },
      optional: true,
      raw: rawClause,
    });
  }

  const quotedGrantMatch = normalized.match(/^(.+?)\s+(?:gains?|gain|has|have)\s+"([^"]+)"$/i);
  if (
    quotedGrantMatch &&
    !/\bgraveyard\b/i.test(String(quotedGrantMatch[1] || '')) &&
    !/^until\s+end\s+of\s+turn,?\s+/i.test(normalized) &&
    !(/^(?:it|they)$/i.test(String(quotedGrantMatch[1] || '').trim()) && /^sacrifice this token:\s*add\s+\{c\}/i.test(String(quotedGrantMatch[2] || '').trim()))
  ) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(quotedGrantMatch[1] || '').trim()),
      effectText: [String(quotedGrantMatch[2] || '').trim()],
      duration: 'static',
      raw: rawClause,
    });
  }

  const equippedGrantMatch = normalized.match(
    /^(equipped creature|enchanted creature|equipped land|this creature|this saga)\s+(?:(?:gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+)\s+and\s+)?(?:has|have|gains?|gain)\s+(.+))$/i
  );
  if (equippedGrantMatch) {
    const targetText = String(equippedGrantMatch[1] || '').trim();
    const tail = String(equippedGrantMatch[4] || '').trim();
    const conditionalTail = tail.match(/^(.+?)\s+as\s+long\s+as\s+(.+)$/i);
    const keywordTail = conditionalTail ? String(conditionalTail[1] || '').trim() : tail;
    const effectText = extractQuotedAbilityText(tail);
    if (conditionalTail) effectText.push(`as long as ${String(conditionalTail[2] || '').trim()}`);
    const abilities = parseKeywordAbilityList(keywordTail);
    const power = parseSignedInt(equippedGrantMatch[2]);
    const toughness = parseSignedInt(equippedGrantMatch[3]);
    if (!effectText.length && !abilities.length && power === undefined && toughness === undefined) return null;

    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(abilities.length > 0 ? { abilities } : {}),
      ...(effectText.length > 0 ? { effectText } : {}),
      ...(power !== undefined ? { power } : {}),
      ...(toughness !== undefined ? { toughness } : {}),
      duration: /^(?:equipped|enchanted)\b/i.test(targetText) ? 'while_attached' : 'static',
      raw: rawClause,
    });
  }

  const attachedPtOnlyGrantMatch = normalized.match(
    /^(equipped creature|enchanted creature|equipped land|enchanted land|enchanted permanent|this creature)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+)(?:\s+(.+))?$/i
  );
  if (attachedPtOnlyGrantMatch) {
    const targetText = String(attachedPtOnlyGrantMatch[1] || '').trim();
    const power = parseSignedInt(attachedPtOnlyGrantMatch[2]);
    const toughness = parseSignedInt(attachedPtOnlyGrantMatch[3]);
    const tail = String(attachedPtOnlyGrantMatch[4] || '').trim();
    if (power === undefined || toughness === undefined) return null;

    const dynamicTail = /^(?:for\s+each|where\b|as\s+long\s+as\b)/i.test(tail);
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(dynamicTail
        ? { effectText: [`gets ${String(attachedPtOnlyGrantMatch[2] || '').trim()}/${String(attachedPtOnlyGrantMatch[3] || '').trim()} ${tail}`.trim()] }
        : { power, toughness }),
      duration: /^(?:equipped|enchanted)\b/i.test(targetText) ? 'while_attached' : 'static',
      raw: rawClause,
    });
  }

  const staticTeamPtMatch = normalized.match(
    /^((?:(?:all|other)\s+)?(?:non[- ]?[a-z]+\s+)?(?:[a-z]+\s+)?creatures\s+you\s+control(?:\s+of\s+the\s+chosen\s+(?:type|color))?|creatures\s+your\s+opponents\s+control)\s+get\s+([+-]?\d+)\s*\/\s*([+-]?\d+)(?:\s+(.+))?$/i
  );
  if (staticTeamPtMatch) {
    const targetText = String(staticTeamPtMatch[1] || '').trim();
    const power = parseSignedInt(staticTeamPtMatch[2]);
    const toughness = parseSignedInt(staticTeamPtMatch[3]);
    const tail = String(staticTeamPtMatch[4] || '').trim();
    if (power === undefined || toughness === undefined) return null;
    const dynamicTail = /^(?:for\s+each|where\b|as\s+long\s+as\b)/i.test(tail);

    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      ...(dynamicTail
        ? { effectText: [`gets ${String(staticTeamPtMatch[2] || '').trim()}/${String(staticTeamPtMatch[3] || '').trim()} ${tail}`.trim()] }
        : { power, toughness }),
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCombatRestrictionMatch = normalized.match(
    /^(.+?)\s+can't\s+attack\s+(.+?)\s+unless\s+(.+)$/i
  );
  if (staticCombatRestrictionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCombatRestrictionMatch[1] || '').trim()),
      effectText: [normalized],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticCombatRestrictionDurationMatch = normalized.match(
    /^(.+?)\s+can't\s+attack\s+(.+?)(?:\s+for\s+as\s+long\s+as\s+.+|\s+that\s+combat)$/i
  );
  if (staticCombatRestrictionDurationMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticCombatRestrictionDurationMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+attack/i, "can't attack")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticBlockRestrictionMatch = normalized.match(/^(.+?)\s+can't\s+block\s+with\s+(.+)$/i);
  if (staticBlockRestrictionMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticBlockRestrictionMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+block/i, "can't block")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticUnblockableMatch = normalized.match(/^(.+?)\s+can't\s+be\s+blocked(?:\s+(?:by|except\s+by)\s+.+?)?(?:\s+as\s+long\s+as\s+.+)?$/i);
  if (staticUnblockableMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticUnblockableMatch[1] || '').trim()),
      effectText: [normalized.replace(/^.+?\s+can't\s+be\s+blocked/i, "can't be blocked")],
      duration: 'static',
      raw: rawClause,
    });
  }

  const attacksEachCombatMatch = normalized.match(/^(.+?)\s+attacks\s+each\s+combat\s+if\s+able$/i);
  if (attacksEachCombatMatch) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(attacksEachCombatMatch[1] || '').trim()),
      effectText: ['attacks each combat if able'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const staticKeywordConditionalMatch = normalized.match(/^(.+?)\s+has\s+(.+?)\s+as\s+long\s+as\s+(.+)$/i);
  if (staticKeywordConditionalMatch) {
    const abilityText = String(staticKeywordConditionalMatch[2] || '').trim();
    const abilities = parseKeywordAbilityList(abilityText);
    if (abilities.length === 0 && STATIC_KEYWORD_ABILITIES.has(abilityText.toLowerCase())) abilities.push(abilityText.toLowerCase());
    if (abilities.length > 0) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticKeywordConditionalMatch[1] || '').trim()),
        abilities,
        effectText: [`as long as ${String(staticKeywordConditionalMatch[3] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
      });
    }
  }

  const staticPtKeywordAttackMatch = normalized.match(
    /^(.+?)\s+gets\s+([+-]?\d+)\s*\/\s*([+-]?\d+),\s+has\s+(.+?),\s+and\s+attacks\s+each\s+combat\s+if\s+able$/i
  );
  if (staticPtKeywordAttackMatch) {
    const power = parseSignedInt(staticPtKeywordAttackMatch[2]);
    const toughness = parseSignedInt(staticPtKeywordAttackMatch[3]);
    if (power === undefined || toughness === undefined) return null;
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPtKeywordAttackMatch[1] || '').trim()),
      power,
      toughness,
      abilities: parseKeywordAbilityList(String(staticPtKeywordAttackMatch[4] || '').trim()),
      effectText: ['attacks each combat if able'],
      duration: 'static',
      raw: rawClause,
    });
  }

  const genericGrantMatch = normalized.match(/^(.+?)\s+(?:has|have|gains?|gain)\s+(.+)$/i);
  if (!genericGrantMatch) return null;

  const targetText = String(genericGrantMatch[1] || '').trim();
  const tail = String(genericGrantMatch[2] || '').trim();
  if (/\bgraveyard\b/i.test(targetText) || /^until\s+end\s+of\s+turn,?\s+/i.test(normalized)) return null;
  if (isEphemeralGrantedAbilityTarget(targetText)) return null;
  if (/^(?:it|they)$/i.test(targetText) && /^"?sacrifice this token:\s*add\s+\{c\}/i.test(tail)) return null;
  const effectText = extractQuotedAbilityText(tail);
  const abilities = parseKeywordAbilityList(tail);
  if (!effectText.length && !abilities.length) return null;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector(targetText),
    ...(abilities.length > 0 ? { abilities } : {}),
    ...(effectText.length > 0 ? { effectText } : {}),
    duration: 'static',
    raw: rawClause,
  });
}
