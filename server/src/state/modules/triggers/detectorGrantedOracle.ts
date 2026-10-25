/**
 * Origin: server/src/state/modules/triggers/attack-detection.ts
 * Cluster: merge printed oracle with continuous granted trigger/activated lines
 * Public: isAbilityLikeGrantedText, mergeDetectorOracleWithContinuousGrants,
 *   annotateFirstTimeEachTurnOracle, resolveDetectorOracleForPermanent,
 *   applyFirstTimeEachTurnFlags
 */

import { getContinuousGrantedAbilitiesForPermanent } from '../staticEffectSpec.js';
import { persistedGrantedAbilitiesSurvivingLoss } from '../persistedGrantedAbilityLoss.js';

const FIRST_TIME_EACH_TURN_RE =
  /\s+for the first time(?: each turn| during each of your turns)/gi;
const DURING_YOUR_TURN_BEFORE_COMMA_RE = /\s+during your turn(?=,)/gi;

export function isAbilityLikeGrantedText(text: string): boolean {
  // Case-insensitive: persisted grants keep printed capitalisation ("Whenever ...", "At the ...").
  return /\bwhen(?:ever)?\b|\bat the |:/i.test(String(text || ''));
}

/**
 * Append ability-like continuous (and persisted) grants onto printed oracle so
 * detectors can see quoted "have …" lines on the recipient, not only the lord.
 */
export function mergeDetectorOracleWithContinuousGrants(
  printedOracle: string,
  permanent: any,
  gameState?: any,
): {
  oracleText: string;
  grantedAbilities: string[];
  continuousGranted: string[];
} {
  const printed = String(printedOracle || '');
  const continuousGranted = gameState
    ? getContinuousGrantedAbilitiesForPermanent(permanent, gameState)
    : [];
  const persistedRaw = gameState
    ? persistedGrantedAbilitiesSurvivingLoss(permanent, gameState.battlefield)
    : (Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []);
  const persisted = persistedRaw.map((entry: unknown) => String(entry || ''));
  const grantedAbilities = [...persisted, ...continuousGranted];
  const printedLower = printed.toLowerCase();
  const extra = grantedAbilities.filter((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || !isAbilityLikeGrantedText(trimmed)) return false;
    return !printedLower.includes(trimmed.toLowerCase());
  });
  const oracleText = extra.length > 0
    ? `${printed}\n${extra.join('\n')}`
    : printed;
  return { oracleText, grantedAbilities, continuousGranted };
}

/** Strip first-time / during-your-turn clauses so existing when-clauses still match. */
export function annotateFirstTimeEachTurnOracle(oracle: string): {
  oracleText: string;
  oncePerTurn: boolean;
  onlyOnControllerTurn: boolean;
} {
  const raw = String(oracle || '');
  const onlyOnControllerTurn = /during each of your turns/i.test(raw)
    || /\bduring your turn\b/i.test(raw);
  const oncePerTurn = /for the first time(?: each turn| during each of your turns)/i.test(raw)
    || /this ability triggers only once each turn/i.test(raw);
  return {
    oracleText: raw.replace(FIRST_TIME_EACH_TURN_RE, '').replace(DURING_YOUR_TURN_BEFORE_COMMA_RE, ''),
    oncePerTurn,
    onlyOnControllerTurn,
  };
}

export function resolveDetectorOracleForPermanent(
  permanent: any,
  printedOracle: string,
  gameState?: any,
): {
  oracleText: string;
  oncePerTurn: boolean;
  onlyOnControllerTurn: boolean;
} {
  const merged = mergeDetectorOracleWithContinuousGrants(printedOracle, permanent, gameState);
  return annotateFirstTimeEachTurnOracle(merged.oracleText);
}

export function applyFirstTimeEachTurnFlags<T extends { oncePerTurn?: boolean; onlyOnControllerTurn?: boolean }>(
  triggers: T[],
  flags: { oncePerTurn: boolean; onlyOnControllerTurn: boolean },
): T[] {
  if (!flags.oncePerTurn && !flags.onlyOnControllerTurn) return triggers;
  for (const trigger of triggers) {
    if (flags.oncePerTurn) trigger.oncePerTurn = true;
    if (flags.onlyOnControllerTurn) trigger.onlyOnControllerTurn = true;
  }
  return triggers;
}
