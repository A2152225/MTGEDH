/**
 * Origin parent: server/src/state/modules/triggers/attack-detection.ts
 * Cluster: delayed "When you do" / "When they do" / exert-as-it-attacks riders
 * that gap-closure scans through detectAttackTriggers.
 * Public: appendAttackDetectionReflexive, isReflexiveDelayedDoTriggerType
 *
 * These are not attack events. Combat must not auto-queue them on declare
 * attackers (exert rewards already go through the exert OPTION_CHOICE path).
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import type { AttackDetectionState } from "./attack-detection-state.js";

const REFLEXIVE_DELAYED_DO_TRIGGER_TYPES = new Set([
  'exert',
  'when_you_do',
  'when_they_do',
]);

export function isReflexiveDelayedDoTriggerType(triggerType: string | undefined): boolean {
  return REFLEXIVE_DELAYED_DO_TRIGGER_TYPES.has(String(triggerType || ''));
}

export function appendAttackDetectionReflexive(state: AttackDetectionState): void {
  const {
    triggers,
    oracleText,
    cardName,
    permanentId,
    controllerId,
  } = state;

  const exertWhenYouDoMatch = oracleText.match(
    /you may exert this (?:creature|permanent) as it attacks\.?\s*when you do,\s*([^.]+)/i,
  );
  if (
    exertWhenYouDoMatch
    && !triggers.some((t) => t.triggerType === 'exert' || t.triggerType === 'when_you_do')
  ) {
    const effectText = timingTriggerEffect(oracleText, exertWhenYouDoMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'exert',
      description: effectText,
      effect: effectText,
      mandatory: false,
    });
  }

  const whenYouDoMatch = oracleText.match(/when you do,\s*([^.]+)/i);
  if (whenYouDoMatch && !triggers.some((t) => t.triggerType === 'when_you_do')) {
    const effectText = timingTriggerEffect(oracleText, whenYouDoMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_you_do',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenTheyDoMatch = oracleText.match(/when they do,\s*([^.]+)/i);
  if (whenTheyDoMatch && !triggers.some((t) => t.triggerType === 'when_they_do')) {
    const effectText = timingTriggerEffect(oracleText, whenTheyDoMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_they_do',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
}
