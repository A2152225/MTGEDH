/**
 * Parsed (IR) emitters for Class level-ups, fully unlocked Rooms and "when you control no X"
 * state triggers. Origin: round 9 of the trigger-IR migration (no legacy runtime existed).
 * Public: queueClassLevelTriggers, queueRoomFullyUnlockedTriggers, queueControlsNoneStateTriggers.
 */
import type { GameContext } from '../context.js';
import { applyClassLevelGatingToPermanent, getPermanentClassLevel } from '../../../../shared/src/classLevelText.js';
import { queueGenericTriggeredAbility, queueParsedSubjectEvent } from './triggerEmissionFamilyUtils.js';
import { parsedEffectDuplicates, parsedEventLinesFor, permanentToTriggerMatch } from './triggers/triggerConditionFamilyMatch.js';
import { permanentHasTriggeredAbilities } from './triggers/triggeredAbilitySuppression.js';
import { triggerConditionMatches } from '../../../../rules-engine/src/triggerCondition/index.js';

/** "When this Class becomes level N" (CR 716.2a). Call after the level changed. */
export function queueClassLevelTriggers(ctx: GameContext, classPermanent: any): any[] {
  if ((ctx as any)?.isReplaying || !classPermanent?.card) return [];
  // The level-N section only becomes part of the oracle once gating catches up.
  try { applyClassLevelGatingToPermanent(classPermanent); } catch { /* best-effort */ }
  const level = getPermanentClassLevel(classPermanent);
  return queueParsedSubjectEvent(ctx, {
    event: 'class_level',
    subjectPermanent: classPermanent,
    subjectControllerId: String(classPermanent.controller || ''),
    triggerType: 'class_level',
    matchContext: { classLevel: level },
    effectData: { classPermanentId: String(classPermanent.id || ''), classLevel: level },
  });
}

/**
 * Class permanents whose level rose since gating last ran (card.classLevel is the gated level).
 * Call right after an effect resolves, before the SBA gating sync.
 */
export function queueClassLevelUpsSinceGating(ctx: GameContext): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const battlefield = Array.isArray((ctx as any)?.state?.battlefield) ? (ctx as any).state.battlefield : [];
  const queued: any[] = [];
  for (const perm of battlefield) {
    const gated = Number(perm?.card?.classLevel);
    if (!Number.isFinite(gated) || getPermanentClassLevel(perm) <= gated) continue;
    queued.push(...queueClassLevelTriggers(ctx, perm));
  }
  return queued;
}

/** "Whenever you fully unlock a Room" (CR 709.5). Call when the Room's last locked door unlocks. */
export function queueRoomFullyUnlockedTriggers(ctx: GameContext, room: any): any[] {
  if ((ctx as any)?.isReplaying || !room?.card) return [];
  return queueParsedSubjectEvent(ctx, {
    event: 'room_fully_unlocked',
    subjectPermanent: room,
    subjectControllerId: String(room.controller || ''),
    triggerType: 'room_fully_unlocked',
    effectData: { roomPermanentId: String(room.id || '') },
  });
}

/**
 * "When you control no X, ..." is a state trigger (CR 603.8): it triggers whenever the state
 * holds and not again while that ability is still on the stack. Checked during SBA passes.
 */
export function queueControlsNoneStateTriggers(ctx: GameContext): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const queued: any[] = [];
  for (const source of battlefield) {
    const oracle = String(source?.card?.oracle_text || '');
    if (!/\bcontrol no\b/i.test(oracle)) continue;
    if (!permanentHasTriggeredAbilities(source, state, { event: 'other' })) continue;
    const controllerId = String(source.controller || '');
    const sourceMatch = { id: String(source.id || ''), controllerId };
    for (const line of parsedEventLinesFor(oracle, ['controls_none'], String(source.card?.name || '') || undefined)) {
      if (line.condition?.event !== 'controls_none') continue;
      const holds = !battlefield.some((perm: any) => perm?.card && triggerConditionMatches(
        line.condition,
        permanentToTriggerMatch(perm, String(perm.controller || ''), state),
        sourceMatch as any,
        {} as any,
      ));
      if (!holds) continue;
      const stack = Array.isArray(state?.stack) ? state.stack : [];
      if (stack.some((item: any) => String(item?.permanentId || item?.source || '') === sourceMatch.id
        && parsedEffectDuplicates([item?.effect, item?.description], line.effect))) continue;
      const item = queueGenericTriggeredAbility(ctx, {
        permanentId: sourceMatch.id,
        controllerId,
        cardName: String(source.card?.name || 'Unknown'),
        effect: line.effect,
        description: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
      }, 'controls_none', { sourcePermanentId: sourceMatch.id });
      if (item) queued.push(item);
    }
  }
  return queued;
}
