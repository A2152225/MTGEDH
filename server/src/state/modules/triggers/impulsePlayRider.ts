/**
 * Impulse follow-up rider: the sentence after an exile effect that grants play of the exiled card(s)
 * ("You may play that card this turn." / "Until end of turn, you may play those cards.").
 * It belongs to the trigger's effect, so detectors that stop at the first period must keep it
 * (Fire Giant's Fury watchers, U.S.S. Enterprise-D counter trigger).
 */
export const IMPULSE_PLAY_RIDER = /^\.?\s+((?:until [^,.\n]+, )?you may (?:play|cast) (?:those|that|the exiled|them|it)(?: cards?)?[^.\n]*\.)/i;

/** Append the impulse rider that follows `matchEnd` in `oracle` to `effect`, if one is there and not already included. */
export function appendImpulsePlayRider(effect: string, oracle: string, matchEnd: number): string {
  const base = String(effect || '').trim();
  if (!base || !/\bexile\b/i.test(base) || /\byou may (?:play|cast)\b/i.test(base)) return base;
  const rider = String(oracle || '').slice(Math.max(0, matchEnd)).match(IMPULSE_PLAY_RIDER);
  return rider ? `${base.replace(/\.$/, '')}. ${rider[1].trim()}` : base;
}
