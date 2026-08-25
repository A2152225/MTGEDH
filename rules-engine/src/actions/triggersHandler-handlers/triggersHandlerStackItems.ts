// Origin parent: rules-engine/src/actions/triggersHandler.ts
// Cluster moved: getStackItems.
// Public entry symbols: getStackItems.
// Leaf must not import actions/triggersHandler.ts or triggersHandler-handlers/index.ts.

import type { GameState } from '../../../../shared/src';

export function getStackItems(state: GameState): any[] {
  const rawStack = (state as any)?.stack;
  if (Array.isArray(rawStack)) return rawStack;
  if (Array.isArray((rawStack as any)?.objects)) return [...(rawStack as any).objects];
  return [];
}
