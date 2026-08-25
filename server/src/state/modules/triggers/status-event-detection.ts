/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover spell-countered / mutate / equipped / returned-to-hand detectors
 * Public: detectSpellCounteredTriggers, detectMutateTriggers, detectEquippedTriggers,
 *   detectReturnedToHandTriggers
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
/**
 * Detect spell-countered triggers.
 * - controlled_spell_countered: Multani's Presence ("whenever a spell you've cast is countered")
 * - you_countered_spell: Baral / Lullmage ("whenever a spell or ability you control counters a spell")
 */
export function detectSpellCounteredTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const pushTrigger = (
    match: RegExpExecArray,
    counterPerspective: 'controlled_spell_countered' | 'you_countered_spell',
  ) => {
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText) return;
    if (triggers.some((trigger) =>
      trigger.effect === effectText
      && String((trigger as any).counterPerspective || '') === counterPerspective
    )) {
      return;
    }
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'spell_countered',
      counterPerspective,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  };

  const controlledSpellCounteredPatterns = [
    /whenever a spell you(?:'ve| have) cast is countered,?\s*([^.]+)/gi,
    /whenever a spell you control is countered,?\s*([^.]+)/gi,
  ];
  for (const pattern of controlledSpellCounteredPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      pushTrigger(match, 'controlled_spell_countered');
    }
  }

  const youCounteredSpellPatterns = [
    /whenever a spell or ability you control counters a spell,?\s*([^.]+)/gi,
    /whenever you counter a spell,?\s*([^.]+)/gi,
    /whenever a spell an opponent controls is countered by a spell or ability you control,?\s*([^.]+)/gi,
  ];
  for (const pattern of youCounteredSpellPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      pushTrigger(match, 'you_countered_spell');
    }
  }

  return triggers;
}

/**
 * Detect mutate triggers from oracle text.
 */
export function detectMutateTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const mutatePatterns = [
    /whenever this creature mutates,?\s*([^.]+)/gi,
    /whenever (?:~|[\w ,']+?) mutates,?\s*([^.]+)/gi,
  ];
  for (const pattern of mutatePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'mutates',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  return triggers;
}

/**
 * Detect discard triggers from oracle text.
 */
export function detectEquippedTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const equippedPatterns = [
    /when this equipment becomes attached to a creature,?\s*([^.]+)/i,
    /whenever this equipment becomes attached to a creature,?\s*([^.]+)/i,
  ];
  for (const pattern of equippedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((t) => t.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_attached',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}
