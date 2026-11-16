// server/src/state/modules/replacementBatch90ExtraDifferentTypeTokens.ts
// B90: "those tokens plus a [Food/Clue/Map/Soldier/Thopter] token" extras of a
// different type (Tippy-Toe, Queen Allenal, Stridehangar Automaton, Worldwalker
// Helm, Case of the Pilfered Proof, and existing Peregrin / Donatello / Quina
// metadata). Also token-identity substitution (Divine Visitation).
// Public: parseBatch90ExtraDifferentTypeTokenSentence, parseBatch90TokenIdentitySubstitution,
// collectBatch90ExtraDifferentTypeTokenSpecs, AdditionalCreatedToken.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

export type AdditionalCreatedToken = {
  name: string;
  count: number;
  typeLine?: string;
  power?: number;
  toughness?: number;
  colors?: string[];
  abilities?: string[];
  sourceName?: string;
};

export type ReplacedCreatedToken = {
  name: string;
  typeLine?: string;
  power?: number;
  toughness?: number;
  colors?: string[];
  abilities?: string[];
};

const COLOR_WORDS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

function cap(s: string): string {
  const t = String(s || '').trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function parseColors(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .toLowerCase()
    .split(/\s+and\s+|\s+/)
    .map((w) => COLOR_WORDS[w])
    .filter((c): c is string => !!c && c !== 'C');
}

function parseAbilities(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .toLowerCase()
    .split(/\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function typeLineFor(opts: { name: string; power?: number; toughness?: number; isArtifact?: boolean; isCreature?: boolean }): string | undefined {
  const bits: string[] = [];
  if (opts.isArtifact) bits.push('Artifact');
  if (opts.isCreature || (opts.power != null && opts.toughness != null)) bits.push('Creature');
  if (bits.length === 0) {
    // Common token names without typeline words (Food, Clue, Map, Treasure).
    return undefined;
  }
  const sub = cap(opts.name);
  return sub ? `${bits.join(' ')} \u2014 ${sub}` : bits.join(' ');
}

const EXTRA_RE =
  /(?:if you would create (?:one or more|1 or more)(?: (creature|artifact))? tokens|if (?:one or more|1 or more)(?: (creature|artifact))? tokens would be created under your control),?(?: instead create)? those tokens plus (?:an additional )?(?:(?:a|an) )?((?:\d+\s*\/\s*\d+ )?(?:(?:colorless|white|blue|black|red|green)(?: and (?:colorless|white|blue|black|red|green))* )?[a-z][a-z'-]*)(?: (artifact))?(?: (creature))? tokens?(?: with ([a-z]+(?: and [a-z]+)*))?(?: are created instead| instead)?/gi;

const DESCRIPTOR_RE =
  /^(?:(\d+)\s*\/\s*(\d+) )?(?:((?:colorless|white|blue|black|red|green)(?: and (?:colorless|white|blue|black|red|green))*) )?([a-z][a-z'-]*)$/i;

const IDENTITY_RE =
  /if (?:one or more|1 or more) creature tokens would be created under your control, (?:that many|those tokens are) (\d+)\s*\/\s*(\d+) ((?:colorless|white|blue|black|red|green)(?: and (?:colorless|white|blue|black|red|green))*) ([a-z][a-z'-]*) creature tokens?(?: with ([a-z]+(?: and [a-z]+)*))?(?: are created)? instead/gi;

export function parseBatch90ExtraDifferentTypeTokenSentence(oracle: string): Array<{
  filter: 'any' | 'creature' | 'artifact';
  token: AdditionalCreatedToken;
}> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ filter: 'any' | 'creature' | 'artifact'; token: AdditionalCreatedToken }> = [];
  EXTRA_RE.lastIndex = 0;
  for (const m of text.matchAll(EXTRA_RE)) {
    const filterRaw = String(m[1] || m[2] || '').trim().toLowerCase();
    const filter: 'any' | 'creature' | 'artifact' = filterRaw === 'creature' || filterRaw === 'artifact' ? filterRaw : 'any';
    const desc = DESCRIPTOR_RE.exec(String(m[3] || '').trim());
    if (!desc) continue;
    const power = desc[1] != null ? Number(desc[1]) : undefined;
    const toughness = desc[2] != null ? Number(desc[2]) : undefined;
    const colors = parseColors(desc[3]);
    const name = cap(desc[4] || '');
    if (!name) continue;
    const isArtifact = Boolean(m[4]) || ['Food', 'Clue', 'Map', 'Treasure', 'Gold', 'Junk', 'Powerstone', 'Blood'].includes(name);
    const isCreature = Boolean(m[5]) || (power != null && toughness != null);
    const abilities = parseAbilities(m[6]);
    out.push({
      filter,
      token: {
        name,
        count: 1,
        typeLine: typeLineFor({ name, power, toughness, isArtifact, isCreature }),
        ...(power != null ? { power } : {}),
        ...(toughness != null ? { toughness } : {}),
        ...(colors.length ? { colors } : {}),
        ...(abilities.length ? { abilities } : {}),
      },
    });
  }
  return out;
}

export function parseBatch90TokenIdentitySubstitution(oracle: string): ReplacedCreatedToken | undefined {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  IDENTITY_RE.lastIndex = 0;
  const m = IDENTITY_RE.exec(text);
  if (!m) return undefined;
  const power = Number(m[1]);
  const toughness = Number(m[2]);
  const colors = parseColors(m[3]);
  const name = cap(m[4] || '');
  if (!name || !Number.isFinite(power) || !Number.isFinite(toughness)) return undefined;
  const abilities = parseAbilities(m[5]);
  return {
    name,
    typeLine: typeLineFor({ name, power, toughness, isArtifact: false, isCreature: true }),
    power,
    toughness,
    ...(colors.length ? { colors } : {}),
    ...(abilities.length ? { abilities } : {}),
  };
}

export function collectBatch90ExtraDifferentTypeTokenSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const extras = parseBatch90ExtraDifferentTypeTokenSentence(oracle);
  for (const entry of extras) {
    const slug = String(entry.token.name || 'token').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    specs.push({
      id: `${source.sourcePermanentId}:extra-${slug}-token`,
      event: 'token-creation',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {
        creatingPlayerIsSourceController: true,
        ...(entry.filter === 'creature' ? { tokenIsCreature: true } : {}),
        ...(entry.filter === 'artifact' ? { tokenIsArtifact: true } : {}),
      },
      instead: { modify: 'add_flat', value: entry.token.count },
      effectId: `controller-extra-${slug}`,
      reason: 'controller_extra_different_type_token',
      metadata: {
        createAdditionalTokenNamed: entry.token.name.toLowerCase(),
        ...(entry.token.typeLine ? { createAdditionalTokenTypeLine: entry.token.typeLine } : {}),
        ...(entry.token.power != null ? { createAdditionalTokenPower: entry.token.power } : {}),
        ...(entry.token.toughness != null ? { createAdditionalTokenToughness: entry.token.toughness } : {}),
        ...(entry.token.colors ? { createAdditionalTokenColors: entry.token.colors } : {}),
        ...(entry.token.abilities ? { createAdditionalTokenAbilities: entry.token.abilities } : {}),
      },
    } as ReplacementEffectSpec);
  }
  const identity = parseBatch90TokenIdentitySubstitution(oracle);
  if (identity) {
    specs.push({
      id: `${source.sourcePermanentId}:token-identity-${identity.name.toLowerCase()}`,
      event: 'token-creation',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {
        creatingPlayerIsSourceController: true,
        tokenIsCreature: true,
      },
      instead: { modify: 'add_flat', value: 0 },
      effectId: `controller-token-identity-${identity.name.toLowerCase()}`,
      reason: 'controller_token_identity_substitution',
      metadata: {
        replaceCreatedTokenNamed: identity.name,
        ...(identity.typeLine ? { replaceCreatedTokenTypeLine: identity.typeLine } : {}),
        ...(identity.power != null ? { replaceCreatedTokenPower: identity.power } : {}),
        ...(identity.toughness != null ? { replaceCreatedTokenToughness: identity.toughness } : {}),
        ...(identity.colors ? { replaceCreatedTokenColors: identity.colors } : {}),
        ...(identity.abilities ? { replaceCreatedTokenAbilities: identity.abilities } : {}),
      },
    } as ReplacementEffectSpec);
  }
  return specs;
}

export function collectBatch90ExtraDifferentTypeTokenSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string; oracleText?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch90ExtraDifferentTypeTokenSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function additionalTokenFromSpecMetadata(
  metadata: Record<string, unknown> | undefined,
  sourceName?: string,
): AdditionalCreatedToken | undefined {
  const name = String(metadata?.createAdditionalTokenNamed || '').trim();
  if (!name) return undefined;
  const powerRaw = metadata?.createAdditionalTokenPower;
  const toughnessRaw = metadata?.createAdditionalTokenToughness;
  const colors = Array.isArray(metadata?.createAdditionalTokenColors)
    ? (metadata!.createAdditionalTokenColors as unknown[]).map((c) => String(c))
    : undefined;
  const abilities = Array.isArray(metadata?.createAdditionalTokenAbilities)
    ? (metadata!.createAdditionalTokenAbilities as unknown[]).map((a) => String(a))
    : undefined;
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    count: 1,
    typeLine: metadata?.createAdditionalTokenTypeLine ? String(metadata.createAdditionalTokenTypeLine) : undefined,
    ...(powerRaw != null && Number.isFinite(Number(powerRaw)) ? { power: Number(powerRaw) } : {}),
    ...(toughnessRaw != null && Number.isFinite(Number(toughnessRaw)) ? { toughness: Number(toughnessRaw) } : {}),
    ...(colors && colors.length ? { colors } : {}),
    ...(abilities && abilities.length ? { abilities } : {}),
    ...(sourceName ? { sourceName } : {}),
  };
}

export function replacedTokenFromSpecMetadata(
  metadata: Record<string, unknown> | undefined,
): ReplacedCreatedToken | undefined {
  const name = String(metadata?.replaceCreatedTokenNamed || '').trim();
  if (!name) return undefined;
  const powerRaw = metadata?.replaceCreatedTokenPower;
  const toughnessRaw = metadata?.replaceCreatedTokenToughness;
  const colors = Array.isArray(metadata?.replaceCreatedTokenColors)
    ? (metadata!.replaceCreatedTokenColors as unknown[]).map((c) => String(c))
    : undefined;
  const abilities = Array.isArray(metadata?.replaceCreatedTokenAbilities)
    ? (metadata!.replaceCreatedTokenAbilities as unknown[]).map((a) => String(a))
    : undefined;
  return {
    name,
    typeLine: metadata?.replaceCreatedTokenTypeLine ? String(metadata.replaceCreatedTokenTypeLine) : undefined,
    ...(powerRaw != null && Number.isFinite(Number(powerRaw)) ? { power: Number(powerRaw) } : {}),
    ...(toughnessRaw != null && Number.isFinite(Number(toughnessRaw)) ? { toughness: Number(toughnessRaw) } : {}),
    ...(colors && colors.length ? { colors } : {}),
    ...(abilities && abilities.length ? { abilities } : {}),
  };
}
