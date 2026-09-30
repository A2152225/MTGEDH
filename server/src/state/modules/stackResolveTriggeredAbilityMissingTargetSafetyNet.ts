/**
 * Generic safety net for "you may ... target ..." triggered abilities (Hammer of Nazahn class).
 *
 * Some trigger queue paths forget to stamp `requiresTarget` / `targetType` on the stack item. When the
 * player then answers Yes to the may-choice the trigger reaches resolution with no chosen target, and
 * the Oracle IR step for an ambiguous "target creature you control" silently does nothing.
 *
 * Before the generic target prompt runs, an accepted optional trigger whose effect text names a
 * target but which has neither target metadata nor any chosen target gets that metadata inferred from
 * its own effect text, so `tryDeferTriggeredAbilityTargetSelection` prompts for a target.
 */
import type { GameContext } from '../context.js';
import { inferTriggeredAbilityTargetMetadata, isModalChooseModesEffectText } from './inferTriggeredAbilityTargetMetadata.js';

const SKIPPED_TRIGGER_TYPES = new Set(['mentor']);

const STAMPABLE_FIELDS = [
  'targetType',
  'targetConstraint',
  'targetZone',
  'targetDestination',
  'targetGraveyardScope',
  'destinationUsesSelectedCardOwner',
  'battlefieldControllerMode',
  'battlefieldCounters',
  'targetAction',
  'targetFilterTypes',
  'targetFilterRequiredTypeWords',
  'targetFilterExcludeTypes',
  'targetFilterPermanentOnly',
  'targetFilterExactManaValue',
  'targetFilterMinManaValue',
  'targetFilterMaxManaValue',
  'targetTotalPowerLimit',
  'targetCastWithoutPayingManaCost',
  'targetCastIsOptional',
  'targetFilterRequiresOneOrMoreColors',
  'targetCombatRole',
  'minTargets',
  'maxTargets',
] as const;

function hasAnyChosenTarget(item: any): boolean {
  const lists = [item?.targets, item?.targetIds, item?.chosenTargets, item?.selectedTargets, item?.effectData?.targets];
  if (lists.some((entry) => Array.isArray(entry) && entry.length > 0)) return true;
  const scalars = [
    item?.targetId,
    item?.targetPermanentId,
    item?.targetPlayerId,
    item?.targetPlayer,
    item?.effectData?.targetPermanentId,
    item?.effectData?.targetPlayerId,
    item?.effectData?.targetId,
  ];
  return scalars.some((entry) => String(entry ?? '').trim().length > 0);
}

/**
 * Returns true when metadata was stamped on the item (so the caller's normal targeting path runs).
 */
export function stampMissingTargetMetadataAfterOptionalAccept(
  ctx: GameContext,
  item: any,
  _state: any,
  options: { triggerType?: string; description?: string },
): boolean {
  if (!item || String(item.type || '') !== 'triggered_ability') return false;
  if (item.requiresTarget) return false;
  // Optional triggers only: either already accepted (Yes), or still pending their may-choice (the
  // IR-primary Effect Program asks the may-choice itself, after stack-level targeting).
  if (item.optionalTriggeredAbilityDecisionApplied !== true && item.mandatory !== false) return false;
  if ((ctx as any)?.isReplaying) return false;
  if (SKIPPED_TRIGGER_TYPES.has(String(options.triggerType || item.triggerType || '').toLowerCase())) return false;
  if (hasAnyChosenTarget(item)) return false;

  const effectText = String(item.effect || item.description || options.description || '').trim();
  if (!effectText || !/\btarget\b/i.test(effectText)) return false;
  if (isModalChooseModesEffectText(effectText)) return false;

  const metadata = inferTriggeredAbilityTargetMetadata(effectText, {
    gameState: (ctx as any)?.state,
    controllerId: String(item.controller || ''),
    sourceName: String(item.sourceName || ''),
  } as any);
  if (!metadata.requiresTarget || (!metadata.targetType && !metadata.targetZone)) return false;

  item.requiresTarget = true;
  item.needsTargetSelection = true;
  for (const field of STAMPABLE_FIELDS) {
    const value = (metadata as any)[field];
    if (value !== undefined && (item as any)[field] === undefined) {
      (item as any)[field] = Array.isArray(value) ? [...value] : value;
    }
  }
  return true;
}