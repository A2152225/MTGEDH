/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: registerInteractionHandlers sockets for replacement-effect
 * ordering (set/get) and activateCycling.
 *
 * Public entry symbols: registerReplacementAndCyclingSocketHandlers.
 */

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { adjustActivationManaCostForPayment } from "../../state/modules/ability-cost-adjustments.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { ResolutionStepType } from "../../state/resolution/index.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  ensureGame,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateManaPayment,
} from "../util";
import { isSplitSecondLockActive } from "./interactionActivateBattlefieldAbilityHelpers.js";
import { getCyclingDefinitionForActivation, resolveCyclingCostX } from "./interactionCyclingActivationDefinitions.js";
import { queueCycleTriggeredAbilities } from "../../state/modules/triggers/cycle.js";
import { queueDiscardTriggeredAbilities } from "../../state/modules/triggers/discard.js";

export function registerReplacementAndCyclingSocketHandlers(io: Server, socket: Socket): void {
  // ============================================================================
  // Replacement Effect Ordering
  // ============================================================================

  /**
   * Set custom replacement effect ordering preference for a player.
   * This allows players to override the default ordering when they want to
   * maximize damage taken (e.g., for Selfless Squire, redirect effects).
   */
  socket.on(
    "setReplacementEffectOrder",
    (payload?: {
      gameId?: unknown;
      effectType?: unknown;
      useCustomOrder?: unknown;
      customOrder?: unknown;
      mode?: unknown;
    }) => {
    const gameId = payload?.gameId;
    const effectType = payload?.effectType;
    const useCustomOrder = payload?.useCustomOrder;
    const customOrder = payload?.customOrder;
    const mode = payload?.mode;

    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== "string") return;
    if (
      effectType !== "damage" &&
      effectType !== "life_gain" &&
      effectType !== "counters" &&
      effectType !== "tokens"
    ) {
      return;
    }
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    // Initialize replacement effect preferences if needed
    (game.state as any).replacementEffectPreferences = (game.state as any).replacementEffectPreferences || {};
    (game.state as any).replacementEffectPreferences[pid] = (game.state as any).replacementEffectPreferences[pid] || {};
    
    const normalizedMode: "minimize" | "maximize" | "custom" | "auto" = (() => {
      if (mode === "minimize" || mode === "maximize" || mode === "custom" || mode === "auto") return mode;

      // Back-compat: previous API was a boolean toggle.
      // For damage: toggle means maximize vs minimize.
      // For others: toggle means custom vs auto.
      if (effectType === "damage") {
        return useCustomOrder ? 'maximize' : 'minimize';
      }
      return useCustomOrder ? 'custom' : 'auto';
    })();

    const normalizedCustomOrder = Array.isArray(customOrder) ? (customOrder as string[]) : [];
    const normalizedUseCustomOrder = normalizedMode === 'maximize' || normalizedMode === 'custom';

    (game.state as any).replacementEffectPreferences[pid][effectType] = {
      mode: normalizedMode,
      useCustomOrder: normalizedUseCustomOrder,
      customOrder: normalizedCustomOrder,
      updatedAt: Date.now(),
    };

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    const orderDescription = normalizedMode === 'custom'
      ? `custom order: ${normalizedCustomOrder.join(' → ') || '(none)'}`
      : normalizedMode === 'maximize'
        ? 'maximize'
        : normalizedMode === 'minimize'
          ? 'minimize'
          : 'default (optimal) order';
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} set ${effectType} replacement effect ordering to ${orderDescription}.`,
      ts: Date.now(),
    });

    // Notify player of the change
    socket.emit("replacementEffectOrderUpdated", {
      gameId,
      effectType,
      mode: normalizedMode,
      useCustomOrder: normalizedUseCustomOrder,
      customOrder: normalizedCustomOrder,
    });

    broadcastGame(io, game, gameId);
  });

  // Fight target selection is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy counterTargetChosen handler removed - now using resolution queue system

  // moveCounterSourceChosen/moveCounterDestinationChosen are removed.
  // Counter movement is handled via Resolution Queue (ResolutionStepType.COUNTER_MOVEMENT).

  /**
   * Get current replacement effect ordering preferences for a player
   */
  socket.on(
    "getReplacementEffectOrder",
    (payload?: { gameId?: unknown; effectType?: unknown }) => {
    const gameId = payload?.gameId;
    const effectType = payload?.effectType;

    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== "string") return;
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    const preferences = (game.state as any).replacementEffectPreferences?.[pid] || {};
    
    if (
      effectType === "damage" ||
      effectType === "life_gain" ||
      effectType === "counters" ||
      effectType === "tokens"
    ) {
      socket.emit("replacementEffectOrderResponse", {
        gameId,
        effectType,
        preference: preferences[effectType] || { useCustomOrder: false, customOrder: [] },
      });
    } else {
      // Return all preferences
      socket.emit("replacementEffectOrderResponse", {
        gameId,
        preferences,
      });
    }
  });

  // Legacy proliferateConfirm handler removed - now using resolution queue system
  // See processPendingProliferate() and handleProliferateResponse() in resolution.ts

  // Legacy confirmAnyColorManaChoice handler removed - now using resolution queue system
  // See resolution.ts MANA_COLOR_SELECTION handling

  // Tap/Untap target selection is handled via Resolution Queue (see socket/resolution.ts)

  // Counter movement is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy confirmCounterMovement handler removed - now using resolution queue system

  // Station creature selection is handled via Resolution Queue (see socket/resolution.ts)

  // Forbidden Orchard opponent selection is handled via Resolution Queue (see socket/resolution.ts)

  // Legacy confirmManaDistribution handler removed - now using resolution queue system
  // See resolution.ts MANA_COLOR_SELECTION handling

  // Cycling and typecycling - discard a card from hand, pay cost, then draw or search.
  socket.on(
    "activateCycling",
    (payload?: { gameId?: unknown; cardId?: unknown; abilityId?: unknown; xValue?: unknown }) => {
      const gameId = payload?.gameId;
      const cardId = payload?.cardId;
      const abilityId = payload?.abilityId;
      const xValue = typeof payload?.xValue === "number" && Number.isFinite(payload.xValue)
        ? Math.max(0, Math.floor(Number(payload.xValue)))
        : undefined;
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!pid || socketIsSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;
    if (!cardId || typeof cardId !== 'string') return;
    if (abilityId != null && typeof abilityId !== 'string') return;
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    // Split Second: cycling is an activated ability (non-mana).
    if (isSplitSecondLockActive(game.state)) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't activate abilities while a spell with split second is on the stack.",
      });
      return;
    }
    const zones = (game.state as any)?.zones?.[pid];
    if (!zones || !zones.hand) {
      socket.emit("error", {
        code: "NO_HAND",
        message: "You have no hand to cycle from",
      });
      return;
    }

    // Find the card in hand
    const handIndex = zones.hand.findIndex((c: any) => c.id === cardId);
    if (handIndex === -1) {
      socket.emit("error", {
        code: "CARD_NOT_IN_HAND",
        message: "Card not found in hand",
      });
      return;
    }

    const card = zones.hand[handIndex];
    const cardName = card.name || "Unknown";
    const oracleText = String(card.oracle_text || '');
    const normalizedAbilityId = typeof abilityId === 'string' && abilityId.trim().length > 0 ? abilityId.trim() : 'cycling';
    const isParserCyclingAbilityId = new RegExp(`^${String(cardId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-cycling-\\d+$`, 'i').test(normalizedAbilityId);
    if (normalizedAbilityId !== 'cycling' && !isParserCyclingAbilityId) {
      socket.emit('error', {
        code: 'INVALID_ABILITY_ID',
        message: `${normalizedAbilityId} is not a cycling ability for ${cardName}`,
      });
      return;
    }

    const cyclingDefinition = getCyclingDefinitionForActivation(oracleText, normalizedAbilityId, cardId);
    if (!cyclingDefinition) {
      socket.emit("error", {
        code: "NO_CYCLING",
        message: `${cardName} does not have cycling`,
      });
      return;
    }

    const cyclingCostStr = cyclingDefinition.cost;
    // Cycling {X}{1}{U} (Shark Typhoon): X is chosen on activation and paid as part of the cost.
    const cyclingHasX = /\{X\}/i.test(cyclingCostStr);
    if (cyclingHasX && xValue === undefined) {
      socket.emit("error", {
        code: "X_VALUE_REQUIRED",
        message: `Choose a value for X before cycling ${cardName}.`,
      });
      return;
    }
    const cyclingXValue = cyclingHasX ? xValue : undefined;
    const resolvedCyclingCost = cyclingHasX ? resolveCyclingCostX(cyclingCostStr, xValue as number) : cyclingCostStr;
    const costAdjustment = adjustActivationManaCostForPayment({
      state: game.state,
      activatorId: String(pid),
      sourceCard: card,
      sourceZone: 'hand',
      sourceController: String(pid),
      sourceId: String(cardId),
      isManaAbility: false,
      manaCostString: resolvedCyclingCost,
      sourceName: cardName,
    });
    const effectiveCyclingCost = costAdjustment.adjustedManaCost || resolvedCyclingCost;
    const parsedCost = parseManaCost(effectiveCyclingCost);
    const manaPool = getOrInitManaPool(game.state, pid);

    // Check if player can pay the cycling cost
    const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
    const validationError = validateManaPayment(
      totalAvailable,
      parsedCost.colors,
      parsedCost.generic
    );

    if (validationError) {
      socket.emit("error", {
        code: "INSUFFICIENT_MANA",
        message: validationError,
      });
      return;
    }

    // Consume the mana from the pool (costs are paid when activating)
    consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} paid ${effectiveCyclingCost} to activate ${cyclingDefinition.keywordLabel} on ${cardName}.`,
      ts: Date.now(),
    });

    // Discard the card (cost is paid immediately)
    zones.hand.splice(handIndex, 1);
    zones.graveyard = zones.graveyard || [];
    const cyclingCtx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as any;
    pushCardToPlayerGraveyardWithReplacements(cyclingCtx, String(pid), card, zones.graveyard);
    zones.handCount = zones.hand.length;
    zones.graveyardCount = zones.graveyard.length;

    game.state.stack = game.state.stack || [];
    const abilityStackId = `ability_cycling_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: abilityStackId,
      type: 'ability',
      controller: pid,
      source: cardId,
      sourceName: cardName,
      description: cyclingDefinition.stackDescription,
      abilityType: cyclingDefinition.kind,
      abilityId: normalizedAbilityId,
      cardId: cardId,
      cardName: cardName,
      searchCriteria: cyclingDefinition.searchCriteria,
      searchFilter: cyclingDefinition.searchFilter,
      ...(typeof cyclingXValue === "number" ? { xValue: cyclingXValue } : null),
    } as any);

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${cyclingDefinition.keywordLabel} on ${cardName} (on the stack).`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    appendEvent(gameId, (game.state as any).seq ?? 0, "activateCycling", {
      playerId: pid,
      cardId,
      cardName,
      abilityId: normalizedAbilityId,
      cyclingCost: effectiveCyclingCost,
      ...(typeof cyclingXValue === "number" ? { xValue: cyclingXValue } : null),
      stackId: abilityStackId,
      stackAbilityType: cyclingDefinition.kind,
      stackDescription: cyclingDefinition.stackDescription,
      searchCriteria: cyclingDefinition.searchCriteria,
      searchFilter: cyclingDefinition.searchFilter,
    });

    // "When you cycle this card" and "whenever you/a player cycle(s) [or discard(s)]" triggers go on
    // the stack above the cycling ability; cycling also discards the card (discard triggers).
    const cycledCardSnapshot = { ...card };
    queueCycleTriggeredAbilities(cyclingCtx, String(pid), cycledCardSnapshot, { xValue: cyclingXValue });
    queueDiscardTriggeredAbilities(cyclingCtx, String(pid), [cycledCardSnapshot], { fromCycling: true });

    broadcastGame(io, game, gameId);
    }
  );
}
