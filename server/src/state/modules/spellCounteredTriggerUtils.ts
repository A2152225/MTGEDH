/**
 * Emit "spell countered" / "you countered a spell" triggers (Baral, Multani's Presence, etc.).
 */
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { detectSpellCounteredTriggers } from './triggered-abilities.js';
import { queueParsedSubjectEvent } from './triggerEmissionFamilyUtils.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';

export interface SpellCounteredEvent {
  readonly counteringControllerId: string;
  readonly counteredControllerId: string;
  readonly counteredStackItemId?: string;
  readonly counteredCardName?: string;
  readonly counteringSourceName?: string;
  /** True when the countered object was a spell (not an ability). */
  readonly counteredWasSpell: boolean;
}

function pushSpellCounteredTriggerOntoStack(
  ctx: GameContext,
  trigger: any,
  event: SpellCounteredEvent,
): void {
  const state = (ctx as any).state;
  if (!state) return;

  const effectText = String(trigger.effect || trigger.description || '').trim();
  if (!effectText) return;

  const triggerId = `spell_countered_${trigger.permanentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sourcePerm = (state.battlefield || []).find((perm: any) => perm?.id === trigger.permanentId);
  const sourceCard = sourcePerm?.card
    ? { ...sourcePerm.card }
    : { name: trigger.cardName };

  const stackItem = {
    id: triggerId,
    type: 'triggered_ability',
    controller: trigger.controllerId,
    source: trigger.permanentId,
    permanentId: trigger.permanentId,
    sourceName: trigger.cardName,
    card: sourceCard,
    description: effectText,
    effect: effectText,
    triggerType: 'spell_countered',
    mandatory: trigger.mandatory !== false,
    counterPerspective: trigger.counterPerspective,
    counteredStackItemId: event.counteredStackItemId,
    counteredCardName: event.counteredCardName,
    counteringSourceName: event.counteringSourceName,
  };

  state.stack = state.stack || [];
  state.stack.push(stackItem);
  try {
    (ctx as any).bumpSeq?.();
  } catch {
    // best-effort
  }

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (!gameId) return;

  try {
    appendEvent(gameId, state.seq ?? 0, 'pushTriggeredAbility', {
      triggerId,
      sourceId: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      controllerId: trigger.controllerId,
      description: effectText,
      triggerType: 'spell_countered',
      effect: effectText,
      mandatory: trigger.mandatory !== false,
      card: sourceCard,
      counterPerspective: trigger.counterPerspective,
      counteredStackItemId: event.counteredStackItemId,
      counteredCardName: event.counteredCardName,
      counteringSourceName: event.counteringSourceName,
    });
  } catch (err) {
    debugWarn(1, '[spellCounteredTriggerUtils] appendEvent(pushTriggeredAbility) failed:', err);
  }
}

/**
 * Scan battlefield and push triggers that care about a spell being countered.
 */
export function processSpellCounteredTriggers(ctx: GameContext, event: SpellCounteredEvent): void {
  if (!event?.counteredWasSpell) return;
  if ((ctx as any)?.isReplaying) return;

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (battlefield.length === 0) return;

  const counteringControllerId = String(event.counteringControllerId || '').trim();
  const counteredControllerId = String(event.counteredControllerId || '').trim();
  if (!counteringControllerId || !counteredControllerId) return;

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const detected = detectSpellCounteredTriggers(permanent.card, permanent, (ctx as any)?.state);
    for (const trigger of detected) {
      const perspective = String((trigger as any).counterPerspective || 'controlled_spell_countered');
      if (perspective === 'you_countered_spell') {
        if (String(trigger.controllerId) !== counteringControllerId) continue;
      } else {
        // controlled_spell_countered: fires for the player whose spell was countered
        if (String(trigger.controllerId) !== counteredControllerId) continue;
      }

      const raw = String(trigger.effect || trigger.description || '').trim();
      let textForEval = raw;
      if (textForEval && !/^(?:when|whenever|at)\b/i.test(textForEval)) {
        textForEval = perspective === 'you_countered_spell'
          ? `Whenever a spell or ability you control counters a spell, ${textForEval}`
          : `Whenever a spell you control is countered, ${textForEval}`;
      }
      const sourcePerm = battlefield.find((perm: any) => perm?.id === trigger.permanentId);
      const ok = isInterveningIfSatisfied(
        ctx as any,
        String(trigger.controllerId),
        textForEval,
        sourcePerm,
        undefined,
      );
      if (ok === false) continue;

      debug(2, `[spellCounteredTriggerUtils] Triggered: ${trigger.cardName} - ${trigger.description}`);
      pushSpellCounteredTriggerOntoStack(ctx, trigger, event);
    }
  }

  queueParsedSubjectEvent(ctx, {
    event: 'spell_countered',
    subjectPermanent: { id: '', controller: counteredControllerId, card: { type_line: 'Instant' } },
    subjectControllerId: counteredControllerId,
    triggerType: 'spell_countered',
    zoneOwnerId: counteredControllerId,
    effectData: { counteredControllerId, counteringControllerId },
  });
  queueParsedSubjectEvent(ctx, {
    event: 'counters_spell',
    subjectPermanent: { id: '', controller: counteringControllerId, card: { type_line: 'Instant' } },
    subjectControllerId: counteringControllerId,
    triggerType: 'you_countered_spell',
    effectData: { counteredControllerId, counteringControllerId },
  });
}
