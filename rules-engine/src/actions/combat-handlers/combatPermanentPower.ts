// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: getPermanentPower.
// Public entry symbols: getPermanentPower.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

/**
 * Get a permanent's current power value
 */
export function getPermanentPower(permanent: any): number {
  // Use effective power if calculated
  if (typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }
  
  // Use base power plus counters
  let power = permanent.basePower ?? 0;
  
  // Parse from card if needed
  if (typeof power !== 'number') {
    const cardPower = permanent.card?.power || permanent.power;
    power = typeof cardPower === 'string' ? parseInt(cardPower, 10) || 0 : cardPower || 0;
  }
  
  // Add +1/+1 counters
  if (permanent.counters && typeof permanent.counters['+1/+1'] === 'number') {
    power += permanent.counters['+1/+1'];
  }
  
  // Subtract -1/-1 counters
  if (permanent.counters && typeof permanent.counters['-1/-1'] === 'number') {
    power -= permanent.counters['-1/-1'];
  }
  
  // Apply power modifiers
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        if (typeof mod.power === 'number') {
          power += mod.power;
        }
      }
    }
  }
  
  return power;
}
