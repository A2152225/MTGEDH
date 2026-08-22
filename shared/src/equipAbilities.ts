/**
 * Shared Equip ability parsing and target qualification.
 *
 * Supports:
 * - Equip {3}
 * - Equip Wizard {1} / Equip legendary creature {3}
 * - Equip Shaman, Warlock, or Wizard {2}
 * - Equip commander / creature token / planeswalker / creature or planeswalker / worthy
 */

import { CREATURE_TYPES, permanentHasCreatureType } from './creatureTypes.js';

const CREATURE_TYPES_LOWER = new Set(CREATURE_TYPES.map((t) => t.toLowerCase()));

export type EquipQualifierKind =
  | 'any'
  | 'legendary'
  | 'commander'
  | 'creature_token'
  | 'planeswalker'
  | 'creature_or_planeswalker'
  | 'worthy'
  | 'creature_types';

export interface EquipQualifier {
  kind: EquipQualifierKind;
  /** Lowercase creature types when kind === 'creature_types' */
  creatureTypes?: string[];
  raw: string | null;
}

export interface ParsedEquipAbility {
  index: number;
  cost: string;
  qualifier: EquipQualifier;
  label: string;
  targetDescription: string;
}

const MANA_COST = String.raw`\{(?:[WUBRGCX\d/]+)\}(?:\{(?:[WUBRGCX\d/]+)\})*`;

/**
 * Match Equip activations only (not "Equip ability costs …" / "Equip abilities …").
 */
const EQUIP_ABILITY_RE = new RegExp(
  String.raw`\bequip\b(?!\s+abilit)(?:\s+((?:(?!\{)[^\n.])+?))?\s*(${MANA_COST})`,
  'gi',
);

function normalizeSpaces(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseCreatureTypesFromQualifier(raw: string): string[] {
  const cleaned = normalizeSpaces(raw)
    .replace(/\bcreature\b/gi, ' ')
    .replace(/\bor\b/gi, ',')
    .replace(/\band\b/gi, ',')
    .replace(/\s*,\s*/g, ',')
    .replace(/,+/g, ',')
    .replace(/^,|,$/g, '')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && CREATURE_TYPES_LOWER.has(part));
}

export function parseEquipQualifier(rawQualifier: string | null | undefined): EquipQualifier {
  const raw = normalizeSpaces(String(rawQualifier || ''));
  if (!raw) {
    return { kind: 'any', raw: null };
  }

  const lower = raw.toLowerCase();

  if (/^legendary(?:\s+creature)?$/.test(lower)) {
    return { kind: 'legendary', raw };
  }
  if (/^commander$/.test(lower)) {
    return { kind: 'commander', raw };
  }
  if (/^creature\s+token$/.test(lower) || /^token$/.test(lower)) {
    return { kind: 'creature_token', raw };
  }
  if (/^creature\s+or\s+planeswalker$/.test(lower) || /^planeswalker\s+or\s+creature$/.test(lower)) {
    return { kind: 'creature_or_planeswalker', raw };
  }
  if (/^planeswalker$/.test(lower)) {
    return { kind: 'planeswalker', raw };
  }
  if (/^worthy$/.test(lower)) {
    return { kind: 'worthy', raw };
  }

  const creatureTypes = parseCreatureTypesFromQualifier(raw);
  if (creatureTypes.length > 0) {
    return { kind: 'creature_types', creatureTypes, raw };
  }

  // Fallback: treat as a single type-line / subtype include check (legacy behavior).
  return {
    kind: 'creature_types',
    creatureTypes: [lower.replace(/\s+creature$/, '').trim()].filter(Boolean),
    raw,
  };
}

function describeQualifier(qualifier: EquipQualifier): string {
  switch (qualifier.kind) {
    case 'any':
      return 'creature you control';
    case 'legendary':
      return 'legendary creature you control';
    case 'commander':
      return 'commander you control';
    case 'creature_token':
      return 'creature token you control';
    case 'planeswalker':
      return 'planeswalker you control';
    case 'creature_or_planeswalker':
      return 'creature or planeswalker you control';
    case 'worthy':
      return 'worthy creature you control';
    case 'creature_types': {
      const types = qualifier.creatureTypes || [];
      if (types.length === 0) return 'creature you control';
      if (types.length === 1) return `${types[0]} creature you control`;
      if (types.length === 2) return `${types[0]} or ${types[1]} creature you control`;
      return `${types.slice(0, -1).join(', ')}, or ${types[types.length - 1]} creature you control`;
    }
    default:
      return 'creature you control';
  }
}

export function parseEquipAbilitiesFromOracle(oracleText: string): ParsedEquipAbility[] {
  const abilities: ParsedEquipAbility[] = [];
  const text = String(oracleText || '');
  EQUIP_ABILITY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = EQUIP_ABILITY_RE.exec(text)) !== null) {
    const rawQualifier = normalizeSpaces(match[1] || '') || null;
    const cost = String(match[2] || '').trim();
    if (!cost) continue;

    // Reject residual false positives like "Equip ability costs {1}" if lookahead missed.
    if (rawQualifier && /^abilit/i.test(rawQualifier)) continue;

    const qualifier = parseEquipQualifier(rawQualifier);
    const targetDescription = describeQualifier(qualifier);
    const label = qualifier.kind === 'any'
      ? `Equip ${cost}`
      : `Equip ${rawQualifier} ${cost}`;

    abilities.push({
      index,
      cost,
      qualifier,
      label,
      targetDescription,
    });
    index += 1;
  }
  return abilities;
}

function permanentIsCreature(permanent: any): boolean {
  if (!permanent) return false;
  // Crew / animate / station: temporary Creature until EOT (or while stationed).
  if (permanent.crewed === true) return true;
  if (Array.isArray(permanent.grantedTypes)
    && permanent.grantedTypes.some((t: any) => String(t || '').toLowerCase() === 'creature')) {
    return true;
  }
  if (permanent.animated === true || permanent.isCreature === true) return true;

  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  // Vehicles are not creatures unless crewed/granted above.
  if (/\bvehicle\b/.test(typeLine) && !/\bcreature\b/.test(typeLine)) return false;
  return /\bcreature\b/.test(typeLine);
}

function permanentIsPlaneswalker(permanent: any): boolean {
  return String(permanent?.card?.type_line || '').toLowerCase().includes('planeswalker');
}

function permanentIsWorthy(permanent: any): boolean {
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const oracle = String(permanent?.card?.oracle_text || '').toLowerCase();
  const granted = Array.isArray(permanent?.grantedAbilities)
    ? permanent.grantedAbilities.map((a: unknown) => String(a || '').toLowerCase())
    : [];
  const keywords = Array.isArray(permanent?.keywords)
    ? permanent.keywords.map((a: unknown) => String(a || '').toLowerCase())
    : [];
  return (
    /\bworthy\b/.test(typeLine)
    || /\bworthy\b/.test(oracle)
    || granted.some((a: string) => a.includes('worthy'))
    || keywords.some((a: string) => a.includes('worthy'))
  );
}

/**
 * Whether a permanent is a legal target for a parsed Equip qualifier.
 * Caller is responsible for controller / "you control" checks.
 */
export function permanentMatchesEquipQualifier(permanent: any, qualifier: EquipQualifier): boolean {
  if (!permanent?.card) return false;
  const kind = qualifier?.kind || 'any';

  if (kind === 'planeswalker') {
    return permanentIsPlaneswalker(permanent);
  }
  if (kind === 'creature_or_planeswalker') {
    return permanentIsCreature(permanent) || permanentIsPlaneswalker(permanent);
  }

  if (kind === 'commander') {
    return permanent?.isCommander === true || permanent?.card?.isCommander === true;
  }

  // Remaining qualifiers require a creature.
  if (!permanentIsCreature(permanent)) return false;

  switch (kind) {
    case 'any':
      return true;
    case 'legendary':
      return String(permanent.card.type_line || '').toLowerCase().includes('legendary');
    case 'creature_token':
      return permanent?.isToken === true || permanent?.card?.isToken === true;
    case 'worthy':
      return permanentIsWorthy(permanent);
    case 'creature_types': {
      const types = qualifier.creatureTypes || [];
      if (types.length === 0) return true;
      return types.some((creatureType) => permanentHasCreatureType(permanent, creatureType));
    }
    default:
      return true;
  }
}
