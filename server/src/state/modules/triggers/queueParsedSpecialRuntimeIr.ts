/**
 * IR emission for leftover special-runtime / abilityActivated families:
 * die rolls, dilemmas, explores, connives, opponent-caused self-discard,
 * and crew/saddle. Callers keep their legacy regex path but drop a hit when
 * a printed line already parsed as IR, so each line fires once.
 * Public: queueParsedActionTriggers, irOwnsPrintedAction.
 */

import type { GameContext } from '../../context.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import {
  collectMatchingParsedEventLines,
  parsedEffectDuplicates,
  parsedEventLinesFor,
} from './triggerConditionFamilyMatch.js';
import type { TriggerConditionEvent } from '../../../../../rules-engine/src/triggerCondition/index.js';

function battlefieldOf(ctx: GameContext): any[] {
  const bf = (ctx as any)?.state?.battlefield;
  return Array.isArray(bf) ? bf : [];
}

export function irOwnsPrintedAction(
  oracleText: string,
  events: readonly TriggerConditionEvent[],
  action: string | undefined,
  cardName?: string,
): Array<{ effect: string; condition: any }> {
  return parsedEventLinesFor(String(oracleText || ''), events, cardName).filter((line) => {
    if (line.condition?.legacyRuntimeOnly) return false;
    if (!action) return true;
    return line.condition?.action === action
      || String(line.condition?.action || '').split('|').includes(action);
  });
}

export function queueParsedActionTriggers(ctx: GameContext, options: {
  event: TriggerConditionEvent;
  action?: string;
  subjectPermanent: any;
  subjectControllerId: string;
  sources?: readonly any[];
  matchContext?: Record<string, unknown>;
  triggerType: string;
  effectData?: Record<string, unknown>;
}): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const sources = options.sources || battlefieldOf(ctx);
  const queued: any[] = [];
  for (const permanent of sources) {
    if (!permanent?.card) continue;
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: options.event,
      action: options.action,
      subjectPermanent: options.subjectPermanent,
      subjectControllerId: options.subjectControllerId,
      sourcePermanent: permanent,
      matchContext: options.matchContext,
    })) {
      const item = queueGenericTriggeredAbility(ctx, {
        permanentId: String(permanent.id || ''),
        controllerId: String(permanent.controller || permanent.owner || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        effect: line.effect,
        description: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
        ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
        ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
      }, options.triggerType, options.effectData);
      if (item) queued.push(item);
    }
  }
  return queued;
}

export function dropLegacyIfIrOwns(existing: any[], irLinesBySource: Map<string, Array<{ effect: string }>>): any[] {
  if (irLinesBySource.size === 0) return existing;
  return existing.filter((trigger) => {
    const pid = String(trigger?.permanentId || trigger?.source || '');
    const lines = irLinesBySource.get(pid);
    if (!lines || lines.length === 0) return true;
    if (String(trigger?.triggerType || '').startsWith('parsed_')) return true;
    return !lines.some((line) => parsedEffectDuplicates([trigger.effect, trigger.description], line));
  });
}

export { parsedEffectDuplicates };
