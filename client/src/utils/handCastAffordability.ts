// client/src/utils/handCastAffordability.ts
// The server sends playableCards (ids it can pay for and time right now) only to the
// player with priority. Hand cast UI (context menu, touch Cast button, Cast badge)
// uses this so it agrees with the hand highlight instead of only checking priority.

export const CANNOT_PAY_COST_REASON = "Can't pay its cost right now";

/** Reason a hand card can't be cast per the server's playableCards, or null when castable/unknown. */
export function handCastAffordabilityReason(playableCards: unknown, cardId: unknown): string | null {
  // No list (older server / not sent): don't block; the server still validates the cast.
  if (!Array.isArray(playableCards)) return null;
  const id = String(cardId ?? '').trim();
  if (!id) return null;
  return playableCards.some((entry) => String(entry) === id) ? null : CANNOT_PAY_COST_REASON;
}