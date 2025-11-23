import type { GameState, PlayerID } from '../../shared/src';

export function applyCommanderTax(
  state: Readonly<GameState>,
  player: PlayerID,
  commanderCardId: string
): GameState {
  const info = state.commandZone[player];
  if (!info) return state;
  const tax = (info.tax ?? 0) + 2;
  return {
    ...state,
    commandZone: {
      ...state.commandZone,
      [player]: {
        ...info,
        tax
      }
    }
  };
}