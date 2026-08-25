/**
 * Extracted from triggerEtbEntryEffects.ts: temporary ETB trigger queue.
 * Cluster moved: getTemporaryEtbTriggers, addTemporaryEtbTrigger,
 * clearTemporaryEtbTriggers, queueTemporaryEtbTriggersForEntry.
 * Public: addTemporaryEtbTrigger, clearTemporaryEtbTriggers,
 * queueTemporaryEtbTriggersForEntry
 *
 * Leaf must not import triggerEtbEntryEffects.ts or triggerEtbEntryEffects-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { debug } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from '../triggers/intervening-if.js';
import { buildInterveningIfSubjectSnapshot } from '../triggerSourceUtils.js';
import { pushTriggerDoublerCopies } from '../triggers/combat.js';
import { persistTriggeredAbilityPush } from './triggerEtbPersistTriggeredAbility.js';
import { matchesRequiredTypePhrase } from './triggerEtbTypedPermanentMatch.js';

function getTemporaryEtbTriggers(state: any): any[] {
  return Array.isArray(state?.temporaryEtbTriggers)
    ? state.temporaryEtbTriggers
    : [];
}

export function addTemporaryEtbTrigger(state: any, entry: any): void {
  if (!state || !entry) return;
  state.temporaryEtbTriggers = getTemporaryEtbTriggers(state);
  state.temporaryEtbTriggers.push(entry);
}

export function clearTemporaryEtbTriggers(state: any): number {
  if (!state || !Array.isArray(state.temporaryEtbTriggers)) return 0;

  const before = state.temporaryEtbTriggers.length;
  const expiringDurations = new Set(['end_of_turn', 'until_end_of_turn', 'eot', 'this_turn']);
  state.temporaryEtbTriggers = state.temporaryEtbTriggers.filter((entry: any) => {
    const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
    return !expiringDurations.has(expiresAt);
  });

  if (state.temporaryEtbTriggers.length === 0) {
    delete state.temporaryEtbTriggers;
  }

  return before - (Array.isArray(state.temporaryEtbTriggers) ? state.temporaryEtbTriggers.length : 0);
}

export function queueTemporaryEtbTriggersForEntry(
  ctx: GameContext,
  enteringPermanent: any,
  controller: PlayerID,
  options: {
    isCreature: boolean;
    isEnchantment: boolean;
    isToken: boolean;
  },
): void {
  if ((ctx as any).isReplaying) return;
  const state = (ctx as any).state;
  const temporaryTriggers = getTemporaryEtbTriggers(state);
  if (temporaryTriggers.length === 0) return;

  const enteringController = String(controller || '');
  const enteringTypeLine = String(enteringPermanent?.card?.type_line || '');

  for (const entry of temporaryTriggers) {
    if (!entry) continue;

    const triggerController = String(entry?.controller || '');
    if (!triggerController || triggerController !== enteringController) {
      continue;
    }

    const watchTypes = Array.isArray(entry?.watchTypes)
      ? entry.watchTypes.map((value: any) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const matchesWatchedType =
      (options.isCreature && watchTypes.includes('creature'))
      || (options.isEnchantment && watchTypes.includes('enchantment'));
    if (!matchesWatchedType) {
      continue;
    }

    if (entry?.nontokenOnly === true && options.isToken) {
      continue;
    }
    if (entry?.tokenOnly === true && !options.isToken) {
      continue;
    }

    const requiredTypeRaw = typeof entry?.requiredTypePhrase === 'string'
      ? String(entry.requiredTypePhrase)
      : '';
    const requiredType = requiredTypeRaw
      .replace(/\bcreatures\b/gi, 'creature')
      .replace(/\bartifacts\b/gi, 'artifact')
      .trim();
    if (requiredType && !matchesRequiredTypePhrase(enteringTypeLine, requiredType, options.isToken)) {
      continue;
    }

    const triggerText = typeof entry?.triggerText === 'string' ? String(entry.triggerText).trim() : '';
    if (triggerText) {
      try {
        const satisfied = isInterveningIfSatisfied(
          ctx as any,
          triggerController,
          triggerText,
          enteringPermanent,
        );
        if (satisfied === false) {
          continue;
        }
      } catch {
        // Conservative fallback: keep the trigger if evaluation fails.
      }
    }

    state.stack = state.stack || [];
    const stackItem = {
      id: uid('trigger'),
      type: 'triggered_ability',
      controller: triggerController,
      source: String(entry?.sourceId || entry?.id || ''),
      sourceName: String(entry?.sourceName || 'Temporary ETB Trigger'),
      description: String(entry?.description || entry?.effect || '').trim(),
      triggerType: String(entry?.triggerType || 'temporary_etb'),
      mandatory: entry?.mandatory !== false,
      interveningIfSubjectPermanentId: enteringPermanent?.id,
      interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
    } as any;
    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);
    persistTriggeredAbilityPush(ctx, stackItem);

    debug(2, `[queueTemporaryEtbTriggersForEntry] âš¡ ${stackItem.sourceName}: ${stackItem.description}`);
  }
}
