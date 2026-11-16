// server/src/state/modules/replacementBatch91NamedTokenReplacements.ts
// B91: token identity substitution generalizations:
//  - Holo-Engineer: "if one or more tokens would be created under your control,
//    that many 3/3 colorless Illusion artifact creature tokens are created instead"
//    (Divine Visitation-style, but any tokens, and the result may be an artifact creature).
//  - Fisher's Talent: "if you would create a Fish token, create a 3/3 blue Shark
//    creature token instead" (and Shark → Octopus). Named substitutions chain.
// Public: parseBatch91TokenIdentitySubstitution, parseBatch91NamedTokenSubstitution,
// collectBatch91NamedTokenReplacementSpecs, collectBatch91NamedTokenReplacementSpecsFromState,
// chainNamedTokenSubstitutions.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import type { ReplacedCreatedToken } from './replacementBatch90ExtraDifferentTypeTokens.js';

// Avoid depending on a non-exported helper: rebuild typeline locally.
const COLOR_WORDS: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
};

function cap(s: string): string {
  const t = String(s || '').trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function parseColors(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw).toLowerCase().split(/\s+and\s+|\s+/).map((w) => COLOR_WORDS[w]).filter((c): c is string => !!c && c !== 'C');
}

function parseAbilities(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw).toLowerCase().split(/\s+and\s+/).map((s) => s.trim()).filter(Boolean);
}

function typeLineFor(opts: { name: string; isArtifact?: boolean; isCreature?: boolean }): string | undefined {
  const bits: string[] = [];
  if (opts.isArtifact) bits.push('Artifact');
  if (opts.isCreature) bits.push('Creature');
  if (!bits.length) return undefined;
  const sub = cap(opts.name);
  return sub ? `${bits.join(' ')} \u2014 ${sub}` : bits.join(' ');
}

const ANY_IDENTITY_RE =
  /if (?:one or more|1 or more)(?: (creature|artifact))? tokens would be created under your control, (?:that many|those tokens are) (\d+)\s*\/\s*(\d+) ((?:colorless|white|blue|black|red|green)(?: and (?:colorless|white|blue|black|red|green))*) ([a-z][a-z'-]*)(?: (artifact))?(?: (creature))? tokens?(?: with ([a-z]+(?: and [a-z]+)*))?(?: are created)? instead/gi;

const NAMED_RE =
  /if you would create an? ([a-z][a-z'-]*) tokens?, create an? (\d+)\s*\/\s*(\d+) ((?:colorless|white|blue|black|red|green)(?: and (?:colorless|white|blue|black|red|green))*) ([a-z][a-z'-]*)(?: (artifact))?(?: (creature))? tokens?(?: with ([a-z]+(?: and [a-z]+)*))? instead/gi;

function tokenFromMatch(m: RegExpMatchArray, nameIdx: number, powerIdx: number, toughnessIdx: number, colorIdx: number, artifactIdx: number, creatureIdx: number, abilityIdx: number): ReplacedCreatedToken | undefined {
  const power = Number(m[powerIdx]);
  const toughness = Number(m[toughnessIdx]);
  const name = cap(m[nameIdx] || '');
  if (!name || !Number.isFinite(power) || !Number.isFinite(toughness)) return undefined;
  const isArtifact = Boolean(m[artifactIdx]);
  const isCreature = Boolean(m[creatureIdx]) || true;
  const colors = parseColors(m[colorIdx]);
  const abilities = parseAbilities(m[abilityIdx]);
  return {
    name,
    typeLine: typeLineFor({ name, isArtifact, isCreature }),
    power,
    toughness,
    ...(colors.length ? { colors } : {}),
    ...(abilities.length ? { abilities } : {}),
  };
}

export function parseBatch91TokenIdentitySubstitution(oracle: string): Array<{ filter: 'any' | 'creature' | 'artifact'; token: ReplacedCreatedToken }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ filter: 'any' | 'creature' | 'artifact'; token: ReplacedCreatedToken }> = [];
  ANY_IDENTITY_RE.lastIndex = 0;
  for (const m of text.matchAll(ANY_IDENTITY_RE)) {
    const filterRaw = String(m[1] || '').trim().toLowerCase();
    const filter: 'any' | 'creature' | 'artifact' = filterRaw === 'creature' || filterRaw === 'artifact' ? filterRaw : 'any';
    const token = tokenFromMatch(m, 5, 2, 3, 4, 6, 7, 8);
    // Creature-only identity (Divine Visitation) stays on the B90 parser.
    if (token && filter !== 'creature') out.push({ filter, token });
  }
  return out;
}

export function parseBatch91NamedTokenSubstitution(oracle: string): Array<{ fromName: string; token: ReplacedCreatedToken }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ fromName: string; token: ReplacedCreatedToken }> = [];
  NAMED_RE.lastIndex = 0;
  for (const m of text.matchAll(NAMED_RE)) {
    const fromName = cap(m[1] || '');
    const token = tokenFromMatch(m, 5, 2, 3, 4, 6, 7, 8);
    if (fromName && token) out.push({ fromName, token });
  }
  return out;
}

export function collectBatch91NamedTokenReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  for (const entry of parseBatch91TokenIdentitySubstitution(oracle)) {
    specs.push({
      id: `${source.sourcePermanentId}:token-identity-${entry.token.name.toLowerCase()}`,
      event: 'token-creation',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {
        creatingPlayerIsSourceController: true,
        ...(entry.filter === 'creature' ? { tokenIsCreature: true } : {}),
        ...(entry.filter === 'artifact' ? { tokenIsArtifact: true } : {}),
      },
      instead: { modify: 'add_flat', value: 0 },
      effectId: `controller-token-identity-${entry.token.name.toLowerCase()}`,
      reason: 'controller_token_identity_substitution',
      metadata: {
        replaceCreatedTokenNamed: entry.token.name,
        ...(entry.token.typeLine ? { replaceCreatedTokenTypeLine: entry.token.typeLine } : {}),
        ...(entry.token.power != null ? { replaceCreatedTokenPower: entry.token.power } : {}),
        ...(entry.token.toughness != null ? { replaceCreatedTokenToughness: entry.token.toughness } : {}),
        ...(entry.token.colors ? { replaceCreatedTokenColors: entry.token.colors } : {}),
        ...(entry.token.abilities ? { replaceCreatedTokenAbilities: entry.token.abilities } : {}),
      },
    } as ReplacementEffectSpec);
  }
  for (const entry of parseBatch91NamedTokenSubstitution(oracle)) {
    specs.push({
      id: `${source.sourcePermanentId}:named-token-${entry.fromName.toLowerCase()}-to-${entry.token.name.toLowerCase()}`,
      event: 'token-creation',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {
        creatingPlayerIsSourceController: true,
        tokenNameIs: entry.fromName.toLowerCase(),
      },
      instead: { modify: 'add_flat', value: 0 },
      effectId: `named-token-${entry.fromName.toLowerCase()}-becomes-${entry.token.name.toLowerCase()}`,
      reason: 'named_token_identity_substitution',
      metadata: {
        replaceFromTokenNamed: entry.fromName.toLowerCase(),
        replaceCreatedTokenNamed: entry.token.name,
        ...(entry.token.typeLine ? { replaceCreatedTokenTypeLine: entry.token.typeLine } : {}),
        ...(entry.token.power != null ? { replaceCreatedTokenPower: entry.token.power } : {}),
        ...(entry.token.toughness != null ? { replaceCreatedTokenToughness: entry.token.toughness } : {}),
        ...(entry.token.colors ? { replaceCreatedTokenColors: entry.token.colors } : {}),
        ...(entry.token.abilities ? { replaceCreatedTokenAbilities: entry.token.abilities } : {}),
      },
    } as ReplacementEffectSpec);
  }
  return specs;
}

export function collectBatch91NamedTokenReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch91NamedTokenReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function chainNamedTokenSubstitutions(
  startName: string,
  substitutions: Array<{ fromName: string; token: ReplacedCreatedToken }>,
  maxSteps = 8,
): ReplacedCreatedToken | undefined {
  let current = String(startName || '').trim();
  if (!current) return undefined;
  let result: ReplacedCreatedToken | undefined;
  for (let step = 0; step < maxSteps; step++) {
    const hit = substitutions.find((s) => s.fromName.toLowerCase() === current.toLowerCase());
    if (!hit) break;
    result = hit.token;
    current = hit.token.name;
  }
  return result;
}

