import type { GameContext } from '../../context.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';

import { isInterveningIfSatisfied } from './intervening-if.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from './triggerConditionFamilyMatch.js';

export interface MillTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'player_mills' | 'opponent_mills' | 'you_mill';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  frequency: 'per_card' | 'per_event';
  cardFilter: 'any' | 'land' | 'nonland' | 'creature' | 'noncreature_nonland' | 'artifact' | 'permanent';
}

function parseMillCondition(
  rawCondition: string,
): Pick<MillTrigger, 'frequency' | 'cardFilter'> | null {
  const condition = String(rawCondition || '')
    .trim()
    .toLowerCase()
    .replace(/^an\s+/, 'a ')
    .replace(/\s+/g, ' ');

  if (!condition || condition.includes('for the first time each turn')) {
    return null;
  }
  if (condition.includes(' or ') && !condition.startsWith('one or more ')) {
    return null;
  }

  const frequency: MillTrigger['frequency'] = condition.startsWith('one or more ')
    ? 'per_event'
    : 'per_card';

  if (condition.includes('noncreature, nonland')) return { frequency, cardFilter: 'noncreature_nonland' };
  if (condition.includes('nonland')) return { frequency, cardFilter: 'nonland' };
  if (condition.includes('creature')) return { frequency, cardFilter: 'creature' };
  if (condition.includes('artifact')) return { frequency, cardFilter: 'artifact' };
  if (condition.includes('permanent')) return { frequency, cardFilter: 'permanent' };
  if (condition.includes('land')) return { frequency, cardFilter: 'land' };
  if (condition === 'a card' || condition === 'one card' || condition === 'one or more cards') {
    return { frequency, cardFilter: 'any' };
  }

  return null;
}

export function detectMillTriggers(card: any, permanent: any): MillTrigger[] {
  const triggers: MillTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');

  const nonlandMilledMatch = oracleText.match(/whenever one or more nonland cards are milled,?\s*([^.]+)/i);
  if (nonlandMilledMatch) {
    const effect = timingTriggerEffect(oracleText, nonlandMilledMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'player_mills',
        oracleClause: String(nonlandMilledMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
        frequency: 'per_event',
        cardFilter: 'nonland',
      });
    }
  }

  const matches = oracleText.matchAll(/whenever (a player|an opponent|you) mill(?:s)? ([^,]+),?\s*([^.]+)/gi);
  for (const match of matches) {
    const subject = String(match[1] || '').trim().toLowerCase();
    const parsedCondition = parseMillCondition(String(match[2] || ''));
    const effect = timingTriggerEffect(oracleText, match, 3);
    if (!parsedCondition || !effect) {
      continue;
    }

    const triggerType = subject === 'an opponent'
      ? 'opponent_mills'
      : subject === 'a player'
        ? 'player_mills'
        : 'you_mill';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType,
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      frequency: parsedCondition.frequency,
      cardFilter: parsedCondition.cardFilter,
    });
  }

  return triggers;
}

export function getMillTriggers(
  ctx: GameContext,
  millingPlayerId: string,
): MillTrigger[] {
  const triggers: MillTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permController = String(permanent.controller || '');
    const permTriggers = detectMillTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      const interveningText = String(trigger.oracleClause || trigger.effect || '').trim();
      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText) || /\btheir\b/i.test(interveningText);
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permController,
        interveningText,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: millingPlayerId,
              referencedPlayerId: millingPlayerId,
              theirPlayerId: millingPlayerId,
            }
          : undefined,
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_mills':
          if (millingPlayerId !== permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
        case 'player_mills':
          triggers.push({ ...trigger, controllerId: permController });
          break;
        case 'you_mill':
          if (millingPlayerId === permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
      }
    }

    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'mills',
      subjectPermanent: { id: '', typeLine: 'Card', controllerId: millingPlayerId },
      subjectControllerId: millingPlayerId,
      sourcePermanent: permanent,
    })) {
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates(existing.effect || '', line)
      ))) continue;
      const controller = line.condition?.alternatives[0]?.controller;
      const triggerType = controller === 'you' ? 'you_mill' : controller === 'not_you' ? 'opponent_mills' : 'player_mills';
      if (triggerType === 'you_mill' && millingPlayerId !== permController) continue;
      if (triggerType === 'opponent_mills' && millingPlayerId === permController) continue;
      const types = (line.condition?.alternatives[0]?.subject.typeGroups || []).flat();
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: permController,
        triggerType,
        oracleClause: line.effect,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
        frequency: line.condition?.quantity === 'one_or_more' ? 'per_event' : 'per_card',
        cardFilter: types.includes('land') ? 'land' : types.includes('creature') ? 'creature' : 'any',
      });
    }
  }

  return triggers;
}