/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDealtDamageTriggers
 * Public: detectDealtDamageTriggers
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { mergeDetectorOracleWithContinuousGrants } from "./detectorGrantedOracle.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { escapeCardNameForRegex } from "./types.js";
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
/**
 * Detect "dealt damage" triggers (Arcbond, etc.)
 */
export function detectDealtDamageTriggers(card: any, permanent: any, gameState?: any): TriggeredAbility[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'damage' })) return []; // Humility / Torpor Orb gate
  const triggers: TriggeredAbility[] = [];
  const { oracleText } = mergeDetectorOracleWithContinuousGrants(String(card?.oracle_text || ''), permanent, gameState);
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';
  const cardNameEscaped = escapeCardNameForRegex(cardName);

  const dealtDamageNameVariants = buildCardNameRegexAlternatives(cardName);
  const dealtDamageSubject = `(?:~|this creature|this permanent|equipped creature|(?:${dealtDamageNameVariants.join('|')}))`;

  const dealtDamagePatterns = [
    /whenever that creature is dealt damage(?: this turn)?,?\s*([^.]+)/gi,
    /whenever (?:~|this creature|this permanent|equipped creature) is dealt (?:combat )?damage,?\s*([^.]+)/gi,
    /whenever a source deals damage to (?:~|this creature),?\s*([^.]+)/gi,
    /when(?:ever)? enchanted creature is dealt damage,?\s*([^.]+)/gi,
    new RegExp(`whenever ${dealtDamageSubject} is dealt (?:combat )?damage,?\\s*([^.]+)`, 'gi'),
    new RegExp(`when(?:ever)? ${dealtDamageSubject} or a creature it'?s paired with is dealt damage,?\\s*([^.]+)`, 'gi'),
    /whenever (?:a |an )?creature is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature you control is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature you control with (?:flash or haste|haste or flash) is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature you control with deathtouch deals damage to (?:a player|an opponent) or (?:a )?planeswalker,?\s*([^.]+)/gi,
    /whenever a ([\w]+) you control is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature an opponent controls is dealt damage,?\s*([^.]+)/gi,
    /whenever an opponent is dealt (?:noncombat )?damage,?\s*([^.]+)/gi,
    /whenever an opponent is dealt combat damage by one or more creatures you control,?\s*([^.]+)/gi,
    /whenever a source you control deals noncombat damage to (?:a creature equal to that creature's toughness|an opponent),?\s*([^.]+)/gi,
    /whenever a source you control deals noncombat damage to an opponent,?\s*([^.]+)/gi,
    /whenever damage is dealt to you,?\s*([^.]+)/gi,
    /whenever a creature deals damage to you,?\s*([^.]+)/gi,
    /whenever a ([\w]+) deals damage to you,?\s*([^.]+)/gi,
    /when (?:a |an )?source an opponent controls deals damage to you,?\s*([^.]+)/gi,
    /whenever (?:a |an )?source an opponent controls deals damage to you,?\s*([^.]+)/gi,
    /whenever enchanted player is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature or planeswalker an opponent controls with a bounty counter on it is dealt damage,?\s*([^.]+)/gi,
    /when enchanted creature becomes tapped or is dealt damage,?\s*([^.]+)/gi,
    /whenever a source of the chosen color deals damage to you,?\s*([^.]+)/gi,
    /whenever a source an opponent controls deals damage to this creature,?\s*([^.]+)/gi,
  ];

  const damagePreventedMatch = oracleText.match(/when damage is prevented this way,?\s*([^.]+)/i);
  if (damagePreventedMatch && !triggers.some((t) => t.triggerType === 'damage_prevented')) {
    const effectText = timingTriggerEffect(oracleText, damagePreventedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'damage_prevented',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  for (const pattern of dealtDamagePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'dealt_damage',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  return triggers;
}

