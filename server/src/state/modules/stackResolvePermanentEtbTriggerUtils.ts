import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { getETBTriggersForPermanent } from './triggered-abilities.js';
import { isFaceUpTriggerType } from './triggerEmissionFamilyUtils.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { buildInterveningIfSubjectSnapshot } from './triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
import {
  matchesRequiredTypePhrase,
  persistTriggeredAbilityPush,
  shouldQueueChosenTypeCreatureEtbTrigger,
  triggerETBEffectsForToken,
} from './triggerEtbEntryEffects.js';
import {
  queueGraveyardResidentCreatureEntryTriggers,
  queueSupportedETBKeywordChoices,
} from './triggerEtbPermanentEffects.js';

export function matchesColorRestriction(restriction: string, cardColors: string[]): boolean {
  const lowerRestriction = restriction.toLowerCase();
  const colors = cardColors || [];

  if (lowerRestriction.startsWith('non')) {
    const excludedColor = lowerRestriction.slice(3);
    const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const excludedColorCode = colorMap[excludedColor];
    return excludedColorCode ? !colors.includes(excludedColorCode) : true;
  }

  let matchesColor = false;
  if (lowerRestriction.includes('white') && (colors.includes('W') || colors.includes('white'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('black') && (colors.includes('B') || colors.includes('black'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('blue') && (colors.includes('U') || colors.includes('blue'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('red') && (colors.includes('R') || colors.includes('red'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('green') && (colors.includes('G') || colors.includes('green'))) {
    matchesColor = true;
  }

  return matchesColor;
}

export function queuePermanentEntersBattlefieldTriggerStackItems(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    newPermanent: any;
    newPermId: string;
    isCreature: boolean;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const newPermanent = options.newPermanent;
  const newPermId = options.newPermId;
  const isCreature = options.isCreature;

  queueSupportedETBKeywordChoices(ctx, newPermanent, controller);

  try {
    const allTriggers = getETBTriggersForPermanent(effectiveCard, newPermanent);

    const selfETBTriggerTypes = new Set([
      'etb',
      'self_enters_or_attacks',
      'etb_modal_choice',
      'job_select',
      'living_weapon',
      'etb_sacrifice_unless_pay',
      'etb_bounce_land',
      'etb_gain_life',
      'etb_draw',
      'etb_search',
      'etb_create_token',
      'etb_counter',
    ]);

    const etbTriggers = allTriggers.filter((trigger) => {
      if (isFaceUpTriggerType(trigger.triggerType)) {
        return false;
      }
      if (selfETBTriggerTypes.has(trigger.triggerType)) {
        return true;
      }
      if (trigger.triggerType === 'permanent_etb' ||
          trigger.triggerType === 'creature_etb' ||
          trigger.triggerType === 'chosen_type_creature_etb' ||
          trigger.triggerType === 'chosen_type_creature_etb_or_attack' ||
          trigger.triggerType === 'another_permanent_etb') {
        return false;
      }
      return true;
    });

    const isToken = !!(newPermanent as any).isToken || !!(card as any).isToken;

    for (const perm of state.battlefield) {
      if (perm.id === newPermId) continue;
      const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
      for (const trigger of otherTriggers) {
        if (trigger.triggerType === 'creature_etb' && isCreature) {
          if ((trigger as any).nontokenOnly && isToken) {
            continue;
          }
          if ((trigger as any).tokenOnly && !isToken) {
            continue;
          }
          if ((trigger as any).controlledOnly) {
            const triggerController = perm.controller || controller;
            if (controller !== triggerController) {
              continue;
            }
          }
          const requiredTypeRaw = typeof (trigger as any).requiredTypePhrase === 'string'
            ? String((trigger as any).requiredTypePhrase)
            : '';
          const requiredType = requiredTypeRaw.replace(/\bcreatures\b/gi, 'creature').replace(/\bartifacts\b/gi, 'artifact').trim();
          if (requiredType) {
            const enteringTypeLine = String(card?.type_line || '');
            if (!matchesRequiredTypePhrase(enteringTypeLine, requiredType, isToken)) {
              continue;
            }
          }
          etbTriggers.push({ ...trigger, permanentId: perm.id });
        } else if (
          (trigger.triggerType === 'chosen_type_creature_etb_or_attack'
            || trigger.triggerType === 'chosen_type_creature_etb')
          && isCreature
        ) {
          if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, newPermanent, controller, isToken, isCreature)) {
            continue;
          }
          etbTriggers.push({ ...trigger, permanentId: perm.id });
        } else if (trigger.triggerType === 'another_permanent_etb') {
          const triggerController = perm.controller;
          if (triggerController !== controller) {
            continue;
          }
          if ((trigger as any).colorRestriction) {
            if (!matchesColorRestriction((trigger as any).colorRestriction, (card as any).colors || [])) {
              continue;
            }
          }
          if ((trigger as any).creatureOnly && !isCreature) {
            continue;
          }
          etbTriggers.push({ ...trigger, permanentId: perm.id });
        } else if (trigger.triggerType === 'permanent_etb') {
          if ((trigger as any).colorRestriction) {
            if (!matchesColorRestriction((trigger as any).colorRestriction, (card as any).colors || [])) {
              continue;
            }
          }
          etbTriggers.push({ ...trigger, permanentId: perm.id });
        } else if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
          const triggerController = perm.controller;
          if (triggerController && triggerController !== controller) {
            etbTriggers.push({ ...trigger, permanentId: perm.id, targetPlayer: controller } as any);
          }
        }
      }
    }

    queueGraveyardResidentCreatureEntryTriggers(ctx, newPermanent, controller, isCreature);

    if (etbTriggers.length > 0) {
      debug(2, `[resolveTopOfStack] Found ${etbTriggers.length} ETB trigger(s) for ${effectiveCard.name || 'permanent'}`);
      const pendingEtbStackItems: any[] = [];

      for (const trigger of etbTriggers) {
        if (trigger.triggerType === 'job_select' || trigger.triggerType === 'living_weapon') {
          const tokenInfo = (trigger as any).tokenInfo;
          if (tokenInfo) {
            const tokenId = uid('token');
            const tokenCard = {
              id: `card_${tokenId}`,
              name: tokenInfo.name || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ'),
              type_line: `Token Creature — ${tokenInfo.subtypes?.join(' ') || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ')}`,
              colors: tokenInfo.colors || [],
              isToken: true,
            };

            const tokenPermanent = {
              id: tokenId,
              controller,
              owner: controller,
              tapped: false,
              counters: {},
              basePower: tokenInfo.power ?? (trigger.triggerType === 'job_select' ? 1 : 0),
              baseToughness: tokenInfo.toughness ?? (trigger.triggerType === 'job_select' ? 1 : 0),
              summoningSickness: true,
              isToken: true,
              card: { ...tokenCard, zone: 'battlefield' },
            } as any;

            state.battlefield.push(tokenPermanent);

            const equipment = state.battlefield.find((p: any) => p.id === newPermId);
            const isEquipment = equipment && (equipment.card?.type_line || '').toLowerCase().includes('equipment');
            if (equipment && isEquipment) {
              (equipment as any).attachedTo = tokenId;
              (tokenPermanent as any).attachedEquipment = (tokenPermanent as any).attachedEquipment || [];
              (tokenPermanent as any).attachedEquipment.push(newPermId);

              debug(2, `[resolveTopOfStack] ${trigger.triggerType === 'job_select' ? 'Job Select' : 'Living Weapon'}: Created ${tokenCard.name} token and attached ${card.name}`);
            }

            triggerETBEffectsForToken(ctx, tokenPermanent, controller);
          }
          continue;
        }

        state.stack = state.stack || [];
        const triggerId = uid('trigger');

        let triggerController = controller;
        if (trigger.permanentId && trigger.permanentId !== newPermId) {
          const triggerSource = state.battlefield?.find((p: any) => p.id === trigger.permanentId);
          if (triggerSource?.controller) {
            triggerController = triggerSource.controller;
          }
        }

        try {
          const raw = String((trigger as any)?.description || '').trim();
          let desc = raw;
          if (desc && !/^(?:when|whenever|at)\b/i.test(desc)) {
            if (trigger.triggerType === 'creature_etb') {
              desc = `Whenever a creature enters the battlefield, ${desc}`;
            } else if (trigger.triggerType === 'another_permanent_etb') {
              desc = `Whenever another permanent enters the battlefield under your control, ${desc}`;
            } else if (trigger.triggerType === 'permanent_etb') {
              desc = `Whenever a permanent enters the battlefield, ${desc}`;
            } else if (trigger.triggerType === 'opponent_creature_etb') {
              desc = `Whenever a creature enters the battlefield under an opponent's control, ${desc}`;
            } else {
              desc = `When ~ enters the battlefield, ${desc}`;
            }
          }
          const battlefield = (ctx as any).state?.battlefield || [];
          const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
          const sourcePermanentForInterveningIf = trigger.permanentId && trigger.permanentId !== newPermId
            ? newPermanent
            : sourcePerm;
          const enteringControllerId = String(controller || '').trim();
          const needsThatPlayerRef = /\bthat player\b/i.test(desc);
          const refs =
            trigger.triggerType === 'opponent_creature_etb' && enteringControllerId && needsThatPlayerRef
              ? {
                  thatPlayerId: enteringControllerId,
                  referencedPlayerId: enteringControllerId,
                  theirPlayerId: enteringControllerId,
                }
              : undefined;
          const satisfied = isInterveningIfSatisfied(ctx as any, String(triggerController), desc, sourcePermanentForInterveningIf, refs);
          if (satisfied === false) {
            debug(2, `[resolveTopOfStack] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // If evaluation fails, be conservative and keep the trigger.
        }

        const triggerEffectText = String((trigger as any).effect || trigger.description || '');
        const enrichedMetadata = (
          (trigger as any).requiresTarget === true
          || /\btarget\b/i.test(triggerEffectText)
          || String((trigger as any).targetZone || '').trim().length > 0
        )
          ? inferTriggeredAbilityTargetMetadata(triggerEffectText, {
              gameState: (ctx as any).state,
              controllerId: String(triggerController),
              sourceName: String(trigger.cardName || newPermanent?.card?.name || ''),
              sourcePermanent: newPermanent,
            } as any)
          : ({} as ReturnType<typeof inferTriggeredAbilityTargetMetadata>);
        const effectiveRequiresTarget = (trigger as any).requiresTarget === true
          || Boolean(enrichedMetadata.targetZone)
          || Boolean(enrichedMetadata.targetType);

        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: trigger.permanentId,
          sourceName: trigger.cardName,
          description: trigger.description,
          effect: (trigger as any).effect || trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          requiresTarget: effectiveRequiresTarget,
          targetType: enrichedMetadata.targetType || (trigger as any).targetType,
          targetConstraint: enrichedMetadata.targetConstraint || (trigger as any).targetConstraint,
          needsTargetSelection: effectiveRequiresTarget,
          ...(enrichedMetadata.targetZone ? { targetZone: enrichedMetadata.targetZone } : null),
          ...(enrichedMetadata.targetDestination ? { targetDestination: enrichedMetadata.targetDestination } : null),
          ...(enrichedMetadata.targetGraveyardScope ? { targetGraveyardScope: enrichedMetadata.targetGraveyardScope } : null),
          ...(enrichedMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
          ...(enrichedMetadata.battlefieldControllerMode ? { battlefieldControllerMode: enrichedMetadata.battlefieldControllerMode } : null),
          ...(enrichedMetadata.battlefieldCounters ? { battlefieldCounters: enrichedMetadata.battlefieldCounters } : null),
          ...(enrichedMetadata.targetAction ? { targetAction: enrichedMetadata.targetAction } : null),
          ...(Array.isArray(enrichedMetadata.targetFilterTypes) ? { targetFilterTypes: enrichedMetadata.targetFilterTypes } : null),
          ...(Array.isArray(enrichedMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: enrichedMetadata.targetFilterRequiredTypeWords } : null),
          ...(Array.isArray(enrichedMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: enrichedMetadata.targetFilterExcludeTypes } : null),
          ...(enrichedMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
          ...(typeof enrichedMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: enrichedMetadata.targetFilterExactManaValue } : null),
          ...(typeof enrichedMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: enrichedMetadata.targetFilterMinManaValue } : null),
          ...(typeof enrichedMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: enrichedMetadata.targetFilterMaxManaValue } : null),
          ...(typeof enrichedMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: enrichedMetadata.targetTotalPowerLimit } : null),
          ...(enrichedMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
          ...(enrichedMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
          ...(typeof enrichedMetadata.minTargets === 'number' ? { minTargets: enrichedMetadata.minTargets } : null),
          ...(typeof enrichedMetadata.maxTargets === 'number' ? { maxTargets: enrichedMetadata.maxTargets } : null),
          interveningIfSubjectPermanentId: newPermanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(newPermanent),
        } as any;

        pendingEtbStackItems.push(stackItem);
      }

      const orderedEtbStackItems = orderTriggersByAPNAP(
        ctx as any,
        pendingEtbStackItems.map((stackItem, originalIndex) => ({
          controllerId: String(stackItem?.controller || ''),
          originalIndex,
          stackItem,
        })),
      ).map((entry: any) => entry.stackItem);

      for (const stackItem of orderedEtbStackItems) {
        state.stack.push(stackItem);
        persistTriggeredAbilityPush(ctx, stackItem);
        debug(2, `[resolveTopOfStack] ⚡ ${stackItem.sourceName}'s triggered ability (controlled by ${stackItem.controller}): ${stackItem.description}`);
      }
    }
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] Failed to detect ETB triggers:', err);
  }
}
