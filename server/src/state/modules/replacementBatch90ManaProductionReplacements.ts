// server/src/state/modules/replacementBatch90ManaProductionReplacements.ts
// B90: generic "if you tap a [basic land|land|permanent] for mana, it produces
// N times as much of that mana instead" (Mana Reflection, Nyxbloom Ancient,
// Virtue of Strength). Applied on the mana-ability path via getManaMultiplier.
// Public: parseBatch90ManaProductionSentence, collectBatch90ManaProductionReplacementSpecs,
// oracleManaMultiplierForPermanent, getOracleManaProductionMultiplier,
// nameTableManaMultiplierAlreadyCoveredByOracle, manaMultiplierAffectsTappedPermanent.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

export type ManaProductionMultiplierAffects = 'permanents' | 'lands' | 'basic_lands';

export type ParsedManaProductionMultiplier = {
  multiplier: number;
  affects: ManaProductionMultiplierAffects;
};

const TIMES_WORDS: Record<string, number> = {
  twice: 2,
  'two times': 2,
  'three times': 3,
  'four times': 4,
  'five times': 5,
};

const TAP_FOR_MANA_TIMES_RE =
  /if you tap (?:a |an )?((?:basic )?(?:land|permanent)) for mana, it produces (twice|two times|three times|four times|five times|\d+ times) as much(?: of that mana)? instead/gi;

function readTimes(raw: string): number | undefined {
  const key = String(raw || '').trim().toLowerCase();
  if (TIMES_WORDS[key] != null) return TIMES_WORDS[key];
  const m = key.match(/^(\d+)\s*times$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 2 ? n : undefined;
}

function readAffects(raw: string): ManaProductionMultiplierAffects {
  const s = String(raw || '').trim().toLowerCase();
  if (s.startsWith('basic')) return 'basic_lands';
  if (s.includes('land')) return 'lands';
  return 'permanents';
}

export function parseBatch90ManaProductionSentence(oracle: string): ParsedManaProductionMultiplier[] {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: ParsedManaProductionMultiplier[] = [];
  TAP_FOR_MANA_TIMES_RE.lastIndex = 0;
  for (const m of text.matchAll(TAP_FOR_MANA_TIMES_RE)) {
    const multiplier = readTimes(m[2] || '');
    if (multiplier == null) continue;
    out.push({ multiplier, affects: readAffects(m[1] || '') });
  }
  return out;
}

function modifyFor(multiplier: number): 'double' | 'triple' | 'add_flat' {
  if (multiplier === 2) return 'double';
  if (multiplier === 3) return 'triple';
  return 'add_flat';
}

export function collectBatch90ManaProductionReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const parsed = parseBatch90ManaProductionSentence(oracle);
  return parsed.map((entry, index) => ({
    id: `${source.sourcePermanentId}:tap-for-mana-times-${entry.multiplier}:${entry.affects}:${index}`,
    event: 'mana-production',
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: {
      tappingPlayerIsSourceController: true,
      ...(entry.affects === 'lands' ? { tappedIsLand: true } : {}),
      ...(entry.affects === 'basic_lands' ? { tappedIsBasicLand: true } : {}),
    },
    instead: {
      modify: modifyFor(entry.multiplier),
      ...(entry.multiplier > 3 ? { value: entry.multiplier } : {}),
    },
    effectId: `tap-${entry.affects}-mana-times-${entry.multiplier}`,
    reason: 'mana_production_multiplier',
    metadata: { manaMultiplier: entry.multiplier, manaAffects: entry.affects },
  }) as ReplacementEffectSpec);
}

export function collectBatch90ManaProductionReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch90ManaProductionReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function manaMultiplierAffectsTappedPermanent(
  permanent: any,
  affects: ManaProductionMultiplierAffects | string | undefined,
): boolean {
  if (!affects || affects === 'permanents') return true;
  const tl = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  const isLand = /\bland\b/.test(tl);
  if (affects === 'lands' || affects === 'all_lands') return isLand;
  if (affects === 'basic_lands') return isLand && /\bbasic\b/.test(tl);
  return true;
}

export function oracleManaMultiplierForPermanent(oracle: string, permanent: any): number {
  let multiplier = 1;
  for (const entry of parseBatch90ManaProductionSentence(oracle)) {
    if (!manaMultiplierAffectsTappedPermanent(permanent, entry.affects)) continue;
    multiplier *= entry.multiplier;
  }
  return multiplier;
}

export function nameTableManaMultiplierAlreadyCoveredByOracle(oracle: string): boolean {
  return parseBatch90ManaProductionSentence(oracle).length > 0;
}

export function getOracleManaProductionMultiplier(
  state: any,
  playerId: string,
  tappedPermanent: any,
): number {
  const pid = String(playerId || '');
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let multiplier = 1;
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== pid) continue;
    const oracle = readCardOracleText(perm.card);
    const local = oracleManaMultiplierForPermanent(oracle, tappedPermanent);
    if (local > 1) multiplier *= local;
  }
  return multiplier;
}
