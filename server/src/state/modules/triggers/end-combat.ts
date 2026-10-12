import type { GameContext } from '../../context.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { collectDelayedEndOfCombatRegistryTriggers } from './delayed-end-combat-watchers.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from './triggerConditionFamilyMatch.js';
import {
  inferEndCombatWhoseTurn,
  shouldQueuePhaseTriggerForActivePlayer,
} from './phaseWhoseTurn.js';

export interface EndOfCombatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  triggerType?: 'end_combat' | 'your_turn_end_combat' | 'each_combat_end';
  requiresChoice?: boolean;
  stackItem?: Record<string, unknown>;
}

export function detectEndOfCombatTriggers(card: any, permanent: any): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || '');
  const cardName = card?.name || 'Unknown';
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const patterns: Array<{ regex: RegExp; triggerType?: EndOfCombatTrigger['triggerType'] }> = [
    { regex: /at the end of combat on your turn,?\s*([\s\S]+)/i, triggerType: 'your_turn_end_combat' },
    { regex: /at the end of combat on each opponent's turn,?\s*([\s\S]+)/i, triggerType: 'end_combat' },
    { regex: /at the end of each combat,?\s*([\s\S]+)/i, triggerType: 'each_combat_end' },
    { regex: /at (?:the )?end of combat,?\s*([\s\S]+)/i, triggerType: 'end_combat' },
  ];

  for (const { regex, triggerType } of patterns) {
    const match = oracleText.match(regex);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (triggers.some((entry) => entry.effect === effectText)) {
      continue;
    }

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType,
    });
    break;
  }

  return triggers;
}

export function getEndOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string,
): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const MAX_TRIGGERS_PER_STEP = 100;

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (triggers.length >= MAX_TRIGGERS_PER_STEP) break;

    const permTriggers = detectEndOfCombatTriggers(permanent.card, permanent);
    const oracleText = String(permanent.card.oracle_text || '');

    for (const trigger of permTriggers) {
      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferEndCombatWhoseTurn(trigger, oracleText),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: ctx.state,
      })) {
        continue;
      }

      const raw = String(trigger.effect || trigger.description || '').trim();
      let interveningText = raw;
      if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
        interveningText = `At end of combat, ${interveningText}`;
      }

      const needsThatPlayerRef =
        /\bthat player\b/i.test(interveningText) ||
        /\btheir\b/i.test(interveningText);
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        interveningText,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: activePlayerId,
              referencedPlayerId: activePlayerId,
              theirPlayerId: activePlayerId,
            }
          : undefined,
      );
      if (ok === false) {
        continue;
      }

      triggers.push(trigger);
    }

    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'end_of_combat',
      subjectPermanent: permanent,
      subjectControllerId: String(permanent.controller || ''),
      sourcePermanent: permanent,
      activePlayerId,
    })) {
      if (triggers.length >= MAX_TRIGGERS_PER_STEP) break;
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates([existing.effect, existing.description], line)
      ))) continue;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        description: line.effect,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
        triggerType: line.condition?.whoseTurn === 'you' ? 'your_turn_end_combat' : 'each_combat_end',
        stackItem: {
          ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
          ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        },
      });
    }
  }

  triggers.push(...collectDelayedEndOfCombatRegistryTriggers(ctx, activePlayerId));

  return triggers;
}
