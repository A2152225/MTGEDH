// convokeCostReduction.ts
// Convoke (CR 702.51): each creature tapped while casting pays for {1} or one mana of that
// creature's color. The cast modal subtracts the selected creatures from the (already reduced,
// X-applied) cost before suggesting mana sources and checking payability, so tapping 21 Soldiers
// for an X=20 white spell under Pearl Medallion is payable (issue #55).
// Public entry symbols: applyConvokeToCost, ConvokeCreatureLike.

import type { Color } from './manaUtils';

export interface ConvokeCreatureLike {
  id: string;
  colors?: string[];
  canTapFor?: string[];
}

const NAME_TO_COLOR: Record<string, Color> = {
  white: 'W' as Color, blue: 'U' as Color, black: 'B' as Color, red: 'R' as Color, green: 'G' as Color,
  w: 'W' as Color, u: 'U' as Color, b: 'B' as Color, r: 'R' as Color, g: 'G' as Color,
};

function creatureColors(creature: ConvokeCreatureLike): Color[] {
  const out = new Set<Color>();
  for (const raw of [...(creature.colors || []), ...(creature.canTapFor || [])]) {
    const color = NAME_TO_COLOR[String(raw || '').toLowerCase()];
    if (color) out.add(color);
  }
  return [...out];
}

/**
 * Remaining cost after the selected convoke creatures pay: colored pips of a creature's color
 * first (the scarcest resource), then hybrid pips it can pay, then generic.
 */
export function applyConvokeToCost<T extends { colors: Record<Color, number>; generic: number; hybrids: Color[][] }>(
  cost: T,
  creatures: readonly ConvokeCreatureLike[],
): T & { convokeUnused: number } {
  const colors = { ...cost.colors } as Record<Color, number>;
  let generic = Math.max(0, Number(cost.generic || 0));
  const hybrids = cost.hybrids.map((h) => [...h]);
  let unused = 0;
  for (const creature of creatures) {
    const own = creatureColors(creature);
    const pip = own.find((c) => Number(colors[c] || 0) > 0);
    if (pip) {
      colors[pip] = Number(colors[pip]) - 1;
      continue;
    }
    const hybridIndex = hybrids.findIndex((h) => h.some((c) => own.includes(c)));
    if (hybridIndex >= 0) {
      hybrids.splice(hybridIndex, 1);
      continue;
    }
    if (generic > 0) {
      generic -= 1;
      continue;
    }
    unused += 1;
  }
  return { ...cost, colors, generic, hybrids, convokeUnused: unused };
}
