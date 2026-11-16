// server/src/state/modules/replacementBatch96ExploreAndMana.ts
// B96: Twists and Turns "If a creature you control would explore, instead you
// scry N, then that creature explores." and Yurlok "A player losing unspent
// mana causes that player to lose that much life."
// Public: parseTwistsAndTurnsExploreReplacement, collectBatch96ExploreReplacementSpecs,
// twistsAndTurnsExploreScryCount, playerHasTwistsAndTurnsExploreReplacement,
// playerLosingUnspentManaLosesThatMuchLife, unspentManaAmount, applyYurlokUnspentManaLifeLossAmount.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const TWISTS_RE = /if a creature you control would explore, instead you scry (one|two|three|four|five|\d+), then that creature explores/i;
const YURLOK_RE = /a player losing unspent mana causes that player to lose that much life/i;

export function parseTwistsAndTurnsExploreReplacement(oracle: string): number | null {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const m = text.match(TWISTS_RE);
  if (!m) return null;
  const raw = String(m[1] || '1').toLowerCase();
  const n = WORD[raw] ?? parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function collectBatch96ExploreReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const scry = parseTwistsAndTurnsExploreReplacement(oracle);
  if (!scry) return [];
  return [{
    id: `${source.sourcePermanentId}:explore-then-scry-then-explore`,
    event: 'explore' as any,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { objectControllerIsSourceController: true, objectTypeLineIncludes: 'creature' },
    instead: { effect: 'scry_then_explore', scryCount: scry },
    effectId: 'explore-scry-then-explore',
    reason: 'explore_scry_then_explore',
    metadata: { scryCount: scry },
  } as ReplacementEffectSpec];
}

export function collectBatch96ExploreReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch96ExploreReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function twistsAndTurnsExploreScryCount(state: any, playerId: string): number {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let total = 0;
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || String(perm.controller || '') !== String(playerId)) continue;
    const n = parseTwistsAndTurnsExploreReplacement(readCardOracleText(perm.card) || String(perm.oracle_text || ''));
    if (n) total += n;
  }
  return total;
}

export function playerHasTwistsAndTurnsExploreReplacement(state: any, playerId: string): boolean {
  return twistsAndTurnsExploreScryCount(state, playerId) > 0;
}

export function parseYurlokUnspentManaLifeLoss(oracle: string): boolean {
  return YURLOK_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function playerLosingUnspentManaLosesThatMuchLife(state: any): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true || !perm.card) return false;
    return parseYurlokUnspentManaLifeLoss(readCardOracleText(perm.card) || String(perm.oracle_text || ''));
  });
}

export function unspentManaAmount(pool: any): number {
  if (!pool || typeof pool !== 'object') return 0;
  let total = 0;
  for (const value of Object.values(pool)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/** Life a player loses when that much unspent mana empties, if Yurlok is on the battlefield. */
export function applyYurlokUnspentManaLifeLossAmount(state: any, lostMana: number): number {
  if (!playerLosingUnspentManaLosesThatMuchLife(state)) return 0;
  const n = Math.max(0, Math.floor(Number(lostMana) || 0));
  return n;
}
