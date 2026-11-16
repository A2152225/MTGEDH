/**
 * View/playable-id helpers for Fblthp-style plot-from-library-top special actions.
 * Public: libraryTopPlotPlayableId, isLibraryTopPlotPlayableId, buildLibraryTopPlotActionView.
 */
import { getLibraryTopPlotAction, type LibraryTopPlotAction } from './batch96PlotAction.js';

export function libraryTopPlotPlayableId(playerId: string): string {
  return `library-plot-${String(playerId)}`;
}

export function isLibraryTopPlotPlayableId(id: string, playerId?: string): boolean {
  const raw = String(id || '');
  if (playerId) return raw === libraryTopPlotPlayableId(playerId);
  return raw.startsWith('library-plot-');
}

export interface LibraryTopPlotActionView {
  cardId: string;
  cardName: string;
  cost: string;
  playerId: string;
}

export function toLibraryTopPlotActionView(action: LibraryTopPlotAction | null): LibraryTopPlotActionView | null {
  if (!action?.card) return null;
  const cardId = String(action.card.id || action.card.cardId || '').trim();
  if (!cardId) return null;
  return {
    cardId,
    cardName: String(action.card.name || action.card.card?.name || 'Card'),
    cost: String(action.cost || '').trim(),
    playerId: String(action.playerId),
  };
}

export function buildLibraryTopPlotActionView(state: any, playerId: string): LibraryTopPlotActionView | null {
  try {
    return toLibraryTopPlotActionView(getLibraryTopPlotAction(state, playerId));
  } catch {
    return null;
  }
}
