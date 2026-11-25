/**
 * CR 608.2h: a dies trigger that reads the creature's power ("deals damage equal to its power")
 * uses its last-known power, including anthems, lords and pumps that applied right before it
 * left the battlefield. The dying permanent is already off the battlefield when its trigger is
 * pushed, so the current P/T calculation runs against a state copy that still holds it, and the
 * result is stamped as effectivePower / effectiveToughness (what getPermanentLastKnownStat reads).
 */
import { getCurrentPowerToughness } from './currentPowerToughness.js';
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';

export function withDeathLastKnownPowerToughness(state: any, dyingPermanent: any): any {
  if (!dyingPermanent || typeof dyingPermanent !== 'object' || !state) return dyingPermanent;
  const typeLine = String(dyingPermanent?.card?.type_line || dyingPermanent?.type_line || '');
  if (!/\bcreature\b/i.test(typeLine)) return dyingPermanent;
  const id = String(dyingPermanent.id || '').trim();
  try {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const lkiState = {
      ...state,
      battlefield: [...battlefield.filter((entry: any) => String(entry?.id || '').trim() !== id), dyingPermanent],
    };
    const current = getCurrentPowerToughness(dyingPermanent, lkiState);
    const power = Number(current?.power);
    const toughness = Number(current?.toughness);
    if (!Number.isFinite(power) || !Number.isFinite(toughness)) return dyingPermanent;
    return { ...dyingPermanent, effectivePower: power, effectiveToughness: toughness };
  } catch (err) {
    reportHookFailure('lki.deathTrigger.currentPT', err, {
      cardName: String(dyingPermanent?.card?.name || ''),
      source: 'deathLastKnownPowerToughness',
    });
    return dyingPermanent;
  }
}
