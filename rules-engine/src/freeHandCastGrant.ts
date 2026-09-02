/**
 * Origin: rules-engine/src/alternateCosts.ts Omniscience detection
 * Cluster: continuous "cast from your hand without paying" vs this-turn / coin-flip riders
 * Public: grantsStaticFreeHandCasts, findFreeHandCastsThisTurnSource
 *
 * Omniscience / Jodah-style statics stay on the battlefield. Yusri's
 * "If you won five flips this way, you may cast spells from your hand this
 * turn without paying…" is a triggered this-turn rider, not a static.
 */

export type FreeHandCastSource = {
  readonly sourceId: string;
  readonly sourceName: string;
};

export function grantsStaticFreeHandCasts(text: string): boolean {
  const oracleText = String(text || '').toLowerCase();
  if (!oracleText.includes('without paying')) return false;
  if (!oracleText.includes('from your hand')) return false;
  if (!oracleText.includes('you may cast')) return false;
  const hasCast = oracleText.includes('cast spells from your hand')
    || oracleText.includes('cast nonland cards from your hand')
    || oracleText.includes('cast cards from your hand');
  if (!hasCast) return false;
  // Triggered / this-turn riders (Yusri) are not continuous Omniscience.
  if (/you may cast (?:spells|nonland cards|cards) from your hand this turn without paying/i.test(oracleText)) {
    return false;
  }
  if (/if you won (?:five|\d+|that many) flips? this way/i.test(oracleText)) {
    return false;
  }
  return true;
}

export function findFreeHandCastsThisTurnSource(
  state: { lastingEffects?: readonly unknown[] } | null | undefined,
  playerId: string,
): FreeHandCastSource | null {
  const effects = Array.isArray(state?.lastingEffects) ? state.lastingEffects : [];
  const pid = String(playerId || '').trim();
  for (const entry of effects) {
    const effect = entry as {
      type?: unknown;
      controllerId?: unknown;
      playerId?: string;
      sourceId?: unknown;
      sourceName?: unknown;
      source?: unknown;
    };
    if (String(effect?.type || '') !== 'freeHandCastsThisTurn') continue;
    const controller = String(effect.controllerId || effect.playerId || '').trim();
    if (controller && pid && controller !== pid) continue;
    return {
      sourceId: String(effect.sourceId || '').trim(),
      sourceName: String(effect.sourceName || effect.source || 'this turn').trim() || 'this turn',
    };
  }
  return null;
}
