/**
 * Generic oracle parse for "Whenever you/a player tap(s) a <basic land type> for mana, add an additional {X}"
 * (Molten Tide, High Tide, Bubbling Muck, Crypt Ghast-style wordings) when no known-card entry exists.
 */

const LAND_TAP_BONUS = /whenever (you tap|a player taps) an? (plains|island|swamp|mountain|forest) for mana, (?:that player )?adds? an additional \{([WUBRGC])\}/i;

export function parseOracleLandTapBonus(oracleText: unknown): any | null {
  const m = String(oracleText || '').match(LAND_TAP_BONUS);
  if (!m) return null;
  const allPlayers = /^a player/i.test(m[1]);
  return {
    type: 'extra_mana',
    affects: allPlayers ? 'all_lands' : 'lands',
    ...(allPlayers ? { affectsAllPlayers: true } : {}),
    extraMana: { colors: [m[3].toUpperCase()], amount: 1 },
    landTypeRequired: m[2].toLowerCase(),
  };
}
