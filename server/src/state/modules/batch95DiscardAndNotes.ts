// server/src/state/modules/batch95DiscardAndNotes.ts
// B95: Library of Leng discard-to-library-top replacement (choice is a UI
// need — this only parses, collects, and applies a decided destination) and
// Bell Borca noted-mana-value CDA helpers.
// Public: parseLibraryOfLengDiscardReplacement, collectBatch95DiscardReplacementSpecs,
// collectBatch95DiscardReplacementSpecsFromState, applyLibraryOfLengDiscardDestination,
// noteManaValueAsExiledForBorca, getGreatestNotedManaValueThisTurn,
// playerHasLibraryOfLengDiscardReplacement.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { noteManaValueAsExiled as noteManaValueAsExiledShared } from '../../../../rules-engine/src/batch97ExileManaValueNote.js';

const LENG_RE = /if an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard/i;
const BORCA_NOTE_RE = /note the mana value of each card as it's put into exile/i;
const BORCA_POWER_RE = /(?:this creature|~|[^\\n]+?)'s power is equal to the greatest number noted for (?:it|this creature|~) this turn/i;

export function parseLibraryOfLengDiscardReplacement(oracle: string): boolean {
  return LENG_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function playerHasLibraryOfLengDiscardReplacement(state: any, playerId: string): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true || String(perm.controller || '') !== String(playerId)) return false;
    return parseLibraryOfLengDiscardReplacement(readCardOracleText(perm.card) || String(perm.oracle_text || ''));
  });
}

export function collectBatch95DiscardReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  if (!parseLibraryOfLengDiscardReplacement(oracle)) return [];
  return [{
    id: `${source.sourcePermanentId}:discard-to-library-top-optional`,
    event: 'zone-change' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { destinationZone: 'graveyard', sourceZone: 'hand' },
    instead: { redirectZone: 'library', choiceRequired: true },
    effectId: 'discard-to-library-top-optional',
    reason: 'discard_to_library_top_optional',
    metadata: { libraryPosition: 'top', optional: true },
  } as ReplacementEffectSpec];
}

export function collectBatch95DiscardReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch95DiscardReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

/** Apply an already-decided Library of Leng destination. Does not open a prompt. */
export function applyLibraryOfLengDiscardDestination(state: any, playerId: string, card: any, putOnLibraryTop: boolean): boolean {
  if (!putOnLibraryTop || !card || !playerId) return false;
  if (!playerHasLibraryOfLengDiscardReplacement(state, playerId)) return false;
  const zones = (state.zones = state.zones || {});
  zones[playerId] = zones[playerId] || { library: [], graveyard: [], hand: [] };
  const lib: any[] = Array.isArray(zones[playerId].library) ? zones[playerId].library : (zones[playerId].library = []);
  const gy: any[] = Array.isArray(zones[playerId].graveyard) ? zones[playerId].graveyard : [];
  const gyIndex = gy.findIndex((c: any) => c && String(c.id) === String(card.id));
  const moving = gyIndex >= 0 ? gy.splice(gyIndex, 1)[0] : { ...card };
  lib.unshift({ ...moving, zone: 'library' });
  if (zones[playerId].graveyardCount != null) zones[playerId].graveyardCount = gy.length;
  if (zones[playerId].libraryCount != null) zones[playerId].libraryCount = lib.length;
  return true;
}

export function parseNotesManaValueAsExiled(oracle: string): boolean {
  return BORCA_NOTE_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function parsePowerEqualsGreatestNotedThisTurn(oracle: string): boolean {
  return BORCA_POWER_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

/** Stamp each noting permanent with the exiled card's mana value for this turn. */
export function noteManaValueAsExiledForBorca(state: any, card: any): void {
  noteManaValueAsExiledShared(state, card);

}

export function getGreatestNotedManaValueThisTurn(perm: any, state?: any): number | null {
  if (!perm?.card || !parsePowerEqualsGreatestNotedThisTurn(readCardOracleText(perm.card))) return null;
  const turn = Number(state?.turnNumber ?? state?.turn ?? perm.notedManaValuesTurn ?? 0);
  if (perm.notedManaValuesTurn != null && turn !== Number(perm.notedManaValuesTurn)) return 0;
  const notes: number[] = Array.isArray(perm.notedManaValuesThisTurn) ? perm.notedManaValuesThisTurn : [];
  if (!notes.length) return 0;
  return Math.max(0, ...notes.map((n) => Number(n) || 0));
}
