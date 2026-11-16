/**
 * ETB IR scan for cards in graveyards whose trigger is stamped sourceInGraveyard
 * (Gate Colossus and similar "from your graveyard" watchers). Battlefield
 * collectMatching skips them because they are not permanents.
 * Public: appendGraveyardSourceEtbParsedLines.
 */
import { uid } from '../utils.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from './triggers/triggerConditionFamilyMatch.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from './triggerSourceUtils.js';

export function appendGraveyardSourceEtbParsedLines(options: {
  ctx: any;
  state: any;
  enteringPermanent: any;
  enteringController: string;
  pending: any[];
  pushPending: (state: any, pending: any[], stackItem: any) => void;
}): void {
  const { ctx, state, enteringPermanent, enteringController, pending, pushPending } = options;
  const zones = state?.zones || {};
  for (const [zoneOwnerId, playerZones] of Object.entries(zones as Record<string, any>)) {
    const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
    for (const card of graveyard) {
      const oracle = String(card?.oracle_text || card?.oracleText || '');
      if (!oracle) continue;
      const sourceId = String(card?.id || '').trim();
      if (!sourceId) continue;
      const pseudo = {
        id: sourceId,
        controller: String(zoneOwnerId),
        owner: String(zoneOwnerId),
        card,
        zone: 'graveyard',
      };
      const lines = collectMatchingParsedEventLines({
        ctx,
        oracleText: oracle,
        event: 'enters',
        subjectPermanent: enteringPermanent,
        subjectControllerId: String(enteringController),
        sourcePermanent: pseudo,
        fromZone: String(
          enteringPermanent?.enteredFromZone
          || enteringPermanent?.card?.enteredFromZone
          || enteringPermanent?.castSourceZone
          || enteringPermanent?.card?.castSourceZone
          || '',
        ).toLowerCase() || undefined,
        matchContext: { sourceZone: 'graveyard' },
      }).filter((line) => Boolean(line.condition?.sourceInGraveyard));
      for (const line of lines) {
        const effect = String(line.effect || '').trim();
        const alreadyQueued = pending.some((item) => {
          if (String(item?.source || item?.sourceId || '') !== sourceId) return false;
          return parsedEffectDuplicates([item?.effect, item?.description], line);
        });
        if (alreadyQueued || !effect) continue;
        pushPending(state, pending, {
          id: uid('trigger'),
          type: 'triggered_ability',
          controller: String(zoneOwnerId),
          source: sourceId,
          sourceId,
          permanentId: sourceId,
          sourceName: String(card?.name || 'Graveyard trigger'),
          description: effect,
          effect,
          triggerType: 'parsed_enters',
          mandatory: !/\byou may\b/i.test(effect),
          card: { ...card },
          sourceCard: { ...card },
          sourceZone: 'graveyard',
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(pseudo),
          interveningIfSubjectPermanentId: enteringPermanent?.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
          triggeringPlayer: String(enteringController),
          ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
          ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        });
      }
    }
  }
}
