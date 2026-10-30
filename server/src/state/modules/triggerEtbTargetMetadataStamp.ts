/**
 * Origin parent: triggerEtbPermanentEffects.ts
 * Cluster: watcher ETB stack items (Warstorm Surge: "it deals damage equal to
 *   its power to any target") were pushed with no target metadata, so resolution
 *   never opened target selection.
 * Public: stampWatcherEtbTriggerTargetMetadata
 */

import {
  inferTriggeredAbilityTargetMetadata,
  isModalChooseModesEffectText,
} from './inferTriggeredAbilityTargetMetadata.js';

export function stampWatcherEtbTriggerTargetMetadata(state: any, stackItem: any): void {
  if (!stackItem || stackItem.requiresTarget === true) return;
  const effectText = String(stackItem.effect || stackItem.description || '').trim();
  if (!effectText || isModalChooseModesEffectText(effectText)) return;

  const metadata = inferTriggeredAbilityTargetMetadata(effectText, {
    gameState: state,
    controllerId: String(stackItem.controller || ''),
    sourceName: String(stackItem.sourceName || ''),
  } as any);
  if (metadata.requiresTarget !== true) return;
  if (!metadata.targetType && !metadata.targetZone) return;

  stackItem.requiresTarget = true;
  stackItem.needsTargetSelection = true;
  if (!stackItem.targetType && metadata.targetType) stackItem.targetType = metadata.targetType;
  if (!stackItem.targetConstraint && metadata.targetConstraint) stackItem.targetConstraint = metadata.targetConstraint;
  if (!stackItem.targetZone && metadata.targetZone) stackItem.targetZone = metadata.targetZone;
  if (!stackItem.targetDestination && metadata.targetDestination) stackItem.targetDestination = metadata.targetDestination;
  if (!stackItem.targetGraveyardScope && metadata.targetGraveyardScope) {
    stackItem.targetGraveyardScope = metadata.targetGraveyardScope;
  }
  if (typeof stackItem.minTargets !== 'number' && typeof metadata.minTargets === 'number') {
    stackItem.minTargets = metadata.minTargets;
  }
  if (typeof stackItem.maxTargets !== 'number' && typeof metadata.maxTargets === 'number') {
    stackItem.maxTargets = metadata.maxTargets;
  }
  if (!stackItem.targetCombatRole && metadata.targetCombatRole) stackItem.targetCombatRole = metadata.targetCombatRole;
  if (metadata.targetFilterRequiresOneOrMoreColors === true) {
    stackItem.targetFilterRequiresOneOrMoreColors = true;
  }
}
