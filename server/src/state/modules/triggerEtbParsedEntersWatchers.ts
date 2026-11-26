/**
 * Pending external ETB trigger push (auto-decline aware) and parsed "enters" watcher lines.
 * Used by triggerETBEffectsForPermanent (triggerEtbPermanentEffects.ts).
 */
import {
  oracleTextHasTriggersOnlyOnceEachTurn,
  recordTurnLimitedEtbTriggerQueued,
  shouldSkipTurnLimitedEtbTrigger,
} from './triggerDoThisOnlyOnceEachTurn.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { buildInterveningIfSubjectSnapshot, buildTriggerSourcePermanentSnapshot } from './triggerSourceUtils.js';
import { wouldAutoDeclineOptionalTriggeredAbility } from './stackResolveTriggeredAbilityOptionalUtils.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates } from './triggers/triggerConditionFamilyMatch.js';
import { primeDerivedContinuousEffectsForScan, readDerivedContinuousEffects } from './staticEffectSpec.js';
import { beginScopedGrantScan } from './triggers/grantedOracleTriggerScan.js';

export function pushPendingEtbTriggerIfNotAutoDeclined(
  state: any,
  pending: any[],
  stackItem: any,
): void {
  if (wouldAutoDeclineOptionalTriggeredAbility(state, stackItem)) {
    debug(
      2,
      `[triggerETBEffectsForPermanent] Skipping auto-decline optional trigger: ${stackItem?.sourceName || 'Unknown'}`,
    );
    return;
  }
  pending.push(stackItem);
}

/**
 * Parsed "whenever ... enters" watcher lines (oracle text plus quoted continuous grants) for one
 * entering permanent, appended to the pending external ETB trigger list.
 */
export function collectParsedEntersWatcherTriggers(
  ctx: GameContext,
  state: any,
  permanent: any,
  controller: PlayerID,
  pendingExternalEtbTriggers: any[],
): void {
  // One continuous-effects recompute for the whole scan (was one per battlefield permanent: O(n^3) for n token entries).
  const grantScanState = readDerivedContinuousEffects(state) ? state : { ...state };
  if (grantScanState !== state) primeDerivedContinuousEffectsForScan(grantScanState);
  const endGrantScan = beginScopedGrantScan(grantScanState);
  try {
  for (const perm of state.battlefield) {
    if (!perm?.card || perm.id === permanent.id) continue;
    const parsedEffects = collectMatchingParsedEventLines({
      ctx,
      grantScanState,
      oracleText: String(perm.card.oracle_text || ''),
      event: 'enters',
      subjectPermanent: permanent,
      subjectControllerId: String(controller),
      sourcePermanent: perm,
      fromZone: String(
        permanent?.enteredFromZone
        || permanent?.card?.enteredFromZone
        || permanent?.castSourceZone
        || permanent?.card?.castSourceZone
        || '',
      ).toLowerCase() || undefined,
    });
    for (const line of parsedEffects) {
      const effect = line.effect;
      const normalizedEffect = effect.toLowerCase().replace(/\s+/g, ' ').trim();
      const alreadyQueued = pendingExternalEtbTriggers.some((item) => {
        if (String(item?.source || '') !== String(perm.id)) return false;
        return parsedEffectDuplicates([item?.effect, item?.description], line);
      });
      // "This ability triggers only once each turn." (Caretaker's Talent) applies to the parsed line too.
      const onceLimited = String(perm.card.oracle_text || '').split(/\n+/).some((ability: string) =>
        oracleTextHasTriggersOnlyOnceEachTurn(ability) && ability.toLowerCase().includes(normalizedEffect.replace(/\.$/, '')));
      const onceTrigger = { oncePerTurn: onceLimited, triggerType: 'parsed_enters', permanentId: perm.id };
      if (onceLimited && shouldSkipTurnLimitedEtbTrigger(state, onceTrigger, String(perm.id || ''))) continue;
      if (onceLimited && normalizedEffect) recordTurnLimitedEtbTriggerQueued(state, onceTrigger, String(perm.id || ''));
      if (alreadyQueued || !normalizedEffect) continue;
      pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, {
        id: uid('trigger'),
        type: 'triggered_ability',
        controller: perm.controller || controller,
        source: perm.id,
        permanentId: perm.id,
        sourceName: perm.card?.name,
        description: effect,
        triggerType: 'parsed_enters',
        mandatory: !/\byou may\b/i.test(effect),
        effect,
        card: perm.card,
        ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
        ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
        interveningIfSubjectPermanentId: permanent.id,
        interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
        // "that player" in the clause is the entering permanent's controller (re-checked at resolution).
        triggeringPlayer: String(controller),
      } as any);
    }
  }
  } finally {
    endGrantScan();
  }
}
