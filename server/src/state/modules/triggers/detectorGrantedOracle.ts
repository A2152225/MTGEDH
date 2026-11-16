/**
 * Origin: server/src/state/modules/triggers/attack-detection.ts
 * Cluster: merge printed oracle with continuous granted trigger/activated lines
 * Public: isAbilityLikeGrantedText, mergeDetectorOracleWithContinuousGrants,
 *   annotateFirstTimeEachTurnOracle, resolveDetectorOracleForPermanent,
 *   applyFirstTimeEachTurnFlags
 */

import { getContinuousGrantedAbilitiesForPermanent } from '../staticEffectSpec.js';
import { persistedGrantedAbilitiesSurvivingLoss } from '../persistedGrantedAbilityLoss.js';
import { grantedTriggerTextsForPermanent } from './grantedOracleTriggerScan.js';
import {
  filterOracleTextToActiveStationAbilities,
  hasStationThresholdMarkers,
  readChargeCounterCount,
} from '../../../utils/stationParser.js';

const FIRST_TIME_EACH_TURN_RE =
  /\s+for the first time(?: each turn| during each of your turns)/gi;
const DURING_YOUR_TURN_BEFORE_COMMA_RE = /\s+during your turn(?=,)/gi;

/**
 * Reminder text of a granted keyword ("Spells you cast have ripple 4. (Whenever you cast a spell, ...)") is
 * not an ability of the source: detectors would otherwise read it as a second, printed trigger.
 */
const GRANTED_KEYWORD_TRIGGER_REMINDER_RE = /(\b(?:have|has)\s[^.\n(]*\.)\s*\((?=when(?:ever)?\b)[^)\n]*\)/gi;

/**
 * A quoted trigger granted to other permanents ("... have flying and "At the beginning of your upkeep, ...")
 * is the recipient's ability, never the source's: drop it from the source's own detector text.
 */
function stripGrantedQuotedTriggers(text: string): string {
  return text.split('\n').map((line) => {
    const verb = /\b(?:have|has|gains?)\b/i.exec(line);
    if (!verb || verb.index === 0) return line;
    const head = line.slice(0, verb.index + verb[0].length);
    const tail = line.slice(verb.index + verb[0].length).replace(/\s*"(?:when(?:ever)?|at the)\b[^"]*"/gi, '');
    return head + tail;
  }).join('\n');
}

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
  if (gameState) {
    for (const line of grantedTriggerTextsForPermanent(permanent, gameState)) {
      const trimmed = String(line || '').trim();
      if (!trimmed || printedLower.includes(trimmed.toLowerCase())) continue;
      if (extra.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
      extra.push(trimmed);
    }
  }
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
  // Station "N+ | …" lines (and following lines until the next marker) are not
  // printed abilities until charge counters reach N — strip them for detectors.
  let printed = stripGrantedQuotedTriggers(
    String(printedOracle || '').replace(GRANTED_KEYWORD_TRIGGER_REMINDER_RE, (_m, sentence: string) => sentence),
  );
  if (hasStationThresholdMarkers(printed)) {
    printed = filterOracleTextToActiveStationAbilities(printed, readChargeCounterCount(permanent));
  }
  const merged = mergeDetectorOracleWithContinuousGrants(printed, permanent, gameState);
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
