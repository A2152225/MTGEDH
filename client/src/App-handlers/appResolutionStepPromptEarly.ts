// Origin parent: client/src/App.tsx
// Cluster moved: resolutionStepPrompt early branches (discard_selection through bounce land).
// Public entry symbols: handleAppResolutionStepPromptEarly.
// Leaf must not import App.tsx or App-handlers/index.ts.

import type { KnownCardRef, PaymentCostAdjustment } from "../../../shared/src";
import { buildOptionalEffectKey } from "../../../shared/src/optionalEffectKey";
import type { GraveyardCard } from "../components/GraveyardSelectionModal";
import type { KynaiosChoiceRequest } from "../components/KynaiosChoiceModal";
import type { OpponentMayPayPrompt } from "../components/OpponentMayPayModal";
import type { OptionChoiceRequest } from "../components/OptionChoiceModal";
import type { TargetOption } from "../components/TargetSelectionModal";
import type { TwoPileSplitRequest } from "../components/TwoPileSplitModal";
import { debug } from "../utils/debug";
import {
  buildGenericOptionChoiceRequestFromStep,
  buildPendingSpellXSelectionFromStep,
  isGenericNumberChoiceStep,
  isGenericOptionChoiceFallbackStep,
  isNamedGenericOptionChoiceStep,
  readResolutionPromptCause,
} from "../utils/resolutionChoicePrimitives";
import { isResolutionStepMandatory } from "../utils/resolutionStepUtils";

export function handleAppResolutionStepPromptEarly(
  step: any,
  payload: { gameId: string; step: any },
  p: Record<string, any>,
) {
  const {
    discardCount,
    mulliganBottomLastSubmittedStepId,
    openConfirmFromResolutionStep,
    safeView,
    safeViewRef,
    setAnyColorManaModalData,
    setAnyColorManaModalOpen,
    setCastSpellModalOpen,
    setCounterDistributionModalData,
    setCounterDistributionModalOpen,
    setCounterMovementModalData,
    setCounterMovementModalOpen,
    setDiscardAnyNumber,
    setDiscardCount,
    setDiscardCurrentHandSize,
    setDiscardMaxCount,
    setDiscardMaxHandSize,
    setDiscardMinCount,
    setDiscardModalOpen,
    setDiscardResolutionDescription,
    setDiscardResolutionHand,
    setDiscardResolutionReason,
    setDiscardResolutionStepId,
    setDiscardResolutionTitle,
    setFightTargetModalData,
    setFightTargetModalOpen,
    setGraveyardSelectionModalData,
    setGraveyardSelectionModalOpen,
    setKynaiosChoiceModalOpen,
    setKynaiosChoiceRequest,
    setLifePaymentModalData,
    setLifePaymentModalOpen,
    setManaDistributionModalData,
    setManaDistributionModalOpen,
    setMayAbilityModalData,
    setMayAbilityModalOpen,
    setMulliganBottomCount,
    setMulliganBottomModalOpen,
    setMulliganBottomStepId,
    setMutateModalData,
    setMutateModalOpen,
    setOpponentMayPayPrompt,
    setOpponentMayPayStepId,
    setOptionChoiceModalOpen,
    setOptionChoiceRequest,
    setPendingSpellXSelection,
    setPhyrexianManaModalData,
    setPhyrexianManaModalOpen,
    setReturnControlledPermanentData,
    setReturnControlledPermanentModalOpen,
    setSpellToCast,
    setStationCreatureSelectionData,
    setStationCreatureSelectionOpen,
    setTapUntapTargetModalData,
    setTapUntapTargetModalOpen,
    setTargetModalData,
    setTargetModalOpen,
    setTwoPileSplitModalOpen,
    setTwoPileSplitRequest,
    you,
  } = p;
      // Handle Discard Selection resolution step (cleanup discard and discard effects)
      if (step.type === 'discard_selection') {
        if (you && step.playerId && String(step.playerId) !== String(you)) {
          return;
        }
        const anyNumberDiscard = (step as any).anyNumberDiscard === true;
        const discardCount = Number(step.discardCount || 0);
        if (anyNumberDiscard || discardCount > 0) {
          // Treat anything other than explicit cleanup as an effect-style prompt.
          // This includes activation-cost prompts which use reason: 'activation_cost'.
          const reason: 'cleanup' | 'effect' = step.reason === 'cleanup' ? 'cleanup' : 'effect';
          if (reason === 'cleanup') {
            const maxHandSize = Number(step.maxHandSize || 7);
            const currentHand = you ? (safeViewRef.current?.zones?.[you]?.hand || []) : [];
            const currentHandSize = Array.isArray(currentHand) ? currentHand.length : 0;
            if (currentHandSize <= maxHandSize) {
              setDiscardModalOpen(false);
              setDiscardCount(0);
              setDiscardMinCount(0);
              setDiscardMaxCount(0);
              setDiscardAnyNumber(false);
              setDiscardMaxHandSize(7);
              setDiscardCurrentHandSize(null);
              setDiscardResolutionStepId(null);
              setDiscardResolutionReason('cleanup');
              setDiscardResolutionTitle(null);
              setDiscardResolutionDescription(null);
              setDiscardResolutionHand([]);
              return;
            }
          }
          setDiscardAnyNumber(anyNumberDiscard);
          setDiscardMinCount(anyNumberDiscard ? Number((step as any).minDiscardCount ?? 0) : discardCount);
          setDiscardMaxCount(
            anyNumberDiscard
              ? Number((step as any).maxDiscardCount ?? (Array.isArray((step as any).hand) ? (step as any).hand.length : 0))
              : discardCount
          );
          setDiscardCount(discardCount);
          setDiscardMaxHandSize(Number(step.maxHandSize || 7));
          setDiscardCurrentHandSize(
            Number.isFinite(Number((step as any).currentHandSize))
              ? Number((step as any).currentHandSize)
              : (Array.isArray((step as any).hand) ? (step as any).hand.length : null)
          );
          setDiscardResolutionStepId(String(step.id));
          setDiscardResolutionReason(reason);
          setDiscardResolutionTitle(
            reason === 'cleanup'
              ? 'Cleanup Step - Discard to Hand Size'
              : String(step.sourceName || 'Discard')
          );
          setDiscardResolutionDescription(String(step.description || ''));
          // Server discard steps use ChoiceOption { id, label, imageUrl }; map to KnownCardRef-like.
          setDiscardResolutionHand(
            Array.isArray((step as any).hand)
              ? ((step as any).hand as any[])
                  .map((card) => {
                    if (!card || !card.id) return null;
                    const name = String(card.name || card.label || '').trim();
                    const imageUrl = card.imageUrl || card.image_url || card.image_uris?.normal || card.image_uris?.small;
                    return {
                      ...card,
                      id: String(card.id),
                      name: name || 'Unknown',
                      ...(imageUrl && !card.image_uris
                        ? { image_uris: { normal: imageUrl, small: imageUrl } }
                        : {}),
                    } as KnownCardRef;
                  })
                  .filter((card): card is KnownCardRef => Boolean(card && card.id))
              : []
          );
          setDiscardModalOpen(true);
        }
      }

      // Handle London mulligan bottom selection via Resolution Queue
      else if (step.type === 'hand_to_bottom' && step.reason === 'mulligan') {
        const cardsToBottom = Number(step.cardsToBottom || 0);
        if (cardsToBottom > 0) {
          const incomingStepId = String(step.id || '');
          if (incomingStepId && mulliganBottomLastSubmittedStepId === incomingStepId) {
            return;
          }
          setMulliganBottomCount(cardsToBottom);
          setMulliganBottomStepId(incomingStepId || String(step.id));
          setMulliganBottomModalOpen(true);
        }
      }
      
      // Handle Kynaios choice resolution step
      else if (step.type === 'kynaios_choice') {
        // Convert resolution step to KynaiosChoiceRequest format
        const landsInHand = Array.isArray((step as any).landPlayOrFallbackLandsInHand)
          ? (step as any).landPlayOrFallbackLandsInHand
          : (step.landsInHand || []);
        const options = Array.isArray((step as any).landPlayOrFallbackOptions)
          ? (step as any).landPlayOrFallbackOptions
          : (step.options || []);
        const request: KynaiosChoiceRequest = {
          gameId: payload.gameId,
          sourceController: (step as any).landPlayOrFallbackSourceController || step.sourceController,
          sourceName: step.sourceName || 'Kynaios and Tiro of Meletis',
          isController: (step as any).landPlayOrFallbackIsController ?? step.isController,
          canPlayLand: (step as any).landPlayOrFallbackCanPlayLand ?? step.canPlayLand,
          landsInHand,
          options,
          stepId: step.id,  // Store the step ID for the response
        };
        
        setKynaiosChoiceRequest(request);
        setKynaiosChoiceModalOpen(true);
      }
      
      // Handle Option Choice resolution step (named primitives + generic fallback)
      else if (isNamedGenericOptionChoiceStep(step) || isGenericOptionChoiceFallbackStep(step)) {
        // Deck import wipe confirmations are handled via the existing confirm modal UI.
        if (step.importWipeConfirm === true || step.judgeConfirm === true) {
          openConfirmFromResolutionStep(step);
          return;
        }

        if (step.attackCostPayment === true && Array.isArray(step.attackCostPhyrexianChoices)
          && step.attackCostPhyrexianChoices.length > 0) {
          const youId = String(you || '');
          const playerLife = Number(
            (safeViewRef.current as any)?.life?.[youId]
            ?? (Array.isArray((safeViewRef.current as any)?.players)
              ? (safeViewRef.current as any).players.find((player: any) => String(player?.id || '') === youId)?.life
              : undefined)
            ?? 40,
          );
          setPhyrexianManaModalData({
            stepId: String(step.id),
            mandatory: isResolutionStepMandatory(step),
            attackCostPayment: true,
            pendingId: '',
            cardName: String(step.sourceName || 'Attack Cost'),
            abilityText: String(step.description || ''),
            totalManaCost: String(step.description || ''),
            genericCost: Number(step.attackCostAmount || 0),
            phyrexianChoices: step.attackCostPhyrexianChoices,
            playerLife,
            cardImageUrl: step.sourceImage,
          });
          setPhyrexianManaModalOpen(true);
          return;
        }

        if (step.opponentMayPayChoice === true) {
          const prompt: OpponentMayPayPrompt = {
            promptId: String(step.promptId || ''),
            sourceName: String(step.sourceName || 'Triggered Ability'),
            sourceController: String(step.sourceController || ''),
            decidingPlayer: String(step.decidingPlayer || you || ''),
            manaCost: String(step.manaCost || ''),
            declineEffect: String(step.declineEffect || ''),
            triggerText: String(step.triggerText || step.description || ''),
            availableMana: step.availableMana,
          };
          setOpponentMayPayPrompt(prompt);
          setOpponentMayPayStepId(String(step.id));
          return;
        }

        if (step.counterPlacementTrigger === true || step.agitatorAntTrigger === true) {
          const request: OptionChoiceRequest = buildGenericOptionChoiceRequestFromStep(
            step,
            payload.gameId,
            isResolutionStepMandatory(step),
          );
          setOptionChoiceRequest(request);
          setOptionChoiceModalOpen(true);
          return;
        }

        const isMayAbilityPrompt = (step as any).mayAbilityPrompt === true;
        const isOptionalTriggeredAbilityPrompt =
          (step as any).optionalTriggeredAbilityPrompt === true ||
          ((step as any).effectProgramPrompt === true && (
            (step as any).effectProgramFamily === 'optional_triggered_ability' ||
            (
              (step as any).effectProgramFamily === 'trigger_resolution' &&
              !isResolutionStepMandatory(step)
            )
          ));

        if (isMayAbilityPrompt || isOptionalTriggeredAbilityPrompt) {
          const optionalEffectText = String(
            (step as any).effectText
            || step.description?.replace(/^[^:]+:\s*/i, '').replace(/^you may[:\s]*/i, '').trim()
            || step.description
            || ''
          );
          const normalizedSourceName = String(step.sourceName || 'Ability');
          const effectKey = String(
            (step as any).effectKey
            || buildOptionalEffectKey(normalizedSourceName, optionalEffectText),
          );
          setMayAbilityModalData({
            stepId: step.id,
            sourceName: normalizedSourceName,
            sourceImage: step.sourceImage,
            effectText: optionalEffectText,
            fullAbilityText: (step as any).fullAbilityText || step.description,
            effectKey,
            gameId: (safeViewRef.current as any)?.id || payload.gameId || '',
            shortcutCardName: normalizedSourceName,
            persistMayAutoPreference: true,
            persistTriggerShortcut: isOptionalTriggeredAbilityPrompt,
            ...readResolutionPromptCause(step),
          });
          setMayAbilityModalOpen(true);
          return;
        }

        // Generic option choice modal (Agitator Ant, future IR steps, and similar)
        const request: OptionChoiceRequest = buildGenericOptionChoiceRequestFromStep(
          step,
          payload.gameId,
          isResolutionStepMandatory(step),
        );

        setOptionChoiceRequest(request);
        setOptionChoiceModalOpen(true);
      }

      // Mana color selection (any color / distribution) via Resolution Queue
      else if (step.type === 'mana_color_selection') {
        const selectionKind = String(step.selectionKind || 'any_color');

        if (selectionKind === 'distribution') {
          setManaDistributionModalData({
            gameId: payload.gameId,
            stepId: String(step.id),
            mandatory: isResolutionStepMandatory(step),
            permanentId: String(step.permanentId || step.sourceId || ''),
            cardName: String(step.cardName || step.sourceName || 'Mana'),
            cardImageUrl: step.sourceImage,
            totalAmount: Number(step.totalAmount ?? step.amount ?? 0),
            availableColors: Array.isArray(step.availableColors) ? step.availableColors : (Array.isArray(step.allowedColors) ? step.allowedColors : ['W','U','B','R','G']),
            message: step.message,
          });
          setManaDistributionModalOpen(true);
        } else {
          setAnyColorManaModalData({
            stepId: String(step.id),
            mandatory: isResolutionStepMandatory(step),
            activationId: '',
            permanentId: String(step.permanentId || step.sourceId || ''),
            cardName: String(step.cardName || step.sourceName || 'Mana'),
            amount: Number(step.amount || 1),
            allowedColors: Array.isArray(step.allowedColors) ? step.allowedColors : undefined,
            amountByColor: step.amountByColor && typeof step.amountByColor === 'object'
              ? step.amountByColor
              : undefined,
            dynamicAmountSource: step.dynamicAmountSource === 'devotion' || step.dynamicAmountSource === 'creature_type_count'
              ? step.dynamicAmountSource
              : undefined,
            chosenCreatureType: typeof step.chosenCreatureType === 'string' ? step.chosenCreatureType : undefined,
            cardImageUrl: step.sourceImage,
          });
          setAnyColorManaModalOpen(true);
        }
      }

      else if (step.type === 'counter_distribution') {
        const validTargets = Array.isArray(step.validTargets)
          ? step.validTargets.map((entry: any) => ({
              id: String(entry?.id || '').trim(),
              label: String(entry?.label || entry?.name || entry?.id || 'Target').trim(),
            })).filter((entry: { id: string }) => entry.id)
          : [];
        setCounterDistributionModalData({
          gameId: payload.gameId,
          stepId: String(step.id),
          mandatory: isResolutionStepMandatory(step),
          cardName: String(step.sourceName || step.cardName || 'Ability'),
          cardImageUrl: step.sourceImage,
          counterType: String(step.counterType || '+1/+1'),
          totalAmount: Number(step.totalAmount ?? 0),
          minPerTarget: Number(step.minPerTarget ?? 1),
          targets: validTargets,
          message: typeof step.message === 'string' ? step.message : step.description,
        });
        setCounterDistributionModalOpen(true);
      }

      else if (isGenericNumberChoiceStep(step)) {
        setPendingSpellXSelection(buildPendingSpellXSelectionFromStep(step));
      }

      // Phyrexian mana payment choice via Resolution Queue
      else if (step.type === 'mana_payment_choice' && (step.spellPaymentRequired === true || (step as any).wardPayment === true)) {
        const ca = (step as any).costAdjustment as PaymentCostAdjustment | undefined;
        const co = (step as any).convokeOptions;
        const so = (step as any).sneakOptions;
        const wo = (step as any).webSlingingOptions;
        const isWardPayment = (step as any).wardPayment === true;

        setSpellToCast({
          cardId: String((step as any).cardId || step.sourceId || ''),
          cardName: isWardPayment
            ? String((step as any).wardPermanentName || (step as any).cardName || step.sourceName || 'Ward')
            : String((step as any).cardName || step.sourceName || 'Spell'),
          manaCost: String((step as any).wardCost || (step as any).manaCost || ''),
          typeLine: isWardPayment
            ? undefined
            : (() => {
                const fromStep = String((step as any).typeLine || (step as any).type_line || '').trim();
                if (fromStep) return fromStep;
                const cardId = String((step as any).cardId || step.sourceId || '');
                const zoneKey = String((step as any).fromZone || 'hand');
                const zones = you && safeView?.zones ? (safeView.zones as any)[you] : null;
                const zoneCards =
                  zoneKey === 'graveyard' ? zones?.graveyard
                  : zoneKey === 'exile' ? zones?.exile
                  : zoneKey === 'command' ? zones?.command
                  : zones?.hand;
                const fromZoneCard = Array.isArray(zoneCards)
                  ? zoneCards.find((c: any) => String(c?.id || '') === cardId)
                  : null;
                return String(
                  fromZoneCard?.type_line
                  || fromZoneCard?.typeLine
                  || (step as any).card?.type_line
                  || '',
                ).trim();
              })(),
          isActivatedAbilityPayment: false,
          // Default hand so CastSpellModal hides graveyard-only alts (flashback, etc.)
          // even if a payment step omitted fromZone.
          fromZone: isWardPayment
            ? undefined
            : ((String((step as any).fromZone || 'hand') as 'hand' | 'graveyard' | 'exile' | 'library' | 'command')),
          oracleText: isWardPayment
            ? String(step.description || '')
            : String((step as any).oracleText || ''),
          extraAlternateCosts: isWardPayment
            ? []
            : (Array.isArray((step as any).extraAlternateCosts) ? (step as any).extraAlternateCosts : undefined),
          targets: Array.isArray((step as any).targets) ? (step as any).targets : undefined,
          effectId: isWardPayment ? undefined : String((step as any).effectId || ''),
          xValue: isWardPayment ? undefined : (Number.isFinite((step as any).xValue) ? Math.max(0, Number((step as any).xValue)) : undefined),
          costAdjustment: isWardPayment ? undefined : ca,
          convokeOptions: isWardPayment ? undefined : co,
          sneakOptions: isWardPayment ? undefined : so,
          webSlingingOptions: isWardPayment ? undefined : wo,
          forcedAlternateCostId: isWardPayment ? undefined : ((step as any).forcedAlternateCostId != null ? String((step as any).forcedAlternateCostId) : undefined),
          preferredAlternateCostId: isWardPayment ? undefined : ((step as any).preferredAlternateCostId != null ? String((step as any).preferredAlternateCostId) : undefined),
          // Track the resolution step id so confirm/cancel responds via the queue.
          paymentStepId: String(step.id),
          title: isWardPayment
            ? `Pay Ward for ${String((step as any).wardPermanentName || (step as any).cardName || step.sourceName || 'Ward')}`
            : `Pay for ${String((step as any).cardName || step.sourceName || 'Spell')}`,
          confirmLabel: isWardPayment ? 'Pay Ward' : 'Pay Cost',
          manualFloatingManaSelection: !isWardPayment,
        } as any);
        setCastSpellModalOpen(true);
      }

      else if (step.type === 'mana_payment_choice' && (step as any).activationPaymentChoice === true) {
        setSpellToCast({
          cardId: String((step as any).cardId || step.sourceId || ''),
          cardName: String((step as any).cardName || step.sourceName || 'Ability'),
          manaCost: String((step as any).manaCost || ''),
          typeLine: String((step as any).typeLine || (step as any).type_line || ''),
          isActivatedAbilityPayment: true,
          oracleText: String((step as any).abilityText || step.description || ''),
          // Explicit empty — do not fall back to Fist of Suns / Omniscience spell alts.
          extraAlternateCosts: [],
          paymentStepId: String(step.id),
          activatingPermanentId: String((step as any).permanentId || step.sourceId || ''),
          // Always exclude the permanent being activated — its {T} (or other cost)
          // cannot also pay the activation's mana cost (e.g. Three Tree City {2}{T}).
          excludeActivatingPermanentFromPayment: true,
          title: `Pay for ${String((step as any).cardName || step.sourceName || 'Ability')}`,
          confirmLabel: String((step as any).confirmLabel || 'Pay and Continue'),
          manualFloatingManaSelection: true,
        } as any);
        setCastSpellModalOpen(true);
      }

      else if (step.type === 'extort_payment') {
        setSpellToCast({
          cardId: String((step as any).cardId || step.sourceId || ''),
          cardName: String((step as any).cardName || step.sourceName || 'Extort'),
          manaCost: String((step as any).manaCost || '{W/B}'),
          oracleText: String((step as any).effectText || step.description || ''),
          extraAlternateCosts: [],
          paymentStepId: String(step.id),
          title: `Pay Extort for ${String((step as any).cardName || step.sourceName || 'Extort')}`,
          confirmLabel: String((step as any).confirmLabel || 'Pay Extort'),
          manualFloatingManaSelection: true,
        } as any);
        setCastSpellModalOpen(true);
      }

      // Phyrexian mana payment choice via Resolution Queue
      else if (step.type === 'mana_payment_choice' && step.phyrexianManaChoice === true) {
        setPhyrexianManaModalData({
          stepId: String(step.id),
          mandatory: isResolutionStepMandatory(step),
          pendingId: String(step.pendingId || ''),
          permanentId: step.permanentId,
          cardId: step.cardId,
          castSpellArgs: step.castSpellArgs,
          cardName: String(step.cardName || step.sourceName || ''),
          abilityText: String(step.abilityText || step.description || ''),
          totalManaCost: String(step.totalManaCost || step.manaCost || ''),
          genericCost: Number(step.genericCost || 0),
          phyrexianChoices: step.phyrexianChoices || [],
          playerLife: Number(step.playerLife || 40),
          cardImageUrl: step.sourceImage,
        });
        setPhyrexianManaModalOpen(true);
      }

      // Mutate target selection via Resolution Queue
      else if (step.type === 'mutate_target_selection') {
        setMutateModalData({
          cardId: String(step.cardId || step.sourceId || ''),
          cardName: String(step.cardName || step.sourceName || 'Mutate'),
          imageUrl: step.imageUrl || step.sourceImage,
          mutateCost: String(step.mutateCost || ''),
          targets: Array.isArray(step.validTargets) ? step.validTargets : [],
          stepId: String(step.id),
          mandatory: isResolutionStepMandatory(step),
        });
        setMutateModalOpen(true);
      }

      // Graveyard card selection via Resolution Queue
      else if (step.type === 'graveyard_selection' || step.type === 'soulshift_target') {
        const rawTargets = step.type === 'soulshift_target'
          ? ((step as any).spirits || [])
          : (Array.isArray(step.validTargets) ? step.validTargets : []);
        const validTargets: GraveyardCard[] = Array.isArray(rawTargets)
          ? rawTargets.map((t: any) => ({
              id: String(t?.id || ''),
              name: String(t?.name || 'Unknown'),
              typeLine: t?.typeLine,
              manaCost: t?.manaCost,
              imageUrl: t?.imageUrl,
            }))
          : [];

        setGraveyardSelectionModalData({
          stepId: String(step.id),
          mandatory: isResolutionStepMandatory(step),
          title: String(step.title || step.cardName || step.sourceName || (step.type === 'soulshift_target' ? 'Select a Spirit Card' : 'Select from Graveyard')),
          description: String(step.description || ''),
          sourceCard: {
            name: String(step.cardName || step.sourceName || 'Effect'),
            imageUrl: step.imageUrl || step.sourceImage,
          },
          validTargets,
          minTargets: Math.max(0, Number(step.minTargets ?? 0)),
          maxTargets: Math.max(0, Number(step.maxTargets ?? (step.minTargets ?? 0))),
        });
        setGraveyardSelectionModalOpen(true);
      }

      // Handle Two-pile split resolution step
      else if (step.type === 'two_pile_split') {
        const request: TwoPileSplitRequest = {
          gameId: payload.gameId,
          stepId: step.id,
          sourceName: step.sourceName || 'Separate Into Two Piles',
          sourceImage: step.sourceImage,
          description: step.description || '',
          items: step.items || [],
          minPerPile: step.minPerPile ?? 0,
          pileCount: step.pileCount ?? 2,
          mandatory: isResolutionStepMandatory(step),
        };
        setTwoPileSplitRequest(request);
        setTwoPileSplitModalOpen(true);
      }

      // Tap/Untap target selection via Resolution Queue
      else if (step.type === 'tap_untap_target') {
        setTapUntapTargetModalData({
          stepId: String(step.id),
          sourceId: String(step.sourceId || ''),
          sourceName: String(step.sourceName || 'Ability'),
          sourceImageUrl: step.sourceImage,
          action: step.action || 'tap',
          targetFilter: step.targetFilter || {},
          targetCount: Number(step.targetCount || 1),
          title: step.title,
          description: step.description,
        });
        setTapUntapTargetModalOpen(true);
      }

      // Fight target selection via Resolution Queue
      else if (step.type === 'fight_target') {
        setFightTargetModalData({
          stepId: String(step.id),
          sourceId: String(step.sourceId || ''),
          sourceName: String(step.sourceName || 'Creature'),
          sourceImageUrl: step.sourceImage,
          title: step.title,
          description: step.description,
          targetFilter: step.targetFilter,
        });
        setFightTargetModalOpen(true);
      }

      // Counter target selection via Resolution Queue
      else if (step.type === 'counter_target') {
        const validTargets: TargetOption[] = (step.validTargets || []).map((t: any) => ({
          id: t.id,
          type: 'permanent',
          name: t.label || t.name || 'Unknown',
          displayName: t.label || t.name,
          imageUrl: t.imageUrl,
          controller: t.controller,
          typeLine: t.typeLine,
          life: t.life,
          zone: t.zone,
          owner: t.owner,
          card: t.card,
        }));

        setTargetModalData({
          cardId: step.sourceId || step.id,
          source: { name: step.sourceName || 'Add Counter', imageUrl: step.sourceImage },
          title: step.title || step.description || 'Choose target',
          description: step.description || '',
          targets: validTargets,
          minTargets: step.minTargets || 1,
          maxTargets: step.maxTargets || 1,
          effectId: step.sourceId,
          stepId: step.id,
          useResolutionQueue: true,
        });
        setTargetModalOpen(true);
      }

      // Counter movement via Resolution Queue
      else if (step.type === 'counter_movement') {
        setCounterMovementModalData({
          stepId: String(step.id),
          sourceId: String(step.sourceId || ''),
          sourceName: String(step.sourceName || 'Move Counter'),
          sourceImageUrl: step.sourceImage,
          sourceFilter: step.sourceFilter,
          targetFilter: step.targetFilter,
          title: step.title,
          description: step.description,
        });
        setCounterMovementModalOpen(true);
      }

      // Station creature selection via Resolution Queue
      else if (step.type === 'station_creature_selection') {
        setStationCreatureSelectionData({
          stepId: String(step.id),
          station: step.station,
          creatures: step.creatures || [],
          title: step.title || 'Station',
          description: step.description || '',
        });
        setStationCreatureSelectionOpen(true);
      }

      // Life payment (Toxic Deluge, Hatred, etc.) via Resolution Queue
      else if (step.type === 'life_payment') {
        setLifePaymentModalData({
          stepId: String(step.id),
          mandatory: isResolutionStepMandatory(step),
          cardId: String(step.cardId || step.sourceId || ''),
          cardName: String(step.cardName || step.sourceName || 'Spell'),
          description: String(step.description || 'Choose an amount of life to pay.'),
          imageUrl: step.sourceImage,
          currentLife: Number(step.currentLife ?? 40),
          minPayment: Number(step.minPayment ?? 0),
          maxPayment: Number(step.maxPayment ?? 0),
        });
        setLifePaymentModalOpen(true);
      }

      // Handle Bounce Land choice resolution step
      else if (step.type === 'return_controlled_permanent_choice') {
        debug(2, '[BounceLand] Received bounce land choice from resolution queue:', step);
        const optionsToChoose = step.returnControlledPermanentOptions || [];
        const sourceName = step.returnControlledPermanentSourceName || step.sourceName || 'Return Controlled Permanent';
        setReturnControlledPermanentData({
          sourceId: step.sourceId || step.id,
          sourceName,
          imageUrl: step.sourceImage || step.sourceImageUrl,
          optionsToChoose,
          title: `${sourceName} Enters the Battlefield`,
          subtitle: step.returnControlledPermanentChoice
            ? 'Choose a permanent to return to your hand'
            : 'Choose a land to return to your hand',
          oracleText: step.returnControlledPermanentChoice
            ? `When ${sourceName} resolves, return a permanent you control to its owner's hand.`
            : `When ${sourceName} enters the battlefield, return a land you control to its owner's hand.`,
          confirmButtonText: step.returnControlledPermanentChoice
            ? 'Return Selected Permanent'
            : 'Return Selected Land',
          stackItemId: step.stackItemId,
          stepId: step.id,  // Store the step ID for resolution response
        });
        setReturnControlledPermanentModalOpen(true);
      }
}
