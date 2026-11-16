// server/src/state/modules/batch96LifePayExile.ts
// B96: "If you would pay life while your library has at least that many
// cards in it, exile that many cards from the top of your library instead."
// (Ashiok, Wicked Manipulator.) Public: parseAshiokLifePayExile,
// collectBatch96LifePayExileSpecs, applyAshiokLifePayExile.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { noteManaValueAsExiled } from '../../../../rules-engine/src/batch97ExileManaValueNote.js';

const ASHIOK_RE = /if you would pay life while your library has at least that many cards in it, exile that many cards from the top of your library instead/i;

export function parseAshiokLifePayExile(oracle: string): boolean {
  return ASHIOK_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function collectBatch96LifePayExileSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  if (!parseAshiokLifePayExile(oracle)) return [];
  return [{
    id: `${source.sourcePermanentId}:pay-life-exile-library-top`,
    event: 'life-payment' as any,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { playerIsSourceController: true },
    instead: { redirectZone: 'exile', effect: 'exile_library_top_equal_to_life' },
    effectId: 'pay-life-exile-library-top',
    reason: 'pay_life_exile_library_top',
  } as ReplacementEffectSpec];
}

export function collectBatch96LifePayExileSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch96LifePayExileSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function playerHasAshiokLifePayExile(state: any, playerId: string): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true || String(perm.controller || '') !== String(playerId)) return false;
    return parseAshiokLifePayExile(readCardOracleText(perm.card) || String(perm.oracle_text || ''));
  });
}

function libraryOf(state: any, playerId: string): any[] {
  const zones = state?.zones?.[playerId];
  if (Array.isArray(zones?.library)) return zones.library;
  if (state?.libraries && typeof state.libraries.get === 'function') return state.libraries.get(playerId) || [];
  if (Array.isArray(state?.libraries?.[playerId])) return state.libraries[playerId];
  return [];
}

/**
 * If the player would pay `lifeAmount` life and their library is large enough,
 * exile that many cards from the top instead and return true (the life is not paid).
 */
export function applyAshiokLifePayExile(state: any, playerId: string, lifeAmount: number): { replaced: boolean; exiled: number } {
  const amount = Math.max(0, Math.floor(Number(lifeAmount) || 0));
  if (!amount || !playerHasAshiokLifePayExile(state, playerId)) return { replaced: false, exiled: 0 };
  const zones = (state.zones = state.zones || {});
  zones[playerId] = zones[playerId] || { library: [], exile: [] };
  const lib = Array.isArray(zones[playerId].library) ? zones[playerId].library : (zones[playerId].library = libraryOf(state, playerId).slice());
  if (lib.length < amount) return { replaced: false, exiled: 0 };
  const exile: any[] = Array.isArray(zones[playerId].exile) ? zones[playerId].exile : (zones[playerId].exile = []);
  const moved = lib.splice(0, amount).map((c: any) => ({ ...c, zone: 'exile' }));
  exile.push(...moved);
  for (const card of moved) noteManaValueAsExiled(state, card);
  if (zones[playerId].libraryCount != null) zones[playerId].libraryCount = lib.length;
  if (zones[playerId].exileCount != null) zones[playerId].exileCount = exile.length;
  return { replaced: true, exiled: moved.length };
}
