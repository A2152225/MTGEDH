import type { GameContext } from '../../context.js';

import { isInterveningIfSatisfied } from './intervening-if.js';

export interface DiscardTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'opponent_discards' | 'player_discards' | 'you_discard';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  frequency: 'per_card' | 'per_event';
  cardFilter: 'any' | 'land' | 'nonland' | 'creature' | 'noncreature_nonland' | 'artifact' | 'permanent';
}

function parseDiscardCondition(
  rawCondition: string,
): Pick<DiscardTrigger, 'frequency' | 'cardFilter'> | null {
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

  switch (condition) {
    case 'a card':
      return { frequency: 'per_card', cardFilter: 'any' };
    case 'one or more cards':
      return { frequency: 'per_event', cardFilter: 'any' };
    case 'a land card':
      return { frequency: 'per_card', cardFilter: 'land' };
    case 'one or more land cards':
      return { frequency: 'per_event', cardFilter: 'land' };
    case 'a nonland card':
      return { frequency: 'per_card', cardFilter: 'nonland' };
    case 'one or more nonland cards':
      return { frequency: 'per_event', cardFilter: 'nonland' };
    case 'a creature card':
      return { frequency: 'per_card', cardFilter: 'creature' };
    case 'one or more creature cards':
      return { frequency: 'per_event', cardFilter: 'creature' };
    case 'a noncreature, nonland card':
      return { frequency: 'per_card', cardFilter: 'noncreature_nonland' };
    case 'one or more noncreature, nonland cards':
      return { frequency: 'per_event', cardFilter: 'noncreature_nonland' };
    case 'a artifact card':
    case 'an artifact card':
      return { frequency: 'per_card', cardFilter: 'artifact' };
    case 'one or more artifact cards':
      return { frequency: 'per_event', cardFilter: 'artifact' };
    case 'a permanent card':
      return { frequency: 'per_card', cardFilter: 'permanent' };
    case 'one or more permanent cards':
      return { frequency: 'per_event', cardFilter: 'permanent' };
    default:
      return null;
  }
}

export function detectDiscardTriggers(card: any, permanent: any): DiscardTrigger[] {
  const triggers: DiscardTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');

  const matches = oracleText.matchAll(/whenever (an opponent|a player|you) discard(?:s)? ([^,]+),\s*([^.]+)/gi);
  for (const match of matches) {
    const subject = String(match[1] || '').trim().toLowerCase();
    const parsedCondition = parseDiscardCondition(String(match[2] || ''));
    const effect = String(match[3] || '').trim();
    if (!parsedCondition || !effect) {
      continue;
    }

    const triggerType = subject === 'an opponent'
      ? 'opponent_discards'
      : subject === 'a player'
        ? 'player_discards'
        : 'you_discard';

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

export function getDiscardTriggers(
  ctx: GameContext,
  discardingPlayerId: string,
): DiscardTrigger[] {
  const triggers: DiscardTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permController = String(permanent.controller || '');
    const permTriggers = detectDiscardTriggers(permanent.card, permanent);
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
              thatPlayerId: discardingPlayerId,
              referencedPlayerId: discardingPlayerId,
              theirPlayerId: discardingPlayerId,
            }
          : undefined,
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_discards':
          if (discardingPlayerId !== permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
        case 'player_discards':
          triggers.push({ ...trigger, controllerId: permController });
          break;
        case 'you_discard':
          if (discardingPlayerId === permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
      }
    }
  }

  return triggers;
}