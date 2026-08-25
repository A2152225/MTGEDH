// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: getTotalManaFromPool, applyAnyColorReduction, canPayManaCost, getMaxXValue.
// Public entry symbols: getTotalManaFromPool, canPayManaCost, getMaxXValue.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

/**
 * Get total available mana from a mana pool.
 * 
 * NOTE: This function now handles the 'anyColor' field specially.
 * When calculating total, we don't count 'anyColor' separately since those 
 * mana sources already have their potential colors represented in the pool.
 * The 'anyColor' field is used by canPayManaCost to properly allocate mana.
 */
export function getTotalManaFromPool(pool: Record<string, number>): number {
  if (!pool) return 0;

  // If the pool has 'anyColor' tracking, we need to calculate correctly.
  // anyColor sources can produce ANY color, but only count as 1 mana each.
  const anyColorCount = pool.anyColor || 0;

  // Additional tracking for "choice" sources (e.g., lands with multiple separate tap abilities:
  // "{T}: Add {R}." and "{T}: Add {U}." should count as 1 mana total, not 2).
  // Representation: getAvailableMana inflates each possible color by +1 and adds a marker key
  // like choiceColors_RU: 1. Total mana is corrected by subtracting (optionsCount - 1) per source.
  const choiceMarkers = Object.entries(pool).filter(([k, v]) => k.startsWith('choiceColors_') && (v || 0) > 0);

  // Sum only real mana keys (exclude markers like anyColor/choiceColors_*).
  const MANA_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
  let specificManaTotal = 0;
  for (const k of MANA_KEYS) {
    specificManaTotal += Number((pool as any)[k] || 0);
  }

  // Subtract inflation from anyColor.
  // Each anyColor source adds +1 to all 5 colored mana types (W,U,B,R,G) but only produces 1 mana.
  // Note: colorless is NOT included because "any color" sources don't add to colorless.
  const NUM_COLORED_MANA_TYPES = 5;
  let inflatedAmount = 0;
  if (anyColorCount > 0) {
    inflatedAmount += anyColorCount * (NUM_COLORED_MANA_TYPES - 1);
  }

  // Subtract inflation from choice sources.
  // If a source can produce N different options, we inflated N mana keys by +1 but it only produces 1.
  // So subtract (N-1) for each such source instance.
  for (const [k, v] of choiceMarkers) {
    const letters = k.slice('choiceColors_'.length);
    const optionsCount = Math.max(0, new Set(letters.split('')).size);
    if (optionsCount >= 2) {
      inflatedAmount += Number(v || 0) * (optionsCount - 1);
    }
  }

  return Math.max(0, specificManaTotal - inflatedAmount);
}

/**
 * Helper function to apply anyColor reduction after paying costs
 * @param remainingPool The mana pool with anyColor tracking
 * @param anyColorUsed Number of anyColor sources used
 */
function applyAnyColorReduction(remainingPool: Record<string, number>, anyColorUsed: number): void {
  if (remainingPool.anyColor && anyColorUsed > 0) {
    remainingPool.anyColor = Math.max(0, remainingPool.anyColor - anyColorUsed);
  }
}

/**
 * Check if a player can pay a mana cost with their current mana pool
 * 
 * @param pool The player's mana pool
 * @param parsedCost The parsed mana cost to check
 * @param lifeAvailable Optional: player's life total for Phyrexian mana costs (default: Infinity to always allow)
 * @returns true if the cost can be paid
 */
export function canPayManaCost(
  pool: Record<string, number>,
  parsedCost: { colors: Record<string, number>; generic: number; hasX: boolean; hybrid?: Array<string[]> },
  lifeAvailable: number = Infinity
): boolean {
  if (!pool) return false;

  const manaColorMap: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
  };

  const letterToManaKey: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
  };

  // Reconstruct exact individual mana sources to enforce mutual exclusion
  const specific: Record<string, number> = {
    white: pool.white || 0,
    blue: pool.blue || 0,
    black: pool.black || 0,
    red: pool.red || 0,
    green: pool.green || 0,
    colorless: pool.colorless || 0,
  };

  const anyColorCount = pool.anyColor || 0;
  
  // Find all choice markers
  const choiceSources: Array<{ key: string; colors: string[]; count: number }> = [];
  for (const [key, val] of Object.entries(pool)) {
    if (key.startsWith('choiceColors_') && val > 0) {
      const letters = key.slice('choiceColors_'.length).split('');
      choiceSources.push({
        key,
        colors: letters,
        count: val,
      });
    }
  }

  // De-inflate the specific counts
  // 1. Subtract anyColor contributions (each anyColor source contributed +1 to W, U, B, R, G)
  if (anyColorCount > 0) {
    specific.white = Math.max(0, specific.white - anyColorCount);
    specific.blue = Math.max(0, specific.blue - anyColorCount);
    specific.black = Math.max(0, specific.black - anyColorCount);
    specific.red = Math.max(0, specific.red - anyColorCount);
    specific.green = Math.max(0, specific.green - anyColorCount);
  }

  // 2. Subtract choice contributions (each choice source contributed +1 to each of its colors)
  for (const cs of choiceSources) {
    for (const letter of cs.colors) {
      const xKey = letterToManaKey[letter];
      if (xKey) {
        specific[xKey] = Math.max(0, specific[xKey] - cs.count);
      }
    }
  }

  // Count-grouped sources (NOT one entry per mana — large Cradle/Three Tree pools must stay O(groups)).
  type ManaSourceGroup = { allowed: Set<string>; remaining: number };
  const groups: ManaSourceGroup[] = [];

  for (const [colorKey, count] of Object.entries(specific)) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n > 0) {
      groups.push({ allowed: new Set([colorKey]), remaining: n });
    }
  }

  if (anyColorCount > 0) {
    groups.push({
      allowed: new Set(['white', 'blue', 'black', 'red', 'green']),
      remaining: Math.max(0, Math.floor(Number(anyColorCount) || 0)),
    });
  }

  for (const cs of choiceSources) {
    const allowedSet = new Set<string>();
    for (const letter of cs.colors) {
      const xKey = letterToManaKey[letter];
      if (xKey) allowedSet.add(xKey);
    }
    const n = Math.max(0, Math.floor(Number(cs.count) || 0));
    if (n > 0 && allowedSet.size > 0) {
      groups.push({ allowed: allowedSet, remaining: n });
    }
  }

  const reqColors: string[] = [];
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (colorKey) {
      for (let i = 0; i < needed; i++) {
        reqColors.push(colorKey);
      }
    }
  }

  const hybrids = parsedCost.hybrid || [];

  const leftoverMana = (): number =>
    groups.reduce((sum, group) => sum + Math.max(0, group.remaining), 0);

  function dfs(
    reqIdx: number,
    hybridIdx: number,
    life: number,
  ): boolean {
    if (reqIdx < reqColors.length) {
      const neededColor = reqColors[reqIdx];
      for (const group of groups) {
        if (group.remaining > 0 && group.allowed.has(neededColor)) {
          group.remaining -= 1;
          if (dfs(reqIdx + 1, hybridIdx, life)) {
            return true;
          }
          group.remaining += 1;
        }
      }
      return false;
    }

    if (hybridIdx < hybrids.length) {
      const options = hybrids[hybridIdx];
      for (const option of options) {
        if (option.startsWith('LIFE:')) {
          const lCost = parseInt(option.split(':')[1], 10) || 2;
          if (life >= lCost) {
            if (dfs(reqIdx, hybridIdx + 1, life - lCost)) {
              return true;
            }
          }
        } else if (option.startsWith('GENERIC:')) {
          const gCost = parseInt(option.split(':')[1], 10) || 2;
          if (leftoverMana() >= gCost) {
            const spent: ManaSourceGroup[] = [];
            let needed = gCost;
            for (const group of groups) {
              while (needed > 0 && group.remaining > 0) {
                group.remaining -= 1;
                spent.push(group);
                needed -= 1;
              }
              if (needed === 0) break;
            }
            if (dfs(reqIdx, hybridIdx + 1, life)) {
              return true;
            }
            for (const group of spent) {
              group.remaining += 1;
            }
          }
        } else {
          const colorKey = manaColorMap[option];
          if (colorKey) {
            for (const group of groups) {
              if (group.remaining > 0 && group.allowed.has(colorKey)) {
                group.remaining -= 1;
                if (dfs(reqIdx, hybridIdx + 1, life)) {
                  return true;
                }
                group.remaining += 1;
              }
            }
          }
        }
      }
      return false;
    }

    return leftoverMana() >= parsedCost.generic;
  }

  return dfs(0, 0, lifeAvailable);
}

/**
 * Check if a player can pay any amount of mana (for X spells or abilities)
 * Returns the maximum X value that can be paid
 * 
 * @param pool The player's mana pool
 * @param parsedCost The parsed cost (excluding X)
 * @returns Maximum X value that can be paid, or 0 if cost cannot be paid
 */
export function getMaxXValue(
  pool: Record<string, number>,
  parsedCost: { colors: Record<string, number>; generic: number }
): number {
  if (!pool) return 0;

  const manaColorMap: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
  };

  // Check if we can pay colored costs
  let remainingMana = getTotalManaFromPool(pool);
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (!colorKey) continue;
    
    const available = pool[colorKey] || 0;
    if (available < needed) {
      return 0; // Can't even pay the colored part
    }
    remainingMana -= needed;
  }

  // Remaining mana after colored costs is available for X + generic
  const availableForXAndGeneric = remainingMana;
  const maxX = Math.max(0, availableForXAndGeneric - parsedCost.generic);
  
  return maxX;
}

