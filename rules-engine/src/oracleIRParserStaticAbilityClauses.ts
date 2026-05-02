import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

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
  return Number.parseInt(value, 10);
}

export function tryParseStaticAbilityGrantClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

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
    const effectText = extractQuotedAbilityText(tail);
    const abilities = parseKeywordAbilityList(tail);
    const power = parseSignedInt(equippedGrantMatch[2]);
    const toughness = parseSignedInt(equippedGrantMatch[3]);
    if (!effectText.length && !abilities.length && power === undefined && toughness === undefined) return null;
    if (!effectText.length && !abilities.includes('myriad')) return null;

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

  const genericGrantMatch = normalized.match(/^(.+?)\s+(?:has|have|gains?|gain)\s+(.+)$/i);
  if (!genericGrantMatch) return null;

  const targetText = String(genericGrantMatch[1] || '').trim();
  const tail = String(genericGrantMatch[2] || '').trim();
  if (/\bgraveyard\b/i.test(targetText) || /^until\s+end\s+of\s+turn,?\s+/i.test(normalized)) return null;
  if (/^(?:it|they)$/i.test(targetText) && /^"?sacrifice this token:\s*add\s+\{c\}/i.test(tail)) return null;
  const effectText = extractQuotedAbilityText(tail);
  const abilities = parseKeywordAbilityList(tail);
  if (!effectText.length && !abilities.includes('myriad')) return null;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector(targetText),
    ...(abilities.length > 0 ? { abilities } : {}),
    ...(effectText.length > 0 ? { effectText } : {}),
    duration: 'static',
    raw: rawClause,
  });
}
