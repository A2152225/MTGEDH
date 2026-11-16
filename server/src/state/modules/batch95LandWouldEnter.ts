// server/src/state/modules/batch95LandWouldEnter.ts
// B95: generalize "if this land would enter, sacrifice a[n] [untapped] [Island|Forest|…] instead"
// (Soldevi Excavations, Heart of Yavimaya, Balduvian Trading Post) on top of the
// existing generic-lands parser. Public: parseTypedLandWouldEnterSacrifice,
// landMatchesTypedWouldEnterSacrifice, collectBatch95LandWouldEnterReplacementSpecs,
// collectBatch95LandWouldEnterReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import type { LandWouldEnterSacrificeReplacement } from './land-would-enter-replacement.js';

const WORD: Record<string, number> = { a: 1, an: 1, two: 2, three: 3, four: 4, five: 5 };

const TYPE_RE = /if (?:this land|this permanent|~) would enter(?: the battlefield)?,?\s*(?:instead\s+)?sacrifice\s+(two|three|four|five|\d+|a|an)\s+(untapped\s+)?(?:basic\s+)?(islands?|forests?|mountains?|swamps?|plains|lands?)\s+instead/i;

function singularLandType(raw: string): string | undefined {
  const t = String(raw || '').toLowerCase().replace(/s$/, '');
  if (!t || t === 'land') return undefined;
  if (t === 'plain') return 'plains';
  return t;
}

export function parseTypedLandWouldEnterSacrifice(oracleText: string): LandWouldEnterSacrificeReplacement | null {
  const text = normalizeOraclePatternText(String(oracleText || '')).replace(/\u2019/g, "'");
  const m = text.match(TYPE_RE);
  if (!m) return null;
  const countWord = String(m[1] || '').toLowerCase();
  const sacrificeCount = WORD[countWord] ?? Math.max(1, parseInt(countWord, 10) || 1);
  const requireType = singularLandType(m[3] || '');
  return {
    sacrificeCount,
    requireUntapped: Boolean(m[2]),
    ...(requireType ? { requireType } : {}),
  } as LandWouldEnterSacrificeReplacement;
}

export function landMatchesTypedWouldEnterSacrifice(perm: any, replacement: LandWouldEnterSacrificeReplacement): boolean {
  if (!perm) return false;
  const typeLine = String(perm.card?.type_line || perm.type_line || '').toLowerCase();
  if (!/\bland\b/.test(typeLine)) return false;
  if (replacement.requireUntapped && perm.tapped) return false;
  const required = String((replacement as any).requireType || '').toLowerCase();
  if (required && !new RegExp(`\\b${required}\\b`).test(typeLine)) return false;
  return true;
}

export function collectBatch95LandWouldEnterReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const parsed = parseTypedLandWouldEnterSacrifice(oracle);
  if (!parsed) return [];
  return [{
    id: `${source.sourcePermanentId}:land-would-enter-sacrifice`,
    event: 'zone-change' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { objectIsSource: true, destinationZone: 'battlefield' },
    instead: { choiceRequired: true },
    effectId: 'land-would-enter-sacrifice',
    reason: 'land_would_enter_sacrifice',
    metadata: {
      sacrificeCount: parsed.sacrificeCount,
      requireUntapped: parsed.requireUntapped,
      requireType: (parsed as any).requireType,
    },
  } as ReplacementEffectSpec];
}

export function collectBatch95LandWouldEnterReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch95LandWouldEnterReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
