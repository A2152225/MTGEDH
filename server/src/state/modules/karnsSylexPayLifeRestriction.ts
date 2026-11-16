// server/src/state/modules/karnsSylexPayLifeRestriction.ts
// Karn's Sylex family: "Players can't pay life to cast spells or to activate
// abilities that aren't mana abilities." This is narrower than Angel of
// Jubilation's global can't-pay-life modifier — shock-land payments still work.
// Public: parseCantPayLifeToCastOrActivateNonMana, playersCannotPayLifeToCastOrActivateNonMana.

const SYLEX_RE =
  /players\s+can(?:not|'t|’t)\s+pay\s+life\s+to\s+cast\s+spells(?:\s+or\s+to\s+activate\s+abilities(?:\s+that\s+aren't\s+mana\s+abilities)?)?/i;

export function parseCantPayLifeToCastOrActivateNonMana(oracleText: string): boolean {
  return SYLEX_RE.test(String(oracleText || '').replace(/\u2019/g, "'"));
}

export function playersCannotPayLifeToCastOrActivateNonMana(state: any, playerId?: string): boolean {
  void playerId;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true || permanent.faceDown === true) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    if (parseCantPayLifeToCastOrActivateNonMana(oracle)) return true;
  }
  return false;
}
