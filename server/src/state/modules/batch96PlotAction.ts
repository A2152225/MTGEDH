// server/src/state/modules/batch96PlotAction.ts
// B96: Fblthp-style "top card of your library has plot / you may plot
// nonland cards from the top of your library." Sets isPlotted and uses
// the card's mana cost (or a granted plot cost).
// Public: getLibraryTopPlotAction, canPlotLibraryTopCard, applyPlotLibraryTopCard.

import { getGrantedSpellOrHandKeyword } from './batch95SpellAndHandKeywordGrants.js';

export interface LibraryTopPlotAction {
  card: any;
  cost: string;
  playerId: string;
}

function libraryTopForPlayer(state: any, playerId: string): any | undefined {
  const zones = state?.zones?.[playerId];
  const fromZones = Array.isArray(zones?.library) ? zones.library : null;
  if (fromZones && fromZones.length) return fromZones[0];
  const libraries = state?.libraries;
  if (libraries && typeof libraries.get === 'function') {
    const lib = libraries.get(playerId) || [];
    return lib[0];
  }
  if (libraries && Array.isArray(libraries[playerId])) return libraries[playerId][0];
  return undefined;
}

function isLandCard(card: any): boolean {
  return /\bland\b/i.test(String(card?.type_line || card?.typeLine || ''));
}

function manaCostOf(card: any): string {
  return String(card?.mana_cost || card?.manaCost || '').trim();
}

export function getLibraryTopPlotAction(state: any, playerId: string): LibraryTopPlotAction | null {
  if (!state || !playerId) return null;
  const top = libraryTopForPlayer(state, playerId);
  if (!top) return null;
  const grant = getGrantedSpellOrHandKeyword(state, playerId, top, 'plot', { zone: 'any' })
    || getGrantedSpellOrHandKeyword(state, playerId, top, 'plot', { zone: 'library_top' as any });
  if (!grant) return null;
  if (grant.filter && (grant.filter as any).nonland && isLandCard(top)) return null;
  if (isLandCard(top) && /nonland/.test(String((grant as any).filterText || grant.filter?.zone || ''))) return null;
  const cost = String(grant.cost || manaCostOf(top)).trim();
  if (!cost && !grant.costEqualsManaCost) return null;
  const resolved = cost || manaCostOf(top);
  if (!resolved) return null;
  if (isLandCard(top)) return null;
  return { card: top, cost: resolved, playerId: String(playerId) };
}

export function canPlotLibraryTopCard(state: any, playerId: string): boolean {
  return getLibraryTopPlotAction(state, playerId) != null;
}

/** Exile the top library card as plotted. Does not open a payment prompt. */
export function applyPlotLibraryTopCard(state: any, playerId: string): any | null {
  const action = getLibraryTopPlotAction(state, playerId);
  if (!action) return null;
  const zones = (state.zones = state.zones || {});
  zones[playerId] = zones[playerId] || { library: [], exile: [], hand: [], graveyard: [] };
  const lib: any[] = Array.isArray(zones[playerId].library) ? zones[playerId].library : (zones[playerId].library = []);
  let card = action.card;
  const idx = lib.findIndex((c: any) => c && String(c.id) === String(card.id));
  if (idx >= 0) card = lib.splice(idx, 1)[0];
  else if (lib[0] === card) card = lib.shift();
  card = { ...card, zone: 'exile', isPlotted: true, plotCost: action.cost, plottedBy: String(playerId) };
  const exile: any[] = Array.isArray(zones[playerId].exile) ? zones[playerId].exile : (zones[playerId].exile = []);
  exile.push(card);
  if (zones[playerId].libraryCount != null) zones[playerId].libraryCount = lib.length;
  if (zones[playerId].exileCount != null) zones[playerId].exileCount = exile.length;
  return card;
}
