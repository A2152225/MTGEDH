/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectReturnedToHandTriggers
 * Public: detectReturnedToHandTriggers
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
export function detectReturnedToHandTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const returnedPatterns = [
    /whenever one or more noncreature permanents are returned to hand,?\s*([^.]+)/i,
    /whenever a permanent is returned to your hand,?\s*([^.]+)/i,
    /whenever a permanent is returned to a player's hand,?\s*([^.]+)/i,
    /whenever (?:a |an )?permanent you control is returned to your hand,?\s*([^.]+)/i,
    /whenever (?:another )?(?:nonland )?permanent you control is returned to (?:your|its owner's) hand,?\s*([^.]+)/i,
    /whenever (?:a |an )?creature is returned to your hand,?\s*([^.]+)/i,
    /whenever (?:~|this creature) or another creature is returned to your hand from the battlefield,?\s*([^.]+)/i,
    /whenever this creature or another creature is returned to your hand from the battlefield,?\s*([^.]+)/i,
  ];
  for (const pattern of returnedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((t) => t.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'returned_to_hand',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

