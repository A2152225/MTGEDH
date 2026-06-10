import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import type { ChoiceOption } from '../../../../rules-engine/src/choiceEvents.js';
import { getCounterLeaveBattlefieldReplacement } from './counter-common-effects.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import {
  buildTriggerSourcePermanentSnapshot,
  getTriggerSourcePermanent,
} from './triggerSourceUtils.js';

export function tryDeferTriggeredAbilitySpecialPrompts(
  ctx: GameContext,
  item: any,
  state: any,
  options: {
    triggerController: PlayerID;
    sourceName: string;
    sourceId: string;
    description: string;
    triggerType?: string;
  },
): boolean {
  const triggerType = options.triggerType;
  const triggerController = options.triggerController;
  const sourceName = options.sourceName;
  const sourceId = options.sourceId;
  const description = options.description;

  if (triggerType === 'etb_bounce_land') {
    const permanentId = (item as any).permanentId;
    const battlefield = state.battlefield || [];
    const bounceLandPerm = battlefield.find((p: any) => p.id === permanentId);

    if (bounceLandPerm) {
      const availableLands = battlefield.filter((p: any) => {
        if (p.controller !== triggerController) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        return typeLine.includes('land');
      });

      if (availableLands.length > 0) {
        const isReplaying = !!(ctx as any).isReplaying;
        if (isReplaying) {
          debug(2, `[resolveTopOfStack] Bounce land trigger: skipping resolution step during replay`);
          return true;
        }

        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
          playerId: triggerController as PlayerID,
          description: `${sourceName}: Return a land you control to its owner's hand`,
          mandatory: true,
          sourceId: bounceLandPerm.id,
          sourceName: sourceName,
          sourceImage: bounceLandPerm.card?.image_uris?.small || bounceLandPerm.card?.image_uris?.normal,
          returnControlledPermanentChoice: true,
          returnControlledPermanentSourceName: sourceName,
          returnControlledPermanentDestination: 'hand',
          returnControlledPermanentOptions: availableLands.map((permanent: any) => ({
            permanentId: permanent.id,
            cardName: permanent.card?.name || 'Land',
            imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
            ...(getCounterLeaveBattlefieldReplacement(permanent, 'hand') === 'exile'
              ? {
                  leaveBattlefieldReplacementDestination: 'exile' as const,
                  ...((permanent as any).leaveBattlefieldReplacementSourceName || (permanent.card as any)?.leaveBattlefieldReplacementSourceName
                    ? { leaveBattlefieldReplacementSourceName: String((permanent as any).leaveBattlefieldReplacementSourceName || (permanent.card as any)?.leaveBattlefieldReplacementSourceName) }
                    : {}),
                  ...(Number((permanent as any).leaveBattlefieldReplacementLifeGain || (permanent.card as any)?.leaveBattlefieldReplacementLifeGain || 0) > 0
                    ? { leaveBattlefieldReplacementLifeGain: Number((permanent as any).leaveBattlefieldReplacementLifeGain || (permanent.card as any)?.leaveBattlefieldReplacementLifeGain || 0) }
                    : {}),
                }
              : {}),
          })),
          stackItemId: item.id,
        } as any);

        debug(2, `[resolveTopOfStack] Bounce land trigger: added resolution step for ${triggerController} to return a land`);
        return true;
      }

      debugWarn(2, `[resolveTopOfStack] Bounce land trigger: ${triggerController} has no lands to return (shouldn't happen)`);
    } else {
      debugWarn(2, `[resolveTopOfStack] Bounce land trigger: permanent ${permanentId} not found on battlefield`);
    }
  }

  if (triggerType === 'hideaway_etb') {
    const permanentId = (item as any).permanentId;
    const hideawayCount = (item as any).hideawayCount || 4;
    const hideawayCondition = (item as any).hideawayCondition || 'unknown';
    const battlefield = state.battlefield || [];
    const hideawayPerm = battlefield.find((p: any) => p.id === permanentId);

    if (hideawayPerm) {
      const isReplaying = !!(ctx as any).isReplaying;
      if (isReplaying) {
        debug(2, `[resolveTopOfStack] Hideaway trigger: skipping resolution step during replay`);
        return true;
      }

      const lib = (ctx as any).libraries?.get(triggerController);
      if (!lib || lib.length === 0) {
        debugWarn(2, `[resolveTopOfStack] Hideaway: ${triggerController} has no library`);
        return true;
      }

      const cardsToLookAt = Math.min(hideawayCount, lib.length);
      const topCards = lib.slice(0, cardsToLookAt);

      if (topCards.length === 0) {
        debugWarn(2, `[resolveTopOfStack] Hideaway: no cards to look at`);
        return true;
      }

      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.HIDEAWAY_CHOICE,
        playerId: triggerController as PlayerID,
        description: `${sourceName}: Choose a card to exile face down (Hideaway)`,
        mandatory: true,
        sourceId: hideawayPerm.id,
        sourceName: sourceName,
        sourceImage: hideawayPerm.card?.image_uris?.small || hideawayPerm.card?.image_uris?.normal,
        hideawayCards: topCards.map((c: any) => ({
          cardId: c.id,
          cardName: c.name || 'Card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
        })),
        hideawayCondition: hideawayCondition,
        permanentId: permanentId,
        stackItemId: item.id,
      } as any);

      debug(2, `[resolveTopOfStack] Hideaway trigger: added resolution step for ${triggerController} to choose from ${topCards.length} cards`);
      return true;
    }

    debugWarn(2, `[resolveTopOfStack] Hideaway trigger: permanent ${permanentId} not found on battlefield`);
  }

  if (triggerType === 'begin_combat') {
    const effectText = description || (item as any).effect || '';
    const lowerEffect = effectText.toLowerCase();

    if (lowerEffect.includes('target creature you control') ||
        lowerEffect.includes('target creature')) {
      const isReplaying = !!(ctx as any).isReplaying;
      const battlefield = state.battlefield || [];

      if (!isReplaying) {
        const validTargets = battlefield
          .filter((p: any) => {
            const tl = (p.card?.type_line || '').toLowerCase();
            const isCreature = tl.includes('creature');
            const controlledOnly = lowerEffect.includes('you control');
            return isCreature && (!controlledOnly || p.controller === triggerController);
          })
          .map((p: any) => ({
            id: p.id,
            label: p.card?.name || 'Creature',
            description: p.card?.type_line,
            image: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));

        if (validTargets.length > 0) {
          const effectDescription = effectText;

          queueResolveTopOfStackPrompt(ctx, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: triggerController as PlayerID,
            description: `${sourceName}: Choose target creature`,
            mandatory: true,
            sourceId,
            sourceName,
            validTargets,
            targetTypes: ['creature'],
            minTargets: 1,
            maxTargets: 1,
            action: 'begin_combat_target_buff',
            effectDescription,
          } as any);

          debug(2, `[resolveTopOfStack] Begin combat trigger ${sourceName} requires target creature selection`);
          return true;
        }
      }
    }
  }

  const requiresChoice = (item as any).requiresChoice;

  if (requiresChoice && String((item as any).type || '') === 'triggered_ability') {
    const oracleText = (item as any).effect || description || '';
    const lowerText = oracleText.toLowerCase();
    const modalOptionsFromItem = Array.isArray((item as any).modalOptions)
      ? ((item as any).modalOptions as any[])
          .map((option) => String(option || '').trim())
          .filter(Boolean)
      : [];

    const isSoldierProgram =
      triggerType === 'begin_combat'
      && sourceName.toLowerCase().includes('soldier military program');
    const isGenericChooseOneTrigger = !isSoldierProgram && (modalOptionsFromItem.length > 0 || lowerText.includes('choose one'));

    if (isSoldierProgram || isGenericChooseOneTrigger) {
      const isReplaying = (ctx as any).isReplaying;
      if (isReplaying) {
        debug(2, `[resolveTopOfStack] Modal trigger: skipping resolution step during replay`);
        return true;
      }

      const battlefield = state.battlefield || [];
      const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
      const modalSourceId = String(
        (item as any).permanentId
        || (item as any).source
        || (item as any).sourceId
        || sourcePermanentSnapshot?.id
        || '',
      ).trim();

      let canChooseBoth = false;
      if (isSoldierProgram) {
        const commandZone = (state as any).commandZone?.[triggerController];
        const commanderIds = commandZone?.commanderIds || [];

        canChooseBoth = battlefield.some((p: any) =>
          p.controller === triggerController && commanderIds.includes(p.card?.id),
        );

        debug(2, `[resolveTopOfStack] SOLDIER Military Program: player ${canChooseBoth ? 'controls' : 'does not control'} a commander`);
      }

      const modalOptions: ChoiceOption[] = [];

      if (isSoldierProgram) {
        modalOptions.push({
          id: 'create_token',
          label: 'Create a 1/1 white Soldier creature token',
          description: 'Create a 1/1 white Soldier creature token.',
        });

        modalOptions.push({
          id: 'add_counters',
          label: 'Put a +1/+1 counter on each of up to two Soldiers',
          description: 'Put a +1/+1 counter on each of up to two Soldiers you control.',
        });

        if (canChooseBoth) {
          modalOptions.push({
            id: 'both',
            label: 'Choose both (you control a commander)',
            description: 'Create a 1/1 white Soldier creature token AND put a +1/+1 counter on each of up to two Soldiers you control.',
          });
        }
      } else {
        const optionTexts: string[] = modalOptionsFromItem.length > 0
          ? modalOptionsFromItem
          : Array.from(new Set(
              (oracleText.match(/â€¢\s*([^â€¢]+)/g) || [])
                .map((match) => match.replace(/^â€¢\s*/, '').trim())
                .filter(Boolean),
            ));

        optionTexts.forEach((optionText, index) => {
          modalOptions.push({
            id: `option_${index + 1}`,
            label: optionText,
            description: optionText,
          });
        });
      }

      if (modalOptions.length > 0) {
        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.MODAL_CHOICE,
          playerId: triggerController as PlayerID,
          description: `${sourceName}: ${canChooseBoth ? 'Choose one or both' : 'Choose one'}`,
          mandatory: true,
          ...(modalSourceId ? { sourceId: modalSourceId } : null),
          sourceName: sourceName,
          sourceImage: (item as any).imageUrl,
          promptTitle: sourceName,
          promptDescription: oracleText,
          options: modalOptions,
          minSelections: 1,
          maxSelections: canChooseBoth ? 2 : 1,
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          triggerData: {
            triggerType,
            sourceName,
            ...(modalSourceId ? { sourceId: modalSourceId } : null),
            isSoldierProgram,
            canChooseBoth,
            modalTrigger: !isSoldierProgram,
            controllerId: triggerController,
            mandatory: (item as any).mandatory !== false,
          },
        } as any);

        debug(2, `[resolveTopOfStack] Modal trigger ${sourceName}: added resolution step for ${triggerController} to choose from ${modalOptions.length} options`);
        return true;
      }
    }
  }

  if (sourceName.toLowerCase().includes('aura shards') ||
      description.toLowerCase().includes('destroy target artifact or enchantment')) {
    const battlefield = state.battlefield || [];
    const isReplaying = !!(ctx as any).isReplaying;
    if (!isReplaying) {
      const validTargets = battlefield
        .filter((p: any) => {
          const tl = (p.card?.type_line || '').toLowerCase();
          return tl.includes('artifact') || tl.includes('enchantment');
        })
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Permanent',
          description: p.card?.type_line,
          image: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));
      if (validTargets.length > 0) {
        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: triggerController as PlayerID,
          description: `${sourceName}: You may destroy target artifact or enchantment`,
          mandatory: false,
          sourceId,
          sourceName,
          validTargets,
          targetTypes: ['artifact', 'enchantment'],
          minTargets: 0,
          maxTargets: 1,
          action: 'destroy_artifact_enchantment',
        } as any);
        return true;
      }
    }
  }

  if (description.toLowerCase().includes('tap or untap target permanent')) {
    const battlefield = state.battlefield || [];
    const isReplaying = !!(ctx as any).isReplaying;
    if (!isReplaying) {
      const validTargets = battlefield.map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Permanent',
        description: p.card?.type_line,
        image: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));
      if (validTargets.length > 0) {
        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: triggerController as PlayerID,
          description: `${sourceName}: Tap or untap target permanent`,
          mandatory: true,
          sourceId,
          sourceName,
          validTargets,
          targetTypes: ['permanent'],
          minTargets: 1,
          maxTargets: 1,
          action: 'tap_or_untap_target',
        } as any);
        return true;
      }
    }
  }

  return false;
}
