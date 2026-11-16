// server/src/state/modules/batch93TriggerSuppression.ts
// B93: "Permanents entering don't cause abilities of permanents your opponents
// control to trigger." Public: parseEleshNornOpponentEtbSuppression,
// shouldSuppressOpponentEtbTriggers.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const ELESH_RE =
  /permanents entering(?: the battlefield)? don't cause abilities of permanents your opponents control to trigger/i;

export function parseEleshNornOpponentEtbSuppression(oracle: string): boolean {
  return ELESH_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

/**
 * True when `observer` (the permanent whose trigger would fire) is an opponent
 * of a source with the Elesh Norn-style ETB suppression, and the event is an ETB.
 */
export function shouldSuppressOpponentEtbTriggers(state: any, event: string, observer: any): boolean {
  if (event !== 'etb' || !observer) return false;
  const observerController = String(observer.controller || '').trim();
  if (!observerController) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const source of battlefield) {
    if (!source || source.phasedOut === true || !source.card) continue;
    if (!parseEleshNornOpponentEtbSuppression(readCardOracleText(source.card))) continue;
    const srcController = String(source.controller || '').trim();
    if (srcController && srcController !== observerController) return true;
  }
  return false;
}

export function parseEnteringCausesAdditionalTrigger(oracle: string): boolean {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  return /if a permanent entering(?: the battlefield)? causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time/i.test(text);
}

export function parseLifeGainCausesAdditionalTrigger(oracle: string): boolean {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  return /if you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time/i.test(text);
}
