/**
 * Origin parent: server/src/state/modules/triggers/end-combat.ts
 * Cluster: delayed END_OF_COMBAT watchers on state.delayedTriggerRegistry
 *   (Corrosive Ooze / Defiant Vanguard / Battering Ram “destroy that
 *   creature / those permanents at end of combat”).
 * Public: collectDelayedEndOfCombatRegistryTriggers
 * These live on state.delayedTriggerRegistry, not battlefield oracle.
 * “At end of combat” delayed riders (CR 603.7) are not detectEndOfCombatTriggers.
 */

import type { GameContext } from '../../context.js';
import {
  DelayedTriggerTiming,
  checkDelayedTriggers,
  createDelayedTriggerRegistry,
} from '../../../../../rules-engine/src/delayedTriggeredAbilities.js';
import { inferTriggeredAbilityTargetMetadata } from '../inferTriggeredAbilityTargetMetadata.js';
import { delayedCleanupStackFieldsFromRegistry } from './delayed-registry-watcher-metadata.js';
import { resolveDelayedCombatHistorySelector } from './delayedCombatHistorySelectors.js';
import { detectRequiresChoice } from './turn-phases-handlers/turnPhaseEffectChoiceHelpers.js';

export function collectDelayedEndOfCombatRegistryTriggers(
  ctx: GameContext,
  activePlayerId: string,
) {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  if (!state) return [];

  const registry = (state.delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<
    typeof createDelayedTriggerRegistry
  >;
  const pending = (registry.triggers || []).filter(
    (trigger) => trigger.timing === DelayedTriggerTiming.END_OF_COMBAT,
  );
  if (pending.length === 0) return [];

  const delayedCheck = checkDelayedTriggers(registry, {
    type: 'combat_end',
    activePlayerId,
    currentTurn: Number(state.turnNumber ?? state.turn ?? 0) || 0,
  });
  if (delayedCheck.triggersToFire.length === 0) return [];

  state.delayedTriggerRegistry = {
    ...registry,
    triggers: delayedCheck.remainingTriggers,
    firedTriggerIds: [
      ...registry.firedTriggerIds,
      ...delayedCheck.triggersToFire.map((trigger) => trigger.id),
    ],
  };

  return delayedCheck.triggersToFire.map((delayed) => {
    let effect = String(delayed.effect || '').trim();
    const snap: any = (delayed as any).eventDataSnapshot || {};
    const refIds = [
      ...(Array.isArray((delayed as any).targets) ? (delayed as any).targets : []),
      ...(Array.isArray(snap.chosenObjectIds) ? snap.chosenObjectIds : []),
      ...(snap.targetPermanentId ? [snap.targetPermanentId] : []),
    ].map(String);
    const combatSel = resolveDelayedCombatHistorySelector(effect, refIds, state.battlefield || []);
    const cleanupSource: any = combatSel
      ? { ...delayed, effect: combatSel.effect, targets: [], eventDataSnapshot: {}, effectData: { ...((delayed as any).effectData || {}), lastAntecedentBattlefieldPermanentIds: combatSel.ids } }
      : delayed;
    if (combatSel) effect = combatSel.effect;
    const targetMetadata = inferTriggeredAbilityTargetMetadata(effect);
    const cleanupFields = delayedCleanupStackFieldsFromRegistry(cleanupSource);
    return {
      permanentId: String(delayed.sourceId || ''),
      cardName: String(delayed.sourceName || 'Delayed trigger'),
      controllerId: String(delayed.controllerId || ''),
      triggerType: 'end_combat' as const,
      description: effect,
      effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect) || targetMetadata.requiresTarget === true,
      stackItem: {
        ...targetMetadata,
        ...cleanupFields,
        effectData: {
          ...(delayed.effectData && typeof delayed.effectData === 'object' ? delayed.effectData : {}),
          ...(cleanupFields.lastAntecedentBattlefieldPermanentIds.length > 0
            ? { lastAntecedentBattlefieldPermanentIds: cleanupFields.lastAntecedentBattlefieldPermanentIds }
            : {}),
        },
      },
    };
  }).filter((trigger) => Boolean(trigger.effect));
}
