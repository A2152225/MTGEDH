export type CounterCombatRestriction = {
  isPrevented: boolean;
  counterType?: string;
  sourceName?: string;
};

type BattlefieldPermanentLike = {
  counters?: Record<string, number>;
  card?: { name?: string; oracle_text?: string };
};

/**
 * Returns true when a permanent on the battlefield has a static effect of the form
 * "Creatures with [counterType] counters on them can't attack/block".
 * The source must remain on the battlefield for the restriction to apply.
 */
export function getCounterPreventingCombatAction(
  permanent: BattlefieldPermanentLike | null | undefined,
  battlefield: ReadonlyArray<BattlefieldPermanentLike>,
  action: 'attack' | 'block',
): CounterCombatRestriction {
  if (!permanent?.counters) {
    return { isPrevented: false };
  }

  const counterTypes = Object.keys(permanent.counters).filter(
    (key) => typeof permanent.counters?.[key] === 'number' && Number(permanent.counters[key]) > 0,
  );

  if (counterTypes.length === 0) {
    return { isPrevented: false };
  }

  for (const source of battlefield) {
    const oracle = String(source?.card?.oracle_text || '').toLowerCase();
    if (!oracle) continue;

    const cardName = source?.card?.name || 'Unknown';
    const preventsAction = action === 'attack'
      ? oracle.includes("can't attack") || oracle.includes('cannot attack')
      : (oracle.includes("can't") || oracle.includes('cannot')) && oracle.includes('block');

    if (!preventsAction) continue;

    for (const counterType of counterTypes) {
      const counterPattern = new RegExp(`creatures? with ${counterType} counters? on them`, 'i');
      if (counterPattern.test(oracle)) {
        return {
          isPrevented: true,
          counterType,
          sourceName: cardName,
        };
      }
    }
  }

  return { isPrevented: false };
}

export function isCounterPreventingAttack(
  permanent: BattlefieldPermanentLike | null | undefined,
  battlefield: ReadonlyArray<BattlefieldPermanentLike>,
): CounterCombatRestriction {
  return getCounterPreventingCombatAction(permanent, battlefield, 'attack');
}

export function isCounterPreventingBlock(
  permanent: BattlefieldPermanentLike | null | undefined,
  battlefield: ReadonlyArray<BattlefieldPermanentLike>,
): CounterCombatRestriction {
  return getCounterPreventingCombatAction(permanent, battlefield, 'block');
}
