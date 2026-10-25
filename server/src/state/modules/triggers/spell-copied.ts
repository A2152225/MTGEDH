/**
 * Spell-copy trigger event: "Whenever you copy a spell" and the copy half of
 * Magecraft ("Whenever you cast or copy an instant or sorcery spell"). Parsed
 * lines with event / pairedEvent 'spell_copied' fire once per copy put on the
 * stack. Live copy sites call queueSpellCopiedTriggers right after pushing the
 * copy; replay rebuilds the queued triggers from their pushTriggeredAbility events.
 * Public: queueSpellCopiedTriggers.
 */
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { queueTargetEventTriggersForStackItem } from './target-event-triggers.js';
import { collectMatchingParsedEventLines } from './triggerConditionFamilyMatch.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

interface SpellCopiedTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'spell_copied';
  effect: string;
  mandatory: boolean;
}

function findStackItem(state: any, stackItemId: string): any | undefined {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.find((item: any) => String(item?.id || '').trim() === stackItemId);
}

/** Queue spell-copied triggers for one copy already on the stack. Idempotent per copy. */
export function queueSpellCopiedTriggers(ctx: any, copiedStackItemId: string, gameIdOverride?: string): any[] {
  if (!ctx || ctx.isReplaying) return [];
  const state = ctx.state;
  const copyId = String(copiedStackItemId || '').trim();
  if (!state || !copyId) return [];
  const copy = findStackItem(state, copyId);
  if (!copy || copy.spellCopiedTriggersQueued) return [];
  if (String(copy.type || 'spell').toLowerCase() !== 'spell') return [];
  copy.spellCopiedTriggersQueued = true;
  // A copy's targets are new targeting (becomes_target); copies never commit a crime.
  const targetedOut = queueTargetEventTriggersForStackItem(ctx, copyId, { gameId: gameIdOverride, skipCrime: true });

  const copyController = String(copy.controller || '').trim();
  const subject = copy.card ? copy : { ...copy, card: copy.spell || copy };
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const detected: SpellCopiedTrigger[] = [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'spell_copied',
      subjectPermanent: subject,
      subjectControllerId: copyController,
      sourcePermanent: permanent,
    })) {
      detected.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        triggerType: 'spell_copied',
        effect: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
      });
    }
  }
  if (detected.length === 0) return targetedOut;

  const gameId = String(gameIdOverride || ctx.gameId || ctx.id || '').trim();
  const queued: any[] = [];
  for (const trigger of orderTriggersByAPNAP(ctx, detected)) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;
    const triggerId = uid('trigger');
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === trigger.permanentId);
    const effectData = {
      triggeringStackItemId: copyId,
      casterId: copyController,
      triggeringSpell: { id: copy.card?.id, name: copy.card?.name, type_line: copy.card?.type_line, isCopy: true },
    };
    const stackItem: any = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanent?.card ? { card: { ...sourcePermanent.card } } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory,
      triggeringPlayer: copyController,
      triggeringStackItemId: copyId,
      effectData,
    };
    state.stack.push(stackItem);
    queued.push(stackItem);
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number(ctx.seq?.value ?? ctx.seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory,
          triggeringPlayer: copyController,
          triggeringStackItemId: copyId,
          effectData,
        });
      } catch (err) {
        debugWarn(1, '[spell-copied] appendEvent(pushTriggeredAbility) failed:', err);
      }
    }
  }
  return [...targetedOut, ...queued];
}
