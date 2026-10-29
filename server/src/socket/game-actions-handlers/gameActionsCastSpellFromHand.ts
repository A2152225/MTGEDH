/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: leftover handleCastSpellFromHand orchestrator after phase
 * peels (front gates, prompt/pay pipeline, RulesBridge/suspend, stack push,
 * persist on-cast). registerGameActions keeps a thin wrapper.
 *
 * Public entry symbols: handleCastSpellFromHandRequest.
 */
import type { Server, Socket } from "socket.io";
import { GameManager } from "../../GameManager.js";
import { appendEvent } from "../../db";
import { resolveGiftAwareOracleText } from "../../utils/gift.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, getOrInitManaPool, getPlayerName } from "../util";
import { tryPromptCastSpellAdditionalCostsFromHand } from "./gameActionsCastSpellFromHandAdditionalCosts.js";
import { tryAssembleCastSpellCostAndConvokeFromHand } from "./gameActionsCastSpellFromHandCostConvoke.js";
import { tryConsumeCastSpellManaFromHand } from "./gameActionsCastSpellFromHandConsumeMana.js";
import { tryPromptCastSpellForceFlashFromHand } from "./gameActionsCastSpellFromHandForceFlash.js";
import { tryResolveCastSpellFromHandFront } from "./gameActionsCastSpellFromHandFront.js";
import { tryApplyCastSpellManaPaymentFromHand } from "./gameActionsCastSpellFromHandManaPayment.js";
import { tryPromptCastSpellModalOverloadLifeFromHand } from "./gameActionsCastSpellFromHandModalOverloadLife.js";
import { persistAndProcessCastSpellFromHand } from "./gameActionsCastSpellFromHandPersistOnCast.js";
import { tryPushCastSpellFromHandToStack } from "./gameActionsCastSpellFromHandStackPush.js";
import { tryPromptCastSpellTargetsFromHand } from "./gameActionsCastSpellFromHandTargets.js";
import { restorePlayerCastSpellPaymentCheckpoint } from "./gameActionsCastSpellPaymentSources.js";
import {
  getEntwineCostForSelectedModes,
  getOracleTextForCastMode,
  getSpellModeAdditionalCost,
} from "./gameActionsModalCastModeCosts.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";
import { canCompleteSpellCastAtCurrentTiming } from "./gameActionsSpellCastLock.js";

export async function handleCastSpellFromHandRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: any,
): Promise<void> {
    const safeGameId = typeof payload?.gameId === 'string' ? payload.gameId : undefined;
    try {
      const front = tryResolveCastSpellFromHandFront({
        socket,
        ensureInGameRoom,
        payload,
      });
      if (!front) return;
      const gameId = front.gameId;
      const cardId = front.cardId;
      let targets = front.targets;
      const payment = front.payment;
      const skipInteractivePrompts = front.skipInteractivePrompts;
      const skipPriorityCheck = front.skipPriorityCheck;
      const xValue = front.xValue;
      const alternateCostId = front.alternateCostId;
      const selectedCastMode = front.selectedCastMode;
      const convokeTappedCreatures = front.convokeTappedCreatures;
      const harmonizeTappedCreatureId = front.harmonizeTappedCreatureId;
      const sneakReturnedCreatureId = front.sneakReturnedCreatureId;
      const webSlingingReturnedCreatureId = front.webSlingingReturnedCreatureId;
      const bypassExilePermissionCheck = front.bypassExilePermissionCheck;
      const ignoreTimingRestrictions = front.ignoreTimingRestrictions;
      const game = front.game;
      const playerId = front.playerId;
      const delayedSpellCopiesSnapshot = front.delayedSpellCopiesSnapshot;
      const phaseStr = front.phaseStr;
      const zones = front.zones;
      const hand = front.hand;
      const exile = front.exile;
      const graveyard = front.graveyard;
      const castSourceZone = front.castSourceZone;
      const sourceArr = front.sourceArr;
      const commandZoneCandidate = front.commandZoneCandidate;
      const cardInHand = front.cardInHand;
      const selectedFaceIndex = front.selectedFaceIndex;
      const castAsAdventure = front.castAsAdventure;
      const resolvedTimesKicked = front.resolvedTimesKicked;
      const commandZoneManaCost = front.commandZoneManaCost;
      const typeLine = front.typeLine;

      
      // =============================================================================
      // CRITICAL FIX: Skip all interactive prompts when completing a previous cast
      // =============================================================================
      // When skipInteractivePrompts=true (from completeCastSpell), we're completing 
      // a cast that already went through target/payment selection. Jump directly to 
      // the actual casting logic to prevent infinite targeting loops.
      const shouldSkipAllPrompts = skipInteractivePrompts === true;
      
      // Check timing restrictions for sorcery-speed spells
      const giftPromisedForCast = (cardInHand as any).giftPromised === true;
      const selectedModes = Array.isArray((cardInHand as any).selectedModes)
        ? (cardInHand as any).selectedModes
        : (targets as any)?.selectedModes;
      const selectedAdditionalCostModes = Array.isArray((cardInHand as any).selectedAdditionalCostModes)
        ? (cardInHand as any).selectedAdditionalCostModes
        : (Array.isArray((cardInHand as any).selectedSpreeModes)
          ? (cardInHand as any).selectedSpreeModes
          : (Array.isArray((targets as any)?.selectedAdditionalCostModes)
            ? (targets as any).selectedAdditionalCostModes
            : (targets as any)?.selectedSpreeModes));
      const baseOracleText = resolveGiftAwareOracleText(cardInHand.oracle_text || "", giftPromisedForCast);
      const spellModeAdditionalCost = getSpellModeAdditionalCost(baseOracleText, selectedModes, selectedAdditionalCostModes);
      const entwineCost = getEntwineCostForSelectedModes(baseOracleText, selectedModes, String(cardInHand.name || ''))
        || (((cardInHand as any).castWithEntwine === true && String((cardInHand as any).entwineCost || '').trim())
          ? String((cardInHand as any).entwineCost).trim()
          : undefined);
      const overloadRequested = alternateCostId === 'overload' || selectedCastMode === 'overload';
      const oracleText = getOracleTextForCastMode(baseOracleText, overloadRequested, selectedModes, selectedAdditionalCostModes, String(cardInHand.name || '')).toLowerCase();

      // Carry over additional-cost payment state from requestCastSpell -> completeCastSpell.
      // Many resolution paths check this flag on the card object.
      (cardInHand as any).additionalCostPaid = (targets as any)?.additionalCostPaid === true;
      (cardInHand as any).additionalCostMethod = (targets as any)?.additionalCostMethod;

      const forceFlash = tryPromptCastSpellForceFlashFromHand({
        socket,
        game,
        gameId,
        playerId,
        cardId,
        cardInHand,
        oracleText,
        typeLine,
        targets,
        payment,
        xValue,
        alternateCostId,
        convokeTappedCreatures,
        ignoreTimingRestrictions,
        castSourceZone,
        zones,
        phaseStr,
      });
      if (!forceFlash) return;
      const isForceAltCostRequested = forceFlash.isForceAltCostRequested;
      const isInstantOrSorcery = forceFlash.isInstantOrSorcery;

      const modalOverloadLife = tryPromptCastSpellModalOverloadLifeFromHand({
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
      });
      if (!modalOverloadLife) return;

      
      const additionalCostPrompt = tryPromptCastSpellAdditionalCostsFromHand({
        io,
        socket,
        game,
        gameId,
        playerId,
        cardId,
        cardInHand,
        oracleText,
        payment,
        targets,
        xValue,
        alternateCostId,
        convokeTappedCreatures,
        shouldSkipAllPrompts,
        zones,
      });
      if (!additionalCostPrompt) return;
      targets = additionalCostPrompt.targets;
      const additionalCost = additionalCostPrompt.additionalCost;
      const additionalCostPaid = additionalCostPrompt.additionalCostPaid;
      const bargainResolved = additionalCostPrompt.bargainResolved;
      const wasBargained = additionalCostPrompt.wasBargained;
      const teamworkResolved = additionalCostPrompt.teamworkResolved;
      const teamworkWasPaid = additionalCostPrompt.teamworkWasPaid;
      const evidenceCollected = additionalCostPrompt.evidenceCollected;


      const targetPrompt = tryPromptCastSpellTargetsFromHand({
        socket,
        game,
        gameId,
        playerId,
        cardId,
        cardInHand,
        oracleText,
        typeLine,
        isInstantOrSorcery,
        targets,
        xValue,
        skipInteractivePrompts,
        shouldSkipAllPrompts,
        castSourceZone,
        selectedFaceIndex,
        selectedModes,
        selectedAdditionalCostModes,
        entwineCost,
        alternateCostId,
        bypassExilePermissionCheck,
      });
      if (!targetPrompt) return;
      const isAura = targetPrompt.isAura;
      const auraTargetType = targetPrompt.auraTargetType;
      const auraControllerRestriction = targetPrompt.auraControllerRestriction;
      const spellSpec = targetPrompt.spellSpec;
      const targetReqs = targetPrompt.targetReqs;
      const preferParsedTargetReqs = targetPrompt.preferParsedTargetReqs;
      const multiTargetClauses = targetPrompt.multiTargetClauses;


      const costConvoke = tryAssembleCastSpellCostAndConvokeFromHand({
        io,
        socket,
        game,
        gameId,
        playerId,
        cardInHand,
        alternateCostId,
        isForceAltCostRequested,
        overloadRequested,
        commandZoneManaCost,
        spellModeAdditionalCost,
        resolvedTimesKicked,
        xValue,
        payment,
        castSourceZone,
        harmonizeTappedCreatureId,
        sneakReturnedCreatureId,
        webSlingingReturnedCreatureId,
        convokeTappedCreatures,
      });
      if (!costConvoke) return;
      const isForceAltCostPaid = costConvoke.isForceAltCostPaid;
      const abortCastSpellPayment = costConvoke.abortCastSpellPayment;
      const existingPool = costConvoke.existingPool;
      const castSpellPaymentCheckpoint = costConvoke.castSpellPaymentCheckpoint;
      const restrictedManaPurpose = costConvoke.restrictedManaPurpose;
      const explicitPaymentSelected = costConvoke.explicitPaymentSelected;
      const totalColored = costConvoke.totalColored;
      const totalGeneric = costConvoke.totalGeneric;
      const castingCreatureSpell = costConvoke.castingCreatureSpell;
      const poolBeforePayment = costConvoke.poolBeforePayment;
      const suspendInfo = costConvoke.suspendInfo;
      const resolvedSuspendCost = costConvoke.resolvedSuspendCost;
      const manaPayment = tryApplyCastSpellManaPaymentFromHand({
        socket,
        game,
        playerId,
        cardId,
        cardInHand,
        payment,
        isForceAltCostPaid,
        existingPool,
        abortCastSpellPayment,
        castSpellPaymentCheckpoint,
        restrictedManaPurpose,
        explicitPaymentSelected,
        skipPriorityCheck,
        skipInteractivePrompts,
      });
      if (!manaPayment) return;
      const creatureSpellHasteLowerBoundBeforePayment = manaPayment.creatureSpellHasteLowerBoundBeforePayment;
      const producedNonSnowByColor = manaPayment.producedNonSnowByColor;
      const producedSnowByColor = manaPayment.producedSnowByColor;
      const producedTreasureByColor = manaPayment.producedTreasureByColor;
      const producedNonTreasureByColor = manaPayment.producedNonTreasureByColor;
      const selectedPaymentAvailableTotals = manaPayment.selectedPaymentAvailableTotals;
      const tappedPaymentPermanents = manaPayment.tappedPaymentPermanents;
      const sacrificedPaymentPermanents = manaPayment.sacrificedPaymentPermanents;
      let persistedSacrificedPermanentFields = manaPayment.persistedSacrificedPermanentFields;
      const poolBeforeSpellPayment = manaPayment.poolBeforeSpellPayment;
      const creatureSpellHasteLowerBoundBeforeSpellPayment = manaPayment.creatureSpellHasteLowerBoundBeforeSpellPayment;
      const manaProducedByPermanentBeforeSpellPayment = manaPayment.manaProducedByPermanentBeforeSpellPayment;
      const allowResolutionModeCompletion = manaPayment.allowResolutionModeCompletion;

      
      const consumedMana = tryConsumeCastSpellManaFromHand({
        game,
        playerId,
        cardInHand,
        payment,
        isForceAltCostPaid,
        explicitPaymentSelected,
        selectedPaymentAvailableTotals,
        totalColored,
        totalGeneric,
        restrictedManaPurpose,
        abortCastSpellPayment,
        castingCreatureSpell,
        poolBeforePayment,
        poolBeforeSpellPayment,
        creatureSpellHasteLowerBoundBeforePayment,
        creatureSpellHasteLowerBoundBeforeSpellPayment,
        producedNonSnowByColor,
        producedSnowByColor,
        producedTreasureByColor,
        producedNonTreasureByColor,
      });
      if (!consumedMana) return;
      const manaConsumption = consumedMana.manaConsumption;
      const paymentManaDelta = consumedMana.paymentManaDelta;
      const manaSpentTotal = consumedMana.manaSpentTotal;
      const gainsHasteUntilEndOfTurnFromManaSpent = consumedMana.gainsHasteUntilEndOfTurnFromManaSpent;
      const cantBeCounteredFromCavern = consumedMana.cantBeCounteredFromCavern;
      const convergeValue = consumedMana.convergeValue;
      const manaFromTreasureSpent = consumedMana.manaFromTreasureSpent;
      const manaFromTreasureSpentKnown = consumedMana.manaFromTreasureSpentKnown;
      const snowManaSpentByColor = consumedMana.snowManaSpentByColor;
      const snowManaColorsSpent = consumedMana.snowManaColorsSpent;
      const snowManaSpentKnown = consumedMana.snowManaSpentKnown;
      const snowManaSpent = consumedMana.snowManaSpent;
      const snowManaOfSpellColorsSpentKnown = consumedMana.snowManaOfSpellColorsSpentKnown;
      const snowManaOfSpellColorsSpent = consumedMana.snowManaOfSpellColorsSpent;

      // Bump sequence to ensure state changes are visible
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      // Get RulesBridge for validation (optional - if not available, proceed with legacy logic)
      const bridge = (GameManager as any).syncRulesBridge?.(gameId, game.state)
        || (GameManager as any).getRulesBridge?.(gameId);
      if (bridge) {
        try {
          // At this point the server has already validated the cast and committed mana/other costs.
          // RulesBridge is advisory here because it does not mutate authoritative game.state.
          // Validate through rules engine
          const validation = bridge.validateAction({
            type: 'castSpell',
            playerId,
            cardId,
            cardName: cardInHand.name,
            manaCost: castSourceZone === 'command' ? (commandZoneManaCost || cardInHand.mana_cost) : cardInHand.mana_cost,
            cardTypes: (cardInHand.type_line || '').split('G��').map((s: string) => s.trim()),
            targets: targets || [],
            manaAlreadyPaid: true,
          });
          
          if (!validation.legal) {
            const reason = String(validation.reason || 'Cannot cast spell');
            const priorityLost = /priority/i.test(reason);
            if (priorityLost || !canCompleteSpellCastAtCurrentTiming(game, playerId, allowResolutionModeCompletion)) {
              Object.assign(getOrInitManaPool(game.state, playerId), poolBeforeSpellPayment);
              restorePlayerCastSpellPaymentCheckpoint(game, playerId, {
                pool: castSpellPaymentCheckpoint.pool,
                tappedPermanentIds: castSpellPaymentCheckpoint.tappedPermanentIds,
                harmonizePermanentId: castSpellPaymentCheckpoint.harmonizePermanentId,
                removedCounters: castSpellPaymentCheckpoint.removedCounters,
              });
              debugWarn(
                1,
                `[castSpellFromHand] RulesBridge rejected post-payment cast of ${cardInHand.name} (${cardId}); aborting applyEvent: ${reason}`,
              );
              socket.emit('error', {
                code: priorityLost ? 'CAST_TIMING_LOST' : 'CAST_REJECTED',
                message: reason,
              });
              return;
            }
            debugWarn(
              1,
              `[castSpellFromHand] RulesBridge rejected post-payment cast of ${cardInHand.name} (${cardId}); continuing with authoritative applyEvent: ${reason}`,
            );
          } else {
            // Execute through rules engine (this will emit events)
            const result = bridge.executeAction({
              type: 'castSpell',
              playerId,
              cardId,
              cardName: cardInHand.name,
              manaCost: castSourceZone === 'command' ? (commandZoneManaCost || cardInHand.mana_cost) : cardInHand.mana_cost,
              cardTypes: (cardInHand.type_line || '').split('G��').map((s: string) => s.trim()),
              targets: targets || [],
              manaAlreadyPaid: true,
              ...((targets as any)?.targetGrouping ? { targetGrouping: (targets as any).targetGrouping } : {}),
            });
            
            if (!result.success) {
              debugWarn(
                1,
                `[castSpellFromHand] RulesBridge failed post-payment cast execution for ${cardInHand.name} (${cardId}); continuing with authoritative applyEvent: ${result.error || 'Failed to cast spell'}`,
              );
            } else {
              // RulesBridge validation passed - log it but still apply to real game state below
              // The RulesBridge only validates and updates its internal state copy, NOT the actual game.state
              // We MUST call applyEvent to update the real game state (remove from hand, add to stack)
              debug(2, `[castSpellFromHand] Player ${playerId} cast ${cardInHand.name} (${cardId}) - RulesBridge validated`);
            }
          }
        } catch (bridgeErr) {
          debugWarn(1, 'Rules engine validation failed, falling back to legacy:', bridgeErr);
          // Continue with legacy logic below
        }
      }
      
      if (alternateCostId === 'suspend') {
        const handCards = Array.isArray((zones as any).hand) ? (zones as any).hand : [];
        const cardIndex = handCards.findIndex((entry: any) => entry && String(entry.id || '') === String(cardId));
        if (cardIndex === -1) {
          socket.emit('error', { code: 'CARD_NOT_IN_HAND', message: 'Card not found in hand.' });
          return;
        }

        const [removedCard] = handCards.splice(cardIndex, 1);
        zones.handCount = handCards.length;
        zones.exile = Array.isArray((zones as any).exile) ? (zones as any).exile : [];

        const suspendedCard = {
          ...removedCard,
          zone: 'exile',
          isSuspended: true,
          timeCounters: suspendInfo.timeCounters,
          suspendedBy: playerId,
        };

        (zones.exile as any[]).push(suspendedCard);
        (zones as any).exileCount = (zones.exile as any[]).length;

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'suspendCard', {
            playerId,
            cardId,
            cardName: cardInHand.name,
            card: { ...suspendedCard },
            suspendCost: resolvedSuspendCost,
            timeCounters: suspendInfo.timeCounters,
            ...(tappedPaymentPermanents.size > 0
              ? { tappedPermanents: Array.from(tappedPaymentPermanents) }
              : {}),
            ...(sacrificedPaymentPermanents.size > 0
              ? { sacrificedPermanents: Array.from(sacrificedPaymentPermanents) }
              : {}),
            ...(paymentManaDelta ? { paymentManaDelta } : {}),
          });
        } catch (eventError) {
          debugWarn(1, 'appendEvent(suspendCard) failed:', eventError);
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, playerId)} suspended ${cardInHand.name} with ${suspendInfo.timeCounters} time counter${suspendInfo.timeCounters === 1 ? '' : 's'}.`,
          ts: Date.now(),
        });

        if (typeof game.bumpSeq === 'function') {
          game.bumpSeq();
        }

        broadcastGame(io, game, gameId);
        return;
      }

      // Always use applyEvent to properly route through state management system
      // This ensures ctx.state.zones is updated (which viewFor uses)
      // The RulesBridge above only validates - it does NOT modify the actual game state
      try {
          const stacked = tryPushCastSpellFromHandToStack({
            socket,
            game,
            playerId,
            cardId,
            cardInHand,
            targets,
            payment,
            alternateCostId,
            castSourceZone,
            convokeTappedCreatures,
            xValue,
            selectedFaceIndex,
            castAsAdventure,
            resolvedTimesKicked,
            giftPromisedForCast,
            isAura,
            auraTargetType,
            auraControllerRestriction,
            spellSpec,
            targetReqs,
            preferParsedTargetReqs,
            multiTargetClauses,
            sourceArr,
            zones,
            hand,
            exile,
            graveyard,
            delayedSpellCopiesSnapshot,
            abortCastSpellPayment,
            allowResolutionModeCompletion,
            castSpellPaymentCheckpoint,
            poolBeforeSpellPayment,
            manaProducedByPermanentBeforeSpellPayment,
            tappedPaymentPermanents,
            sacrificedPaymentPermanents,
            persistedSacrificedPermanentFields,
            manaConsumption,
            manaSpentTotal,
            convergeValue,
            gainsHasteUntilEndOfTurnFromManaSpent,
            cantBeCounteredFromCavern,
            manaFromTreasureSpent,
            manaFromTreasureSpentKnown,
            snowManaSpentByColor,
            snowManaColorsSpent,
            snowManaSpentKnown,
            snowManaSpent,
            snowManaOfSpellColorsSpentKnown,
            snowManaOfSpellColorsSpent,
            additionalCost,
            additionalCostPaid,
            bargainResolved,
            wasBargained,
            teamworkResolved,
            teamworkWasPaid,
            evidenceCollected,
          });
          if (!stacked) return;
          persistedSacrificedPermanentFields = stacked.persistedSacrificedPermanentFields;

      } catch (e) {
        debugError(1, 'Failed to cast spell:', e);
        socket.emit("error", {
          code: "CAST_FAILED",
          message: String(e),
        });
        return;
      }
      
      await persistAndProcessCastSpellFromHand({
        io,
        game,
        gameId,
        playerId,
        cardId,
        cardInHand,
        targets,
        xValue,
        selectedFaceIndex,
        castAsAdventure,
        alternateCostId,
        castSourceZone,
        giftPromisedForCast,
        manaSpentTotal,
        manaConsumption,
        bargainResolved,
        wasBargained,
        convergeValue,
        tappedPaymentPermanents,
        persistedSacrificedPermanentFields,
        convokeTappedCreatures,
        additionalCost,
        additionalCostPaid,
        evidenceCollected,
        manaFromTreasureSpent,
        paymentManaDelta,
        delayedSpellCopiesSnapshot,
      });

    } catch (err: any) {
      debugError(1, `castSpell error for game ${safeGameId}:`, err);
      socket.emit("error", {
        code: "CAST_SPELL_ERROR",
        message: err?.message ?? String(err),
      });
    }

}
