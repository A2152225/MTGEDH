// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: classifyChoiceTarget, normalizeChosenManaSelection.
// Public entry symbols: classifyChoiceTarget, normalizeChosenManaSelection.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';

export function classifyChoiceTarget(
  state: GameState,
  targetId: string,
  controllerId: string
): 'creature' | 'permanent' | 'player' {
  const player = (state.players || []).find(candidate => String(candidate.id || '').trim() === targetId);
  if (player) {
    return 'player';
  }

  const permanent = ((state as any).battlefield || []).find((candidate: any) => String(candidate?.id || '').trim() === targetId);
  const typeLine = String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || '').toLowerCase();
  if (typeLine.includes('creature')) {
    return 'creature';
  }

  void controllerId;
  return 'permanent';
}

export function normalizeChosenManaSelection(selection: string): string {
  const normalized = selection.trim();
  if (/^\{[WUBRG]\}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (/^[WUBRG]$/i.test(normalized)) {
    return `{${normalized.toUpperCase()}}`;
  }

  const colorNameToSymbol: Record<string, string> = {
    white: '{W}',
    blue: '{U}',
    black: '{B}',
    red: '{R}',
    green: '{G}',
  };
  return colorNameToSymbol[normalized.toLowerCase()] || normalized.toUpperCase();
}
