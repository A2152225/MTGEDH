/**
 * socket/resolutionActivatedAbilityTargetingUtils.ts
 *
 * Activated-ability target building + "whenever you activate" trigger fan-out helpers.
 * Extracted from resolution.ts to unlock discard/graveyard handler splits under ~40KB.
 */

import { appendEvent } from "../db/index.js";
import { matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType, parseTargetRequirements } from "../rules-engine/targeting";
import { serializeAbilityActivatedTriggeredStackItem, triggerAbilityActivatedTriggers } from "../state/modules/triggers/ability-activated.js";
import {
  extractStackItemTargetIds,
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromAbility,
} from "../state/modules/triggers/targeted.js";
import { cardManaValue, parsePT } from "../state/utils.js";
import { debugWarn } from "../utils/debug.js";
import { matchesRequiredTypeWords } from "./resolutionKeywordChoiceHandlers.js";
export function fireBattlefieldAbilityActivatedTriggers(
  game: any,
  controllerId: string,
  permanentId: string,
  abilityText: string,
  gameId: string,
  stackItemId?: string,
  persistActivateEvent?: () => void,
  extras?: { lifePaidForCost?: number },
): void {
  persistActivateEvent?.();

  const stack = Array.isArray(game.state?.stack) ? game.state.stack : [];
  const stackItem = stackItemId
    ? stack.find((item: any) => item && String(item.id || '') === String(stackItemId))
    : undefined;
  const lifeFromStack = Number((stackItem as any)?.lifePaidForCost || 0);
  const lifeFromExtras = Number(extras?.lifePaidForCost || 0);
  const lifeFromText = (() => {
    const text = String(abilityText || (stackItem as any)?.activatedAbilityText || '');
    const match = text.match(/\bpay\s+(\d+)\s+life\b/i);
    return match ? Number(match[1]) : 0;
  })();
  const lifePaidForCost = [lifeFromExtras, lifeFromStack, lifeFromText]
    .find((n) => Number.isFinite(n) && n > 0) || 0;

  if (stackItem && lifePaidForCost > 0 && !(Number((stackItem as any).lifePaidForCost) > 0)) {
    (stackItem as any).lifePaidForCost = lifePaidForCost;
  }

  const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
    activatedBy: controllerId as any,
    sourcePermanentId: permanentId as any,
    isManaAbility: false,
    abilityText,
    ...(stackItemId ? { stackItemId } : null),
    ...(lifePaidForCost > 0 ? { lifePaidForCost } : null),
  });

  for (const triggeredAbility of triggeredAbilities) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeAbilityActivatedTriggeredStackItem(triggeredAbility));
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility ability-activated) failed:', err);
    }
  }

  if (!stackItemId || !stackItem) return;

  const targetIds = extractStackItemTargetIds(stackItem);
  if (targetIds.length === 0) return;

  const targetedTriggers = triggerPermanentTargetedTriggersFromAbility(game as any, {
    activatedBy: controllerId as any,
    sourcePermanentId: permanentId,
    stackItemId,
    targetIds,
  });

  persistTargetedTriggeredStackItems(gameId, game, targetedTriggers);
}

export function battlefieldAbilityStackReplayEvidence(stackItemId: string | undefined): {
  stackItemId?: string;
  usesStack: true;
} {
  const id = String(stackItemId || '').trim();
  return id ? { stackItemId: id, usesStack: true } : { usesStack: true };
}

export function matchesGraveyardCardTargetType(card: any, targetType: string): boolean {
  return matchesSharedGraveyardCardTargetType(card, targetType);
}

export function activatedAbilityPermanentTargetMatches(
  perm: any,
  rawTargetType: string,
  controllerId: string,
  targetReqs: ReturnType<typeof parseTargetRequirements>
): boolean {
  if (!perm?.id || !perm?.card) return false;

  const typeLine = String(perm?.card?.type_line || '').toLowerCase();
  const targetType = String(rawTargetType || '').trim().toLowerCase();
  const controllerConstraint = String((targetReqs as any).targetControllerConstraint || 'any').toLowerCase();

  if ((controllerConstraint === 'you' || controllerConstraint === 'controller') && String(perm.controller || '') !== String(controllerId || '')) {
    return false;
  }
  if ((controllerConstraint === 'opponent' || controllerConstraint === 'that_player') && String(perm.controller || '') === String(controllerId || '')) {
    return false;
  }

  if (Array.isArray((targetReqs as any).targetFilterExcludeTypes)
    && (targetReqs as any).targetFilterExcludeTypes.some((type: any) => typeLine.includes(String(type || '').toLowerCase()))) {
    return false;
  }
  if (Array.isArray((targetReqs as any).targetFilterRequiredTypeWords)
    && !matchesRequiredTypeWords(typeLine, (targetReqs as any).targetFilterRequiredTypeWords)) {
    return false;
  }

  if (typeof (targetReqs as any).targetFilterExactManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterExactManaValue)) {
    if (cardManaValue(perm.card) !== Number((targetReqs as any).targetFilterExactManaValue)) return false;
  }
  if (typeof (targetReqs as any).targetFilterMinManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMinManaValue)) {
    if (cardManaValue(perm.card) < Number((targetReqs as any).targetFilterMinManaValue)) return false;
  }
  if (typeof (targetReqs as any).targetFilterMaxManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMaxManaValue)) {
    if (cardManaValue(perm.card) > Number((targetReqs as any).targetFilterMaxManaValue)) return false;
  }

  if (targetType === 'any') return typeLine.includes('creature') || typeLine.includes('planeswalker');
  if (targetType === 'permanent') return true;
  if (targetType === 'nonland' || targetType === 'nonland permanent') return !typeLine.includes('land');
  if (targetType === 'noncreature permanent') return !typeLine.includes('creature');
  if (targetType === 'creature') return typeLine.includes('creature');
  if (targetType === 'artifact') return typeLine.includes('artifact');
  if (targetType === 'enchantment') return typeLine.includes('enchantment');
  if (targetType === 'land') return typeLine.includes('land');
  if (targetType === 'planeswalker') return typeLine.includes('planeswalker');
  if (targetType === 'battle') return typeLine.includes('battle');

  return targetType.length > 0 && typeLine.includes(targetType);
}

export function buildActivatedAbilityValidTargets(
  game: any,
  controllerId: string,
  targetReqs: ReturnType<typeof parseTargetRequirements>
): Array<{ id: string; name: string; type: string; controller?: string; zoneOwnerId?: string; imageUrl?: string; life?: number; isOpponent?: boolean }> {
  const validTargets: Array<{ id: string; name: string; type: string; controller?: string; zoneOwnerId?: string; imageUrl?: string; life?: number; isOpponent?: boolean }> = [];
  const stateBattlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const statePlayers = Array.isArray(game.state?.players) ? game.state.players : [];
  const stateZones = game.state?.zones || {};
  const lifeDict = game.state?.life || {};
  const startingLife = game.state?.startingLife || 40;

  for (const rawTargetType of targetReqs.targetTypes || []) {
    const targetType = String(rawTargetType || '').toLowerCase();
    switch (targetType) {
      case 'creature':
        validTargets.push(...stateBattlefield
          .filter((perm: any) => activatedAbilityPermanentTargetMatches(perm, targetType, controllerId, targetReqs))
          .map((perm: any) => ({
            id: String(perm.id),
            name: perm.card?.name || 'Creature',
            type: 'permanent',
            controller: perm.controller,
            typeLine: perm.card?.type_line || '',
            tapped: perm?.tapped === true,
            imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          })));
        break;
      case 'permanent':
      case 'nonland':
      case 'nonland permanent':
      case 'noncreature permanent':
        validTargets.push(...stateBattlefield
          .filter((perm: any) => activatedAbilityPermanentTargetMatches(perm, targetType, controllerId, targetReqs))
          .map((perm: any) => ({
            id: String(perm.id),
            name: perm.card?.name || 'Permanent',
            type: 'permanent',
            controller: perm.controller,
            imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          })));
        break;
      case 'artifact':
      case 'enchantment':
      case 'planeswalker':
      case 'land':
      case 'battle':
        validTargets.push(...stateBattlefield
          .filter((perm: any) => activatedAbilityPermanentTargetMatches(perm, targetType, controllerId, targetReqs))
          .map((perm: any) => ({
            id: String(perm.id),
            name: perm.card?.name || 'Permanent',
            type: 'permanent',
            controller: perm.controller,
            imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          })));
        break;
      case 'player':
      case 'opponent':
        validTargets.push(...statePlayers
          .filter((player: any) => {
            if (!player?.id) return false;
            return targetType === 'opponent' ? String(player.id) !== controllerId : true;
          })
          .map((player: any) => ({
            id: String(player.id),
            name: player.name || String(player.id),
            type: 'player',
            life: lifeDict[player.id] ?? player.life ?? startingLife,
            isOpponent: String(player.id) !== controllerId,
          })));
        break;
      case 'any':
        validTargets.push(...stateBattlefield
          .filter((perm: any) => activatedAbilityPermanentTargetMatches(perm, targetType, controllerId, targetReqs))
          .map((perm: any) => ({
            id: String(perm.id),
            name: perm.card?.name || 'Permanent',
            type: 'permanent',
            controller: perm.controller,
            imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          })));
        validTargets.push(...statePlayers
          .filter((player: any) => player?.id)
          .map((player: any) => ({
            id: String(player.id),
            name: player.name || String(player.id),
            type: 'player',
            life: lifeDict[player.id] ?? player.life ?? startingLife,
            isOpponent: String(player.id) !== controllerId,
          })));
        break;
      default: {
        if (!targetType.startsWith('graveyard_')) {
          break;
        }
        const graveyardOwnerIds = (targetReqs.graveyardScope === 'any'
          ? statePlayers.filter((player: any) => player?.id).map((player: any) => String(player.id))
          : [controllerId]) as string[];
        for (const ownerId of graveyardOwnerIds) {
          const playerZones = stateZones?.[ownerId] || {};
          const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
          validTargets.push(...graveyard
            .filter((card: any) => {
              if (!matchesGraveyardCardTargetType(card, targetType)) {
                return false;
              }
              if (typeof (targetReqs as any).targetFilterExactManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterExactManaValue)) {
                if (cardManaValue(card) !== Number((targetReqs as any).targetFilterExactManaValue)) {
                  return false;
                }
              }
              if (typeof (targetReqs as any).targetFilterMinManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMinManaValue)) {
                if (cardManaValue(card) < Number((targetReqs as any).targetFilterMinManaValue)) {
                  return false;
                }
              }
              if (typeof (targetReqs as any).targetFilterMaxManaValue === 'number' && Number.isFinite((targetReqs as any).targetFilterMaxManaValue)) {
                if (cardManaValue(card) > Number((targetReqs as any).targetFilterMaxManaValue)) {
                  return false;
                }
              }
              if (typeof (targetReqs as any).targetTotalPowerLimit === 'number' && Number.isFinite((targetReqs as any).targetTotalPowerLimit)) {
                const typeLine = String(card?.type_line || '').toLowerCase();
                const cardPower = typeLine.includes('creature') ? parsePT(card?.power) : 0;
                if (cardPower > Number((targetReqs as any).targetTotalPowerLimit)) {
                  return false;
                }
              }
              return true;
            })
            .map((card: any) => ({
              id: String(card.id),
              name: card.name || 'Card',
              type: 'graveyard_card',
              controller: ownerId,
              zoneOwnerId: ownerId,
              imageUrl: card.image_uris?.small || card.image_uris?.normal,
            })));
        }
        break;
      }
    }
  }

  return validTargets.filter((target, index, all) => all.findIndex((candidate) => candidate.id === target.id) === index);
}

export function getSelectedGraveyardCardsForStep(
  game: any,
  stepData: any,
  selectedCardIds: string[]
): Array<{ ownerId: string; card: any }> {
  const zones = (((game.state as any)?.zones || {}) as Record<string, any>);
  const validTargets: any[] = Array.isArray(stepData?.validTargets) ? stepData.validTargets : [];
  const validTargetById = new Map<string, any>(
    validTargets
      .map((target: any): [string, any] => [String(target?.id || ''), target])
      .filter(([id]) => Boolean(id))
  );
  const defaultTargetPlayerId = String(stepData?.targetPlayerId || '').trim();

  return selectedCardIds
    .map((selectedCardId) => {
      const cardId = String(selectedCardId || '').trim();
      if (!cardId) {
        return null;
      }

      const targetInfo = validTargetById.get(cardId);
      const explicitOwnerId = String(targetInfo?.zoneOwnerId || targetInfo?.controller || '').trim();
      const ownersToCheck = explicitOwnerId
        ? [explicitOwnerId]
        : defaultTargetPlayerId
          ? [defaultTargetPlayerId, ...Object.keys(zones).filter((playerId) => playerId !== defaultTargetPlayerId)]
          : Object.keys(zones);

      for (const ownerId of ownersToCheck) {
        const graveyard = Array.isArray(zones[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
        const card = graveyard.find((entry: any) => entry && String(entry.id) === cardId);
        if (card) {
          return { ownerId, card };
        }
      }

      return null;
    })
    .filter(Boolean) as Array<{ ownerId: string; card: any }>;
}
