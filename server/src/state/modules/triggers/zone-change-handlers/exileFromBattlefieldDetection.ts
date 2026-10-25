/**
 * Extracted from triggers/zone-change.ts: exile-from-battlefield trigger detection.
 * Cluster moved: ExiledFromBattlefieldTrigger, detectExiledFromBattlefieldTriggers.
 * Public: ExiledFromBattlefieldTrigger, detectExiledFromBattlefieldTriggers
 *
 * Leaf must not import zone-change.ts or zone-change-handlers/index.ts.
 * Distinct from triggers/zone-changes.ts (death/ETB/attack barrel).
 */

import { timingTriggerEffect } from '../timing-effect-extraction.js';
import { permanentHasTriggeredAbilities } from '../triggeredAbilitySuppression.js';

export interface ExiledFromBattlefieldTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType:
    | 'creature_exiled_from_battlefield'
    | 'permanent_exiled_from_battlefield'
    | 'unearthed_creature_exiled';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  targetFilter: 'creature' | 'permanent';
}

export function detectExiledFromBattlefieldTriggers(card: any, permanent: any, gameState?: any): ExiledFromBattlefieldTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'ltb' })) return []; // Humility / Torpor Orb gate
  const triggers: ExiledFromBattlefieldTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const selfExilePatterns = [
    /when (?:~|this creature|this permanent|this artifact|this enchantment) is exiled from the battlefield[^,]*,?\s*([^.]+)/gi,
    /whenever (?:~|this creature|this permanent|this artifact|this enchantment) is exiled from the battlefield[^,]*,?\s*([^.]+)/gi,
  ];
  for (const pattern of selfExilePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effect = String(match[1] || '').trim().replace(/\s+/g, ' ');
      if (!effect || triggers.some((t) => t.effect === effect && t.triggerType === 'creature_exiled_from_battlefield')) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'unearthed_creature_exiled',
        oracleClause: String(match[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const playExiledWithPatterns = [
    /whenever a player plays a card exiled with ([^,]+),?\s*([^.]+)/gi,
    /whenever (?:a |an )?opponent plays a card exiled with ([^,]+),?\s*([^.]+)/gi,
    /when you play a card exiled with (?:~|this creature),?\s*([^.]+)/gi,
    /whenever you play a card with the same name as one of the exiled cards,?\s*([^.]+)/gi,
  ];
  for (const pattern of playExiledWithPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effect = String(match[match.length - 1] || '').trim().replace(/\s+/g, ' ');
      if (!effect || triggers.some((t) => t.effect === effect)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(match[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const warpedExileMatch = oracleText.match(/whenever a card is exiled because it was warped,?\s*([^.]+)/i);
  if (warpedExileMatch) {
    const effect = String(warpedExileMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(warpedExileMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const unearthedCreatureExiledMatch = oracleText.match(
    /whenever a creature you control is exiled,?\s*if it was unearthed,?\s*([^.]+)/i,
  );
  if (unearthedCreatureExiledMatch) {
    const effect = String(unearthedCreatureExiledMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.triggerType === 'unearthed_creature_exiled')) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(unearthedCreatureExiledMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const creatureCardExiledThisWayMatch = oracleText.match(/when a creature card is exiled this way,?\s*([^.]+)/i);
  if (creatureCardExiledThisWayMatch) {
    const effect = String(creatureCardExiledThisWayMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(creatureCardExiledThisWayMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const exiledThisWayMatch = oracleText.match(/when one or more ([^ ]+) cards are exiled this way,?\s*([^.]+)/i);
  if (exiledThisWayMatch) {
    const effect = String(exiledThisWayMatch[2] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(exiledThisWayMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const controlledCreaturesOrGraveyardCardsExiledMatch = oracleText.match(
    /whenever one or more creatures you control and\/or creature cards in your graveyard are put into exile,?\s*([^.]+)/i,
  );
  if (controlledCreaturesOrGraveyardCardsExiledMatch) {
    const effect = String(controlledCreaturesOrGraveyardCardsExiledMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.oracleClause === controlledCreaturesOrGraveyardCardsExiledMatch[0].trim())) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'creature_exiled_from_battlefield',
        oracleClause: String(controlledCreaturesOrGraveyardCardsExiledMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'creature',
      });
    }
  }

  const cardsExiledFromHandMatch = oracleText.match(
    /whenever one or more cards are put into exile from your hand(?: or a spell or ability you control exiles one or more cards from an opponent's hand)?,?\s*([^.]+)/i,
  );
  if (cardsExiledFromHandMatch) {
    const effect = String(cardsExiledFromHandMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(cardsExiledFromHandMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const loseControlThatEquipmentMatch = oracleText.match(
    /when you lose control of that equipment(?: this turn)?,?\s*(?:if\s+[^,]+,\s*)?([^.]+)/i,
  );
  if (loseControlThatEquipmentMatch) {
    const effect = String(loseControlThatEquipmentMatch[1] || '').trim().replace(/\s+/g, ' ');
    if (effect && !triggers.some((t) => t.effect === effect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'permanent_exiled_from_battlefield',
        oracleClause: String(loseControlThatEquipmentMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        targetFilter: 'permanent',
      });
    }
  }

  const matches = oracleText.matchAll(/whenever a (creature|permanent) is exiled from the battlefield,?\s*([^.]+)/gi);
  for (const match of matches) {
    const targetFilter = String(match[1] || '').trim().toLowerCase() === 'creature' ? 'creature' : 'permanent';
    const effect = timingTriggerEffect(oracleText, match, 2).replace(/\s+/g, ' ');
    if (!effect) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: targetFilter === 'creature' ? 'creature_exiled_from_battlefield' : 'permanent_exiled_from_battlefield',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      targetFilter,
    });
  }

  return triggers;
}

