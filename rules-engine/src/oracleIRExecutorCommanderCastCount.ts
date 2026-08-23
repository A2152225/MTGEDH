import type { GameState, PlayerID } from '../../shared/src';

/**
 * Authoritative count of times this player has cast a commander from the command zone this game.
 * Prefer command-zone tax (tax += 2 per CZ cast => casts = sum(taxById)/2), matching Jeska-style ETB loyalty.
 * Falls back to explicit commanderCastsFromCommandZoneThisGame when tax is unavailable.
 */
export function resolveCommanderCastsFromCommandZoneThisGame(
  state: GameState | null | undefined,
  controllerId: PlayerID | string | null | undefined,
): number {
  const playerId = String(controllerId || '').trim();
  if (!playerId) return 0;

  const stateAny = state as any;
  const commandZoneEntry =
    stateAny?.commandZone?.[playerId]
    ?? stateAny?.commandZones?.[playerId]
    ?? null;

  let fromTax = 0;
  const taxById = commandZoneEntry?.taxById;
  if (taxById && typeof taxById === 'object') {
    for (const tax of Object.values(taxById)) {
      const taxNumber = typeof tax === 'number' ? tax : Number(tax);
      if (Number.isFinite(taxNumber) && taxNumber > 0) {
        fromTax += Math.floor(taxNumber / 2);
      }
    }
  } else {
    const totalTax = Number(commandZoneEntry?.tax);
    if (Number.isFinite(totalTax) && totalTax > 0) {
      fromTax = Math.floor(totalTax / 2);
    }
  }

  if (fromTax > 0) return fromTax;

  const explicit = Number(stateAny?.commanderCastsFromCommandZoneThisGame?.[playerId]);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(0, Math.floor(explicit));
  }

  // Explicit 0 / missing + no tax => 0 casts
  if (Number.isFinite(explicit) && explicit === 0) return 0;
  return 0;
}
