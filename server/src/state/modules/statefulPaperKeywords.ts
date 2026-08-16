import type { BattlefieldPermanent, GameState, PlayerID } from '../../../../shared/src/types.js';

/**
 * State-based and static-condition support for paper keywords whose effects are
 * represented by a designation rather than a card-specific marker.
 *
 * Oracle wording used here:
 * - "Start your engines!" (CR 702.179a)
 * - "Storied" (CR 702.195a)
 * - "Max speed — [ability]" (CR 702.178a)
 * - "∞ — [ability]" (CR 702.186b)
 */
function oracleText(permanent: BattlefieldPermanent): string {
  return String((permanent as any).oracle_text || (permanent.card as any)?.oracle_text || '');
}

export function hasStartYourEngines(permanent: BattlefieldPermanent): boolean {
  return /(^|\n)\s*start your engines!\s*(?:\([^)]*\))?\s*(?:\n|$)/i.test(oracleText(permanent));
}

export function hasStoried(permanent: BattlefieldPermanent): boolean {
  return /(^|\n)\s*storied\s*(?:\([^)]*\))?\s*(?:\n|$)/i.test(oracleText(permanent));
}

function isHistoricForStoried(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return /\bartifact\b/.test(typeLine) || /\blegendary\b/.test(typeLine) || /\bsaga\b/.test(typeLine);
}

/**
 * Applies only state-based designation changes. Call this from the normal SBA
 * loop so a player cannot receive priority between satisfying a condition and
 * receiving the designation.
 */
export function applyStatefulPaperKeywordSBAs(state: GameState): boolean {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  let changed = false;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '') as PlayerID;
    if (!playerId) continue;
    const controlled = battlefield.filter((permanent) => String(permanent.controller) === playerId);

    if (controlled.some(hasStartYourEngines) && state.speed?.[playerId] === undefined) {
      state.speed = { ...(state.speed || {}), [playerId]: 1 };
      changed = true;
    }

    // A permanent counts once even if it is an artifact, legendary, and a Saga.
    if (!state.enduringStory?.[playerId]
      && controlled.some(hasStoried)
      && controlled.filter(isHistoricForStoried).length >= 3) {
      state.enduringStory = { ...(state.enduringStory || {}), [playerId]: true };
      changed = true;
    }
  }

  return changed;
}

export function maxSpeedGrantedAbility(permanent: BattlefieldPermanent, state: GameState): string | null {
  const speed = Number(state.speed?.[permanent.controller] || 0);
  if (speed < 4) return null;
  const match = oracleText(permanent).match(/(?:^|\n)\s*max speed\s*[—-]\s*(.+?)(?:\n|$)/i);
  return match?.[1]?.trim() || null;
}

export function infinityGrantedAbility(permanent: BattlefieldPermanent): string | null {
  if (!permanent.harnessed) return null;
  const match = oracleText(permanent).match(/(?:^|\n)\s*∞\s*[—-]\s*(.+?)(?:\n|$)/);
  return match?.[1]?.trim() || null;
}

/** Generic execution target for an Oracle-IR "harness" action. */
export function harnessPermanent(state: GameState, permanentId: string): boolean {
  const permanent = (state.battlefield || []).find((entry) => String(entry.id) === String(permanentId));
  if (!permanent || permanent.harnessed) return false;
  permanent.harnessed = true;
  return true;
}

/**
 * CR 702.179d inherent trigger (applied when an opponent loses life during your turn).
 * Returns the new speed when increased, otherwise null.
 */
export function maybeIncreaseSpeedFromOpponentLifeLoss(
  state: GameState,
  losingPlayerId: string,
): number | null {
  const turnPlayer = String((state as any).turnPlayer || (state as any).activePlayer || '').trim() as PlayerID;
  const loser = String(losingPlayerId || '').trim();
  if (!turnPlayer || !loser || turnPlayer === loser) return null;

  const currentSpeed = state.speed?.[turnPlayer];
  if (currentSpeed === undefined || currentSpeed === null) return null;
  const speed = Number(currentSpeed);
  if (!Number.isFinite(speed) || speed < 1 || speed >= 4) return null;
  if (state.speedIncreasedThisTurn?.[turnPlayer]) return null;

  const next = speed + 1;
  state.speed = { ...(state.speed || {}), [turnPlayer]: next };
  state.speedIncreasedThisTurn = { ...(state.speedIncreasedThisTurn || {}), [turnPlayer]: true };
  return next;
}

export function resetSpeedIncreasedThisTurn(state: GameState): void {
  if (state && typeof state === 'object') {
    state.speedIncreasedThisTurn = {};
  }
}
