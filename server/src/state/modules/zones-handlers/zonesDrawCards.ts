// server/src/state/modules/zones-handlers/zonesDrawCards.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: DrawCardsOptions, persistDrawCardsEvent, drawCards,
// drawCardsByIds, processDrawTriggers.
// Public entry symbols: DrawCardsOptions, persistDrawCardsEvent, drawCards,
// drawCardsByIds, processDrawTriggers.

import type { KnownCardRef, PlayerID } from "../../../../../shared/src/types.js";
import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { appendEvent } from "../../../db/index.js";
import { applyEmptyLibraryDrawConsequences } from "../game-state-effects.js";
import { evaluateDrawReplacementEvent } from "../replacement-effects.js";
import { summarizeDrawAmountReplacements } from "../replacementEffectSpec.js";
import { getCardDrawTriggers } from "../triggers/card-draw.js";
import { orderTriggersByAPNAP } from "../triggers/ordering.js";
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from "../triggers/target-metadata.js";
import { queueDredgeDrawReplacementStep } from "./zonesDrawReplacementDredgeQueue.js";
import { queueSkipDrawReplacementStep } from "./zonesDrawReplacementSkipDrawQueue.js";
import { queueZursWeirdingDrawReplacementStep } from "./zonesDrawReplacementZursQueue.js";
import { applyOrQueueOpponentLibraryDrawReplacement } from "./zonesDrawReplacementOpponentLibraryExile.js";

export type DrawCardsOptions = {
  /** Parent event (nextStep / dredge|zur choice resolve) already restores draws on replay. */
  skipEventPersistence?: boolean;
  reason?: string;
};

export function persistDrawCardsEvent(
  ctx: GameContext,
  playerId: string,
  drawnCards: KnownCardRef[],
  options?: DrawCardsOptions,
): void {
  if (options?.skipEventPersistence) return;
  if ((ctx as any)?.isReplaying) return;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  const drawnCardIds = (Array.isArray(drawnCards) ? drawnCards : [])
    .map((card: any) => String(card?.id || '').trim())
    .filter(Boolean);
  const count = drawnCardIds.length > 0 ? drawnCardIds.length : (Array.isArray(drawnCards) ? drawnCards.length : 0);
  if (count <= 0) return;

  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      'drawCards',
      {
        playerId,
        count,
        ...(drawnCardIds.length > 0 ? { drawnCardIds } : {}),
        ...(options?.reason ? { reason: options.reason } : {}),
      },
    );
  } catch (err) {
    debugWarn(1, '[drawCards] appendEvent(drawCards) failed:', err);
  }
}

export function drawCards(ctx: GameContext, playerId: PlayerID, count: number, options?: DrawCardsOptions): KnownCardRef[] {
  const zones = ctx.state.zones = ctx.state.zones || {};
  const drawn: KnownCardRef[] = [];
  const normalizedCount = Math.max(0, Math.floor(Number(count || 0)));
  
  // Track draws this turn for miracle abilities (Rule 702.94)
  (ctx.state as any).cardsDrawnThisTurn = (ctx.state as any).cardsDrawnThisTurn || {};
  const previousDrawCounts: Record<string, number> = {};
  const drawnByPlayer: Record<string, KnownCardRef[]> = {};
  const emptyDrawByPlayer: Record<string, boolean> = {};
  const drawReplacementChoices: any[] = [];
  const getPreviousDrawCount = (pid: string) => {
    if (previousDrawCounts[pid] === undefined) {
      previousDrawCounts[pid] = Number((ctx.state as any).cardsDrawnThisTurn?.[pid] || 0);
    }
    return previousDrawCounts[pid];
  };
  const getZone = (pid: string) => {
    return zones[pid] || (zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  };
  const drawOneForPlayer = (pid: string, returnToOriginal: boolean): boolean => {
    const z = getZone(pid);
    let lib = ctx.libraries.get(pid as PlayerID);
    const zoneLib = Array.isArray((z as any).library) ? (z as any).library : undefined;
    if (!Array.isArray(lib) || lib.length === 0) {
      lib = (Array.isArray(zoneLib) && zoneLib.length > 0)
        ? zoneLib
        : (Array.isArray(lib) ? lib : []);
    }
    while (lib.length > 0) {
      const c = lib.shift()!;
      const cardId = String((c as any)?.id || '').trim();
      if (cardId) {
        const alreadyInHand = (Array.isArray(z.hand) ? z.hand : []).some(
          (entry: any) => String(entry?.id || '').trim() === cardId,
        );
        if (alreadyInHand) {
          debug(2, `[drawCards] skipped library ghost already in hand`, { playerId: pid, cardId });
          ctx.libraries.set(pid as PlayerID, lib);
          (z as any).library = lib;
          z.libraryCount = lib.length;
          continue;
        }
      }
      drawnByPlayer[pid] = drawnByPlayer[pid] || [];
      const drawNumber = getPreviousDrawCount(pid) + drawnByPlayer[pid].length + 1;
      if (drawNumber === 1) {
        (c as any).isFirstDrawnThisTurn = true;
        (c as any).drawnAt = Date.now();
      }

      (z.hand as any[]).push(c);
      drawnByPlayer[pid].push(c);
      if (returnToOriginal) drawn.push(c);
      ctx.libraries.set(pid as PlayerID, lib);
      z.handCount = (z.hand as any[]).length;
      z.library = lib;
      z.libraryCount = lib.length;
      return true;
    }
    emptyDrawByPlayer[pid] = true;
    debug(2, `[drawCards] Player ${pid} attempted to draw from empty library`);
    ctx.libraries.set(pid as PlayerID, lib);
    z.library = lib;
    z.libraryCount = lib.length;
    return false;
  };

  if (normalizedCount >= 2) {
    const batchReplacement = evaluateDrawReplacementEvent({
      state: ctx.state,
      playerId: String(playerId),
      count: normalizedCount,
    });

    if (batchReplacement.effectId === 'draw-replaced-by-shared-draw') {
      const originalPlayerId = String(playerId);
      drawOneForPlayer(originalPlayerId, true);
      for (const additionalDraw of ((batchReplacement.metadata as any)?.additionalDraws || [])) {
        const additionalPlayerId = String(additionalDraw?.playerId || '').trim();
        const additionalCount = Math.max(0, Math.floor(Number(additionalDraw?.count || 0)));
        if (!additionalPlayerId || additionalCount <= 0) continue;
        for (let i = 0; i < additionalCount; i++) {
          if (!drawOneForPlayer(additionalPlayerId, false)) break;
        }
      }
    }
  }

  if (drawn.length === 0 && Object.keys(drawnByPlayer).length === 0) {
  
    for (let i = 0; i < normalizedCount; i++) {
      const originalPlayerId = String(playerId);
      const currentStep = String((ctx.state as any).step || (ctx.state as any).phase || '').toLowerCase();
      const drawNumber = getPreviousDrawCount(originalPlayerId) + (drawnByPlayer[originalPlayerId]?.length || 0) + 1;
      const replacement = evaluateDrawReplacementEvent({
        state: ctx.state,
        playerId: originalPlayerId,
        count: 1,
        drawIndex: drawNumber,
        metadata: {
          isFirstDrawStepDraw: currentStep.includes('draw') && drawNumber === 1,
          isDrawStepDraw: currentStep.includes('draw'),
          skipDredgeReplacement: (ctx as any)._suppressDredgeReplacement === true,
          skipZursWeirdingReplacement: (ctx as any)._suppressZursWeirdingReplacement === true,
          skipSkipDrawReplacement: (ctx as any)._suppressSkipDrawReplacement === true,
          remainingDrawCountAfterChoice: Math.max(0, normalizedCount - i - 1),
        },
      });

      if (replacement.choiceRequired && replacement.effectId === 'zurs-weirding-draw-replacement') {
        drawReplacementChoices.push(replacement.metadata);
        const queued = queueZursWeirdingDrawReplacementStep(
          ctx,
          originalPlayerId,
          replacement.metadata,
          Math.max(0, normalizedCount - i - 1),
        );
        const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
        if (queued || ((ctx as any).isReplaying && replayNextEventType === 'zursWeirdingDrawReplacementResolve')) {
          break;
        }
      }

      if (replacement.choiceRequired && replacement.effectId === 'dredge-draw-replacement-choice') {
        drawReplacementChoices.push(replacement.metadata);
        const queued = queueDredgeDrawReplacementStep(
          ctx,
          originalPlayerId,
          replacement.metadata,
          drawNumber,
          Math.max(0, normalizedCount - i - 1),
        );
        const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
        if (queued || ((ctx as any).isReplaying && replayNextEventType === 'dredgeDrawReplacementResolve')) {
          break;
        }
      }

      if (replacement.choiceRequired && replacement.effectId === 'skip-draw-step-replacement') {
        drawReplacementChoices.push(replacement.metadata);
        const queued = queueSkipDrawReplacementStep(
          ctx,
          originalPlayerId,
          {
            ...(replacement.metadata || {}),
            sourceName: replacement.sourceName,
            sourcePermanentId: String((replacement.metadata as any)?.sourcePermanentId || '').trim(),
          },
          Math.max(0, normalizedCount - i - 1),
        );
        const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
        if (queued || ((ctx as any).isReplaying && replayNextEventType === 'skipDrawReplacementResolve')) {
          break;
        }
      }

      if (replacement.choiceRequired && replacement.effectId === 'draw-replaced-by-exile-opponent-library') {
        const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
        if ((ctx as any).isReplaying && replayNextEventType === 'opponentLibraryDrawReplacementResolve') {
          break;
        }
        drawReplacementChoices.push(replacement.metadata);
        const queued = applyOrQueueOpponentLibraryDrawReplacement(
          ctx,
          originalPlayerId,
          {
            ...(replacement.metadata || {}),
            sourceName: replacement.sourceName,
            sourcePermanentId: String((replacement.metadata as any)?.sourcePermanentId || '').trim(),
          },
          Math.max(0, normalizedCount - i - 1),
        );
        if (queued) {
          break;
        }
        continue;
      }

      if (replacement.effectId === 'draw-replaced-by-opponent') {
        const replacementPlayerId = String((replacement.metadata as any)?.replacementPlayerId || '').trim();
        if (replacementPlayerId) {
          if (!drawOneForPlayer(replacementPlayerId, false)) break;
          continue;
        }
      }

      const extraDraw = summarizeDrawAmountReplacements(ctx.state, originalPlayerId, {
        isFirstDrawStepDraw: currentStep.includes('draw') && drawNumber === 1,
      });
      const cardsThisEvent = Math.max(1, (1 + extraDraw.extraCards) * extraDraw.multiplier);
      let stopDrawing = false;
      for (let d = 0; d < cardsThisEvent; d++) {
        if (!drawOneForPlayer(originalPlayerId, true)) {
          stopDrawing = true;
          break;
        }
      }
      if (stopDrawing) break;
    }
  }

  if (drawReplacementChoices.length > 0) {
    (ctx.state as any).lastDrawReplacementChoices = drawReplacementChoices;
  }
  
  // Update draw count for this turn
  for (const [pid, cards] of Object.entries(drawnByPlayer)) {
    (ctx.state as any).cardsDrawnThisTurn[pid] = getPreviousDrawCount(pid) + cards.length;
  }
  
  // Process draw triggers (Psychosis Crawler, etc.)
  for (const [pid, cards] of Object.entries(drawnByPlayer)) {
    if (cards.length > 0) {
      processDrawTriggers(ctx, pid as PlayerID, cards.length);
    }
  }
  
  // Handle empty library draw (Rule 704.5b) for ANY mandatory draw attempt —
  // draw step, spell/ability resolution, combat damage triggers, etc.
  // Optional "may draw" effects only call drawCards when the player chooses to draw.
  const emptyAttemptPlayerIds = Object.keys(emptyDrawByPlayer);
  if (emptyAttemptPlayerIds.length > 0) {
    // Keep the flag so a later SBA pass can still reconcile if needed.
    (ctx.state as any).attemptedEmptyLibraryDraw = (ctx.state as any).attemptedEmptyLibraryDraw || {};
    for (const pid of emptyAttemptPlayerIds) {
      (ctx.state as any).attemptedEmptyLibraryDraw[pid] = true;
    }

    const outcome = applyEmptyLibraryDrawConsequences(ctx, emptyAttemptPlayerIds);
    for (const pid of outcome.wins) {
      debug(2, `[drawCards] Player ${pid} WINS from empty-library draw replacement`);
      delete (ctx.state as any).attemptedEmptyLibraryDraw[pid];
    }
    for (const pid of outcome.applied) {
      debug(2, `[drawCards] Player ${pid} LOSES from empty-library draw`);
      delete (ctx.state as any).attemptedEmptyLibraryDraw[pid];
    }
    for (const pid of outcome.ignored) {
      debug(2, `[drawCards] Player ${pid} empty-library draw ignored (can't lose / already out)`);
      delete (ctx.state as any).attemptedEmptyLibraryDraw[pid];
    }
  }
  
  for (const [pid, cards] of Object.entries(drawnByPlayer)) {
    if (Array.isArray(cards) && cards.length > 0) {
      persistDrawCardsEvent(ctx, pid, cards, options);
    }
  }

  ctx.bumpSeq();
  return drawn;
}

export function drawCardsByIds(ctx: GameContext, playerId: PlayerID, cardIds: string[]): KnownCardRef[] {
  const normalizedIds = (Array.isArray(cardIds) ? cardIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (normalizedIds.length === 0) return [];

  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any);
  const fromMap = ctx.libraries.get(playerId);
  const fromZones = Array.isArray((z as any).library) ? (z as any).library : [];
  const lib = (Array.isArray(fromMap) && fromMap.length > 0)
    ? fromMap
    : (fromZones.length > 0 ? fromZones : (Array.isArray(fromMap) ? fromMap : []));

  const byId = new Map<string, KnownCardRef>();
  for (let i = lib.length - 1; i >= 0; i--) {
    const card = lib[i] as any;
    const id = String(card?.id || '').trim();
    if (!id || !normalizedIds.includes(id)) continue;
    const [removed] = lib.splice(i, 1);
    byId.set(id, removed);
  }

  const drawn: KnownCardRef[] = [];
  (ctx.state as any).cardsDrawnThisTurn = (ctx.state as any).cardsDrawnThisTurn || {};
  const previousDrawCount = Number((ctx.state as any).cardsDrawnThisTurn?.[playerId] || 0);

  for (const id of normalizedIds) {
    const card = byId.get(id);
    if (!card) continue;
    const alreadyInHand = (Array.isArray(z.hand) ? z.hand : []).some(
      (entry: any) => String(entry?.id || '').trim() === id,
    );
    if (alreadyInHand) continue;
    const drawNumber = previousDrawCount + drawn.length + 1;
    if (drawNumber === 1) {
      (card as any).isFirstDrawnThisTurn = true;
      (card as any).drawnAt = Date.now();
    }
    (z.hand as any[]).push(card);
    drawn.push(card);
  }

  ctx.libraries.set(playerId, lib);
  z.handCount = (z.hand as any[]).length;
  z.library = lib;
  z.libraryCount = lib.length;

  if (drawn.length > 0 && !(ctx as any).isReplaying) {
    (ctx.state as any).cardsDrawnThisTurn[playerId] = previousDrawCount + drawn.length;
    processDrawTriggers(ctx, playerId, drawn.length);
  }

  ctx.bumpSeq();
  return drawn;
}

/**
 * Process draw triggers - called when a player draws cards
 * Handles:
 * - Psychosis Crawler: "Whenever you draw a card, each opponent loses 1 life"
 * - Niv-Mizzet: "Whenever you draw a card, deal 1 damage to any target"
 */
export function processDrawTriggers(ctx: GameContext, drawingPlayerId: PlayerID, cardsDrawn: number) {
  if ((ctx as any)?.isReplaying) return;

  const battlefield = ctx.state.battlefield || [];
  const players = (ctx.state as any).players || [];
  const gameId = String((ctx as any).gameId || '').trim();

  const snapshotPermanentForTriggerContext = (permanent: any): any | undefined => {
    if (!permanent || typeof permanent !== 'object') return undefined;
    return {
      id: String(permanent?.id || ''),
      controller: String(permanent?.controller || ''),
      owner: String(permanent?.owner || permanent?.controller || ''),
      tapped: permanent?.tapped === true,
      counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
      card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
    };
  };

  const sourcePermanentSnapshotFor = (permanentId: string): any | undefined => {
    const normalizedPermanentId = String(permanentId || '').trim();
    if (!normalizedPermanentId) return undefined;
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === normalizedPermanentId);
    return snapshotPermanentForTriggerContext(permanent);
  };

  const drawTriggers = orderTriggersByAPNAP(ctx, getCardDrawTriggers(ctx, String(drawingPlayerId)));
  const queueGenericDrawTrigger = (trigger: any, drawIndex: number) => {
    const effect = String(trigger?.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    const sourceName = String(trigger?.cardName || '').trim();
    const sourceNameLower = sourceName.toLowerCase();
    const effectLower = effect.toLowerCase();
    if (!effect) {
      return;
    }
    if (sourceNameLower.includes('smothering tithe') || /\bmay pay \{[^}]+\}/i.test(effectLower)) {
      return;
    }
    if (hasUnsupportedTargetRequirement(targetMetadata)) {
      return;
    }

    ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = sourcePermanentSnapshotFor(trigger.permanentId);
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: drawingPlayerId,
      targetPlayer: drawingPlayerId,
      effectData: {
        drawingPlayerId,
        drawIndex,
      },
    } as any;

    (ctx.state.stack as any[]).push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          targetPlayer: drawingPlayerId,
          triggeringPlayer: drawingPlayerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[drawTrigger] Failed to persist generic draw trigger:', err);
      }
    }
  };

  if (cardsDrawn > 0 && drawTriggers.length > 0) {
    for (let index = 0; index < cardsDrawn; index++) {
      for (const trigger of drawTriggers) {
        queueGenericDrawTrigger(trigger, index + 1);
      }
    }
  }
  
  const smotheringTithePermanents = orderTriggersByAPNAP(
    ctx,
    battlefield
      .filter((perm: any) => {
        if (!perm || !perm.card || perm.controller === drawingPlayerId) return false;
        const permName = String(perm.card.name || '').toLowerCase();
        const oracleText = String(perm.card.oracle_text || '').toLowerCase();
        return permName.includes('smothering tithe') ||
          (oracleText.includes('whenever an opponent draws a card') &&
            oracleText.includes('may pay {2}') &&
            oracleText.includes('treasure token'));
      })
      .map((perm: any) => ({ controllerId: perm.controller, permanent: perm })),
  );

  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const permName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Niv-Mizzet: triggers for damage (would need stack implementation for targeting)
    if (permName.includes('niv-mizzet') && 
        oracleText.includes('whenever you draw') && 
        perm.controller === drawingPlayerId) {
      debug(2, `[drawTrigger] Niv-Mizzet: ${cardsDrawn} damage trigger(s)`);
    }

  }

  for (const { permanent: perm } of smotheringTithePermanents) {
      ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];

      for (let index = 0; index < cardsDrawn; index++) {
        const triggerId = uid('trigger');
        const sourcePermanentSnapshot = snapshotPermanentForTriggerContext(perm);
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: perm.controller,
          source: perm.id,
          sourceName: perm.card?.name || 'Smothering Tithe',
          description: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
          effect: 'Create a Treasure token',
          triggerType: 'smothering_tithe',
          mandatory: true,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          targetPlayer: drawingPlayerId,
          triggeringPlayer: drawingPlayerId,
          effectData: {
            drawingPlayerId,
            paymentCost: '{2}',
            benefitIfNotPaid: 'Create a Treasure token',
          },
        } as any;

        (ctx.state.stack as any[]).push(stackItem);

        if (gameId && gameId !== 'unknown') {
          try {
            appendEvent(gameId, Number((ctx as any).seq?.value ?? 0), 'pushTriggeredAbility', {
              triggerId,
              sourceId: perm.id,
              permanentId: perm.id,
              sourceName: perm.card?.name || 'Smothering Tithe',
              controllerId: perm.controller,
              description: stackItem.description,
              triggerType: 'smothering_tithe',
              effect: 'Create a Treasure token',
              mandatory: true,
              targetPlayer: drawingPlayerId,
              triggeringPlayer: drawingPlayerId,
              ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
              ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
              effectData: stackItem.effectData,
            });
          } catch (err) {
            debugWarn(1, '[drawTrigger] Failed to persist Smothering Tithe trigger:', err);
          }
        }
      }
  }
}

