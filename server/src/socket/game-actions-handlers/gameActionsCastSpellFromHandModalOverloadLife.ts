/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand modal / additional-cost mode /
 * overload prompts and pay-X-life (CR 601.2b) before additional costs.
 *
 * Public entry symbols: tryPromptCastSpellModalOverloadLifeFromHand.
 */
import type { Socket } from "socket.io";
import type { PaymentItem } from "../../../../shared/src/index.js";
import type { GameContext } from "../../state/context.js";
import { extractAdditionalCostModesFromOracleText } from "../../state/modules/additionalCostModeOracleText.js";
import { parseKeywordAlternateManaCost } from "../../state/modules/alternate-costs.js";
import { spellOracleUsesTeamworkChooseBoth } from "../../state/modules/marvelMechanicsHelpers.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { PAY_X_LIFE_CARDS, getMaxPayableLife, validateLifePayment } from "../../state/utils";
import { extractModalModesForSpellCast } from "../../utils/oraclePromptContext.js";
import { debug } from "../../utils/debug.js";
import { adjustModalSpellInfoForCurrentCast } from "./gameActionsModalCastModeCosts.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export type CastSpellModalOverloadLifeFromHandArgs = {
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  isInstantOrSorcery: boolean;
  baseOracleText: string;
  oracleText: string;
  targets: any;
  payment: PaymentItem[] | undefined;
  selectedCastMode: "normal" | "overload" | undefined;
  alternateCostId: string | undefined;
  xValue: number | undefined;
  convokeTappedCreatures: string[] | undefined;
};

export type CastSpellModalOverloadLifeFromHandContinue = {
  kind: "continue";
};

export function tryPromptCastSpellModalOverloadLifeFromHand(
  args: CastSpellModalOverloadLifeFromHandArgs,
): CastSpellModalOverloadLifeFromHandContinue | void {
  const {
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardInHand,
    isInstantOrSorcery,
    baseOracleText,
    oracleText,
    targets,
    payment,
    selectedCastMode,
    alternateCostId,
    xValue,
    convokeTappedCreatures,
  } = args;

      
      // Check if this spell is a modal spell (Choose one/two/three - e.g., Austere Command, Cryptic Command)
      // Pattern: "Choose two G��" or "Choose one G��" followed by bullet points
      // IMPORTANT: Only apply to INSTANTS and SORCERIES, not to permanents with triggered abilities
      // Permanents like Glorious Sunrise have "At the beginning of combat on your turn, choose one G��" which is a TRIGGER, not a modal spell
      const modalSpellInfo = isInstantOrSorcery && !spellOracleUsesTeamworkChooseBoth(baseOracleText)
        ? adjustModalSpellInfoForCurrentCast(extractModalModesForSpellCast(baseOracleText, String(cardInHand.name || '')), game.state, String(playerId), baseOracleText)
        : undefined;
      const modesAlreadySelected = (cardInHand as any).selectedModes || (targets as any)?.selectedModes;
      const additionalCostModeInfo = isInstantOrSorcery ? extractAdditionalCostModesFromOracleText(baseOracleText) : undefined;
      const additionalCostModesSelected = (cardInHand as any).selectedAdditionalCostModes
        || (cardInHand as any).selectedSpreeModes
        || (targets as any)?.selectedAdditionalCostModes
        || (targets as any)?.selectedSpreeModes;

      if (additionalCostModeInfo && !additionalCostModesSelected) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) =>
            s?.type === ResolutionStepType.MODE_SELECTION &&
            String((s as any)?.sourceId || '') === String(cardId) &&
            String((s as any)?.modeSelectionPurpose || '') === additionalCostModeInfo.purpose
          );

        if (!existing) {
          const additionalCostModeStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: baseOracleText,
            mandatory: true,
            modes: additionalCostModeInfo.options.map((mode) => ({
              id: mode.id,
              label: mode.label,
              description: `${mode.effect}${mode.cost ? ` (${mode.cost})` : ''}`,
            })),
            minModes: additionalCostModeInfo.minModes,
            maxModes: additionalCostModeInfo.maxModes,
            allowDuplicates: false,
            modeSelectionPurpose: additionalCostModeInfo.purpose,
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(additionalCostModeStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued ${additionalCostModeInfo.purpose} mode selection for ${cardInHand.name}`);
        return;
      }
      
      if (modalSpellInfo && !modesAlreadySelected) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'modalSpell');

        if (!existing) {
          const modalSpellStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: baseOracleText,
            mandatory: true,
            modes: modalSpellInfo.options.map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description,
              ...(Number.isFinite(Number(option.pCost)) && Number(option.pCost) > 0
                ? { pCost: Math.floor(Number(option.pCost)) }
                : {}),
            })),
            minModes: modalSpellInfo.minModes,
            maxModes: modalSpellInfo.maxModes,
            normalMinModes: modalSpellInfo.normalMinModes,
            normalMaxModes: modalSpellInfo.normalMaxModes,
            entwineCost: modalSpellInfo.entwineCost,
            allowDuplicates: Boolean(modalSpellInfo.canRepeatModes),
            ...(Number.isFinite(Number(modalSpellInfo.pBudget)) && Number(modalSpellInfo.pBudget) > 0
              ? { pBudget: Math.floor(Number(modalSpellInfo.pBudget)), canRepeatModes: Boolean(modalSpellInfo.canRepeatModes) }
              : {}),
            modeSelectionPurpose: 'modalSpell',
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(modalSpellStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued modal selection for ${cardInHand.name}`);
        return; // Wait for mode selection via Resolution Queue
      }
      
      // Check if this spell has overload (e.g., Cyclonic Rift)
      // If it does, and player hasn't specified which mode to use, prompt for mode selection
      const hasOverload = String(baseOracleText || oracleText).toLowerCase().includes('overload');
      const overloadCost = parseKeywordAlternateManaCost(String(baseOracleText || oracleText), 'overload') || null;
      const overloadModeAlreadySelected = selectedCastMode === 'normal' || selectedCastMode === 'overload';

      // This call's alternate cost is the choice. A leftover castWithOverload on the
      // hand card is an abandoned attempt and must not skip the prompt.
      const castWithOverload = alternateCostId === 'overload' ||
                               (payment as any[])?.some((p: any) => p.overload === true) ||
                               (targets as any)?.overload === true;
      
      if (hasOverload && overloadCost && !castWithOverload && !overloadModeAlreadySelected) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'overload');

        if (!existing) {
          const overloadModeStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `Choose casting mode for ${cardInHand.name}`,
            mandatory: true,
            modes: [
              {
                id: 'normal',
                label: 'Normal',
                description: `Cast ${cardInHand.name} normally.`,
              },
              {
                id: 'overload',
                label: 'Overload',
                description: `Cast ${cardInHand.name} with Overload (replaces "target" with "each").`,
              },
            ],
            minModes: 1,
            maxModes: 1,
            allowDuplicates: false,
            modeSelectionPurpose: 'overload',
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(overloadModeStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued overload mode selection for ${cardInHand.name}`);
        return; // Wait for mode selection via Resolution Queue
      }

      // Check if this spell requires paying X life (Toxic Deluge, Hatred, etc.)
      // If the player hasn't specified the life payment amount, prompt for it
      // Skip this check for permanents (creatures, artifacts, enchantments) - they have activated abilities, not cast costs
      const cardNameLower = (cardInHand.name || '').toLowerCase();
      const cardTypeLine = (cardInHand.type_line || '').toLowerCase();
      const isPermanent = cardTypeLine.includes('creature') || cardTypeLine.includes('artifact') || 
                         cardTypeLine.includes('enchantment') || cardTypeLine.includes('planeswalker') || 
                         cardTypeLine.includes('land');
      const payXLifeInfo = PAY_X_LIFE_CARDS[cardNameLower];
      const lifePaymentProvided = (payment as any[])?.some((p: any) => typeof p.lifePayment === 'number') ||
                                   (targets as any)?.lifePayment !== undefined;
      
      if (payXLifeInfo && !lifePaymentProvided && !isPermanent) {
        // Get the player's current life to determine max payment
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life?.[playerId] ?? startingLife;
        const maxPayable = getMaxPayableLife(currentLife, game as GameContext, playerId);
        const minPayment = payXLifeInfo.minX || 0;
        
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.LIFE_PAYMENT && String((s as any)?.cardId || '') === String(cardId));

        if (!existing) {
          const lifePaymentStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.LIFE_PAYMENT,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: payXLifeInfo.effect,
            mandatory: true,
            cardId,
            cardName: cardInHand.name,
            currentLife,
            minPayment,
            maxPayment: maxPayable,
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(lifePaymentStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued life payment (${minPayment}-${maxPayable}) for ${cardInHand.name}`);
        return; // Wait for life payment selection via Resolution Queue
      }
      
      // If life payment was provided, validate it
      if (payXLifeInfo && lifePaymentProvided) {
        const lifePayment = (payment as any[])?.find((p: any) => typeof p.lifePayment === 'number')?.lifePayment ||
                            (targets as any)?.lifePayment || 0;
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life?.[playerId] ?? startingLife;
        
        const validationError = validateLifePayment(currentLife, lifePayment, cardInHand.name, game as GameContext, playerId);
        if (validationError) {
          socket.emit("error", {
            code: "INVALID_LIFE_PAYMENT",
            message: validationError,
          });
          return;
        }
        
        // Store the life payment on the card for later resolution
        (cardInHand as any).lifePaymentAmount = lifePayment;
        debug(2, `[castSpellFromHand] Life payment of ${lifePayment} validated for ${cardInHand.name}`);
      }

  return { kind: "continue" };
}
