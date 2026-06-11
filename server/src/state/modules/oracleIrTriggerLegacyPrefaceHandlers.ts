import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyGraveyardPermissionEffectsFromText } from './graveyard-permissions.js';
import { tryApplyCastingModifierGrantsFromText } from './casting-modifiers.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyPrefaceParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly battlefield: readonly any[];
}

export function applyRetiredTriggerLegacyPlaneswalkerLoyaltyCounters(
  params: TriggerLegacyPrefaceParams,
): boolean {
  const addsLoyalty = Number(params.triggerItem?.addsLoyaltyCounters || 0);
  if (addsLoyalty <= 0) {
    return false;
  }

  const permId = params.triggerItem?.permanentId || params.triggerItem?.source;
  const planeswalker = params.battlefield.find((p: any) => p && String(p.id) === String(permId));
  if (!planeswalker) {
    return false;
  }

  planeswalker.counters = planeswalker.counters || {};
  const currentLoyalty = parseInt(String(planeswalker.counters.loyalty || planeswalker.card?.loyalty || 0), 10) || 0;
  const newLoyalty = currentLoyalty + addsLoyalty;
  planeswalker.counters.loyalty = newLoyalty;

  debug(1, `[executeTriggerEffect] Installed loyalty counter on ${params.sourceName}: added ${addsLoyalty}, now at ${newLoyalty}`);
  return true;
}

export function applyRetiredTriggerLegacyCastingModifierGrants(
  params: TriggerLegacyPrefaceParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.description, params.sourceName)) {
    return false;
  }

  if (tryApplyCastingModifierGrantsFromText(params.state, params.controller, params.description, params.sourceName, params.triggerItem)) {
    return true;
  }

  const activatedAbilityTextForGrants = String(params.triggerItem?.activatedAbilityText || '').trim();
  if (
    activatedAbilityTextForGrants
    && activatedAbilityTextForGrants !== params.description
    && tryApplyCastingModifierGrantsFromText(params.state, params.controller, activatedAbilityTextForGrants, params.sourceName, params.triggerItem)
  ) {
    return true;
  }

  return false;
}

export function applyRetiredTriggerLegacyGraveyardPermissionEffects(
  params: TriggerLegacyPrefaceParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.description, params.sourceName)) {
    return false;
  }

  const directGraveyardPermissionEffectsApplied = applyGraveyardPermissionEffectsFromText(
    params.ctx,
    params.controller,
    params.sourceName,
    params.description,
    params.triggerItem,
  );
  if (directGraveyardPermissionEffectsApplied > 0) {
    return true;
  }

  const activatedAbilityText = String(params.triggerItem?.activatedAbilityText || '').trim();
  const activatedAbilityGraveyardPermissionEffectsApplied =
    activatedAbilityText && activatedAbilityText !== params.description
      ? applyGraveyardPermissionEffectsFromText(params.ctx, params.controller, params.sourceName, activatedAbilityText, params.triggerItem)
      : 0;

  return activatedAbilityGraveyardPermissionEffectsApplied > 0;
}
