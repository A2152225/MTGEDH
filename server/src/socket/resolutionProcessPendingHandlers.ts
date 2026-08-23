/**
 * socket/resolutionProcessPendingHandlers.ts
 *
 * Migrates legacy pending* state (cascade/scry/surveil/ponder/etc.) into the
 * resolution queue after stack resolution. Extracted from resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../state/types.js";
import { broadcastGame, appendGameEvent } from "./util.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";
import { processPendingOracleIrCompoundResumeOnContext } from "../state/modules/oracleIrServerZoneSync.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../state/modules/oracleIrDeferredStackFinalize.js";
import { upsertDurablePermission, buildDurablePlayableFromExilePermission } from "../state/modules/durable-permissions.js";
import {
  cloneCascadeLibrary,
  cloneExileStateForEvent,
  appendQueuedResolutionPromptEvent,
} from "./resolutionCloneQueuedPromptUtils.js";

export function upsertOneShotCastFromExilePromptPermission(
  game: any,
  playerId: PlayerID,
  card: any,
  sourceName: string,
  sourceId?: string,
): void {
  const cardId = String(card?.id || '').trim();
  if (!game?.state || !cardId) return;

  const turnNumber = Number((game.state as any)?.turnNumber ?? 0);
  upsertDurablePermission(game.state as any, buildDurablePlayableFromExilePermission({
    playerId,
    cardIds: [cardId],
    action: 'cast',
    duration: 'one_shot',
    turnApplied: turnNumber,
    expiresAtTurn: turnNumber,
    sourceId: String(sourceId || '').trim() || undefined,
    sourceName,
    costMode: 'without_paying_mana_cost',
    usageLimit: { type: 'one_shot', maxUses: 1 },
  }));
}


/**
 * Process pending cascade triggers and migrate them to the resolution queue
 * This is called after spell resolution to check for cascades
 */
export async function processPendingCascades(
  io: Server,
  game: any,
  gameId: string
): Promise<void> {
  try {
    const pending = (game.state as any).pendingCascade;
    if (!pending) return;
    
    const { cardManaValue, uid } = await import("../state/utils.js");
    
    for (const playerId of Object.keys(pending)) {
      const queue = pending[playerId];
      if (!Array.isArray(queue) || queue.length === 0) continue;
      
      const entry = queue[0];
      if (!entry || entry.awaiting) continue;
      
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      const exiled: any[] = [];
      let hitCard: any | null = null;
      while (lib.length > 0) {
        const card = lib.shift() as any;
        if (!card) break;
        exiled.push(card);
        const tl = (card.type_line || "").toLowerCase();
        const isLand = tl.includes("land");
        const mv = cardManaValue(card);
        if (!isLand && mv < entry.manaValue) {
          hitCard = card;
          break;
        }
      }
      
      const zones = game.state.zones = game.state.zones || {};
      const z = zones[playerId] = zones[playerId] || { 
        hand: [], 
        handCount: 0, 
        libraryCount: lib.length, 
        graveyard: [], 
        graveyardCount: 0 
      };
      z.libraryCount = lib.length;
      
      // If nothing hit, bottom exiled in a random order and persist the resolved library state.
      if (!hitCard) {
        const randomized = [...exiled];
        for (let i = randomized.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
        }

        appendGameEvent(game, gameId, 'cascadeResolve', {
          playerId,
          sourceCardId: entry.sourceCardId,
          sourceName: entry.sourceName || 'Cascade',
          cascadeNumber: entry.instance || 1,
          totalCascades: queue.length,
          cast: false,
          hitCard: null,
          exiledCards: exiled.map((card: any) => ({ ...card })),
          remainingLibraryIds: cloneCascadeLibrary(lib).map((card: any) => String(card?.id || '')).filter(Boolean),
          bottomCardIds: randomized.map((card: any) => String(card?.id || '')).filter(Boolean),
        });
        continue;
      }
      
      // Mark as awaiting and prepare step data
      entry.awaiting = true;
      entry.hitCard = hitCard;
      entry.exiledCards = exiled;
      if (!entry.effectId) {
        entry.effectId = uid("cascade");
      }
      
      // Convert to KnownCardRef format for resolution queue
      const exiledRefs = exiled.map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));
      
      const hitRef = {
        id: hitCard.id,
        name: hitCard.name,
        type_line: hitCard.type_line,
        oracle_text: hitCard.oracle_text,
        imageUrl: hitCard.image_uris?.normal,
        mana_cost: hitCard.mana_cost,
        cmc: hitCard.cmc,
      };
      
      // Add to resolution queue
      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CASCADE,
        playerId,
        description: `Cascade - Cast ${hitCard.name}?`,
        mandatory: true,
        sourceId: entry.sourceCardId,
        sourceName: entry.sourceName || "Cascade",
        cascadeNumber: entry.instance || 1,
        totalCascades: queue.length,
        manaValue: entry.manaValue,
        hitCard: hitRef,
        exiledCards: exiledRefs,
        effectId: entry.effectId,
      });

      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId,
        sourceId: String(entry.sourceCardId || '').trim(),
        queuedResolutionStep: step,
        additionalPayload: {
          remainingLibraryIds: cloneCascadeLibrary(lib).map((card: any) => String(card?.id || '')).filter(Boolean),
          pendingCascadeEntry: {
            sourceName: entry.sourceName || 'Cascade',
            sourceCardId: entry.sourceCardId,
            manaValue: entry.manaValue,
            instance: entry.instance || 1,
            awaiting: true,
            effectId: entry.effectId,
            hitCard: hitCard ? { ...hitCard } : null,
            exiledCards: exiled.map((card: any) => ({ ...card })),
          },
        },
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingCascades] Error:", err);
  }
}

/**
 * Process pending scry from legacy state and migrate to resolution queue
 * 
 * This is called after stack resolution or when scry effects are created.
 * Migrates from pendingScry state to the resolution queue system.
 */
export function processPendingScry(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingScry;
    if (!pending || typeof pending !== 'object') return;
    
    for (const playerId of Object.keys(pending)) {
      const rawEntry = pending[playerId];
      const entry = typeof rawEntry === 'number' ? { count: rawEntry } : rawEntry;
      const scryCount = Number(entry?.count || 0);
      if (!Number.isFinite(scryCount) || scryCount <= 0) continue;
      if (entry?.queued === true) continue;
      
      // Get library
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      // Peek at the top N cards
      const actualCount = Math.min(scryCount, lib.length);
      if (actualCount === 0) {
        // No cards to scry, skip
        delete pending[playerId];
        continue;
      }
      
      const cards = lib.slice(0, actualCount).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId,
        description: `Scry ${actualCount}`,
        mandatory: true,
        cards,
        scryCount: actualCount,
      });

      pending[playerId] = {
        ...(typeof rawEntry === 'object' && rawEntry ? rawEntry : {}),
        count: actualCount,
        queued: true,
      };
    }
  } catch (err) {
    debugWarn(1, "[processPendingScry] Error:", err);
  }
}

export function processPendingSurveil(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingSurveil;
    if (!pending || typeof pending !== 'object') return;

    for (const playerId of Object.keys(pending)) {
      const rawEntry = pending[playerId];
      const entry = typeof rawEntry === 'number' ? { count: rawEntry } : rawEntry;
      const surveilCount = Number(entry?.count || 0);
      if (!Number.isFinite(surveilCount) || surveilCount <= 0) continue;
      if (entry?.queued === true) continue;

      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;

      const actualCount = Math.min(surveilCount, lib.length);
      if (actualCount === 0) {
        delete pending[playerId];
        continue;
      }

      const cards = lib.slice(0, actualCount).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SURVEIL,
        playerId,
        description: `Surveil ${actualCount}`,
        mandatory: true,
        cards,
        surveilCount: actualCount,
      });

      pending[playerId] = {
        ...(typeof rawEntry === 'object' && rawEntry ? rawEntry : {}),
        count: actualCount,
        queued: true,
      };
    }

    if (Object.keys(pending).length === 0) {
      delete (game.state as any).pendingSurveil;
    }
  } catch (err) {
    debugWarn(1, "[processPendingSurveil] Error:", err);
  }
}

/**
 * After replay/reconnect, finish compound IR spells whose scry/surveil step was
 * persisted but trailing steps (e.g. draw) were not yet applied.
 */
export function processPendingOracleIrCompoundResume(
  io: Server,
  game: any,
  gameId: string,
): void {
  try {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = processPendingOracleIrCompoundResumeOnContext(ctx);
    if (resumed?.appliedSteps?.length) {
      broadcastGame(io, game, gameId);
    }
    maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
  } catch (err) {
    debugWarn(1, '[processPendingOracleIrCompoundResume] Error:', err);
  }
}

/**
 * Process pending proliferate from legacy state and migrate to resolution queue
 * 
 * This is called after stack resolution or when proliferate effects are created.
 * Migrates from pendingProliferate array to the resolution queue system.
 */
export function processPendingProliferate(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingProliferate;
    if (!Array.isArray(pending) || pending.length === 0) return;
    
    const battlefield = game.state?.battlefield || [];
    const players = game.state?.players || [];
    
    // Process each pending proliferate effect
    for (const effect of pending) {
      if (!effect || effect.prompted) continue;
      
      const playerId = effect.controller;
      if (!playerId) continue;
      
      // Mark as prompted to avoid re-prompting
      effect.prompted = true;
      
      // Collect all valid targets (permanents and players with counters)
      const availableTargets: any[] = [];
      
      // Add permanents with counters
      for (const permanent of battlefield) {
        if (permanent?.counters && Object.keys(permanent.counters).length > 0) {
          const hasCounters = Object.values(permanent.counters).some((count: any) => count > 0);
          if (hasCounters) {
            availableTargets.push({
              id: permanent.id,
              name: permanent.card?.name || 'Permanent',
              counters: permanent.counters,
              isPlayer: false,
            });
          }
        }
      }
      
      // Add players with counters
      for (const player of players) {
        if (player?.counters && Object.keys(player.counters).length > 0) {
          const hasCounters = Object.values(player.counters).some((count: any) => count > 0);
          if (hasCounters) {
            availableTargets.push({
              id: player.id,
              name: player.username || player.id,
              counters: player.counters,
              isPlayer: true,
            });
          }
        }
      }
      
      // Add to resolution queue
      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PROLIFERATE,
        playerId,
        description: 'Choose permanents and/or players to proliferate',
        mandatory: false, // Proliferate is optional
        sourceId: effect.sourceId,
        sourceName: effect.sourceName || 'Proliferate',
        proliferateId: effect.id,
        availableTargets,
      });

      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId,
        sourceId: String(effect.sourceId || effect.id || '').trim(),
        queuedResolutionStep: step,
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingProliferate] Error:", err);
  }
}

/**
 * Process pending ponder effects into resolution queue
 */
export function processPendingPonder(io: Server, game: any, gameId: string): void {
  try {
    const pendingPonder = (game.state as any)?.pendingPonder;
    if (!pendingPonder || typeof pendingPonder !== 'object') return;
    
    for (const [playerId, ponderData] of Object.entries(pendingPonder)) {
      if (!ponderData || typeof ponderData !== 'object') continue;
      
      const data = ponderData as any;
      if (data.queued === true) continue;
      const { effectId, cardCount, cardName, drawAfter, targetPlayerId, variant } = data;
      
      // Get the top cards for ponder
      const targetPid = targetPlayerId || playerId;
      const lib = (game as any).libraries?.get(targetPid) || [];
      const actualCount = Math.min(cardCount || 3, lib.length);
      const cards = lib.slice(0, actualCount);
      
      debug(2, `[processPendingPonder] Migrating ponder for player ${playerId}, ${actualCount} cards`);
      
      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: playerId as string,
        description: `Ponder: ${cardName || 'Look at top cards'}`,
        cards,
        variant: variant || 'ponder',
        cardCount: actualCount,
        drawAfter: drawAfter || false,
        mayShuffleAfter: data.canShuffle !== false,
        targetPlayerId: targetPid,
        sourceName: cardName,
        effectId,
      });

      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: playerId as string,
        sourceId: String(effectId || '').trim(),
        queuedResolutionStep: step,
      });

      data.queued = true;
    }
  } catch (e) {
    debugError(1, '[processPendingPonder] Error:', e);
  }
}

export function processPendingBottomOrder(io: Server, game: any, gameId: string): void {
  try {
    const pendingBottomOrder = (game.state as any)?.pendingBottomOrder;
    if (!pendingBottomOrder || typeof pendingBottomOrder !== 'object') return;

    for (const [playerId, rawEntries] of Object.entries(pendingBottomOrder)) {
      const entries = Array.isArray(rawEntries) ? rawEntries : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.queued === true) continue;

        const cards = Array.isArray(entry.cards) ? entry.cards : [];
        if (cards.length === 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.BOTTOM_ORDER,
          playerId: playerId as string,
          description: String(entry.description || `${entry.sourceName || 'Effect'}: Put cards on the bottom in any order.`),
          mandatory: true,
          sourceId: entry.sourceId,
          sourceName: entry.sourceName,
          sourceImage: entry.sourceImage,
          cards,
          shuffleAfter: entry.shuffleAfter === true,
          effectId: entry.effectId,
        } as any);

        entry.queued = true;
      }
    }
  } catch (err) {
    debugWarn(1, '[processPendingBottomOrder] Error:', err);
  }
}

export function processPendingLimDulsVault(io: Server, game: any, gameId: string): void {
  try {
    const pendingVault = (game.state as any)?.pendingLimDulsVault;
    if (!pendingVault || typeof pendingVault !== 'object') return;

    for (const [playerId, rawEntry] of Object.entries(pendingVault)) {
      const entry = rawEntry as any;
      if (!entry || typeof entry !== 'object') continue;
      if (entry.queued === true) continue;

      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;

      const actualCount = Math.min(5, lib.length);
      if (actualCount <= 0) {
        delete pendingVault[playerId];
        continue;
      }

      const cards = lib.slice(0, actualCount).map((card: any) => ({
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        imageUrl: card.image_uris?.normal || card.image_uris?.small,
        mana_cost: card.mana_cost,
        cmc: card.cmc,
      }));
      const currentLife = Number((game.state as any)?.life?.[playerId] ?? (game.state as any)?.startingLife ?? 40);

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIM_DULS_VAULT,
        playerId: playerId as string,
        description: "Lim-Dul's Vault: Reorder these cards, then either pay 1 life to put them on the bottom or keep them as your final five.",
        mandatory: true,
        sourceId: entry.effectId,
        sourceName: entry.sourceName || "Lim-Dul's Vault",
        sourceImage: entry.sourceImage,
        cards,
        effectId: String(entry.effectId || ''),
        currentLife,
        totalLifePaid: Number(entry.totalLifePaid || 0),
      } as any);

      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: playerId as string,
        sourceId: String(entry.effectId || '').trim(),
        queuedResolutionStep: step,
      });

      entry.currentLife = currentLife;
      entry.queued = true;
    }

    if (Object.keys(pendingVault).length === 0) {
      delete (game.state as any).pendingLimDulsVault;
    }
  } catch (err) {
    debugWarn(1, '[processPendingLimDulsVault] Error:', err);
  }
}

export function advanceDanceWithCalamityCastSequence(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  options: {
    effectId: string;
    sourceName: string;
    sourceImage?: unknown;
    totalManaValue: number;
    orderedSpellIds: string[];
    nextCastIndex: number;
  },
): void {
  const {
    effectId,
    sourceName,
    sourceImage,
    totalManaValue,
    orderedSpellIds,
    nextCastIndex,
  } = options;

  const currentExileZone = Array.isArray((game.state as any)?.zones?.[playerId]?.exile)
    ? (game.state as any).zones[playerId].exile
    : [];
  const remainingExiledCards = currentExileZone.map((card: any) => ({ ...card, zone: 'exile' }));
  const livePendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[playerId];
  if (livePendingEntry && typeof livePendingEntry === 'object') {
    livePendingEntry.exiledCards = remainingExiledCards;
  }

  const nextIndex = nextCastIndex + 1;
  if (nextIndex >= orderedSpellIds.length) {
    appendGameEvent(game, gameId, 'danceWithCalamityResolve', {
      playerId,
      effectId,
      sourceName,
      sourceImage,
      outcome: 'complete',
      totalManaValue,
      exiledCards: cloneExileStateForEvent(remainingExiledCards),
      remainingLibraryIds: (Array.isArray((game as any).libraries?.get(playerId)) ? (game as any).libraries.get(playerId) : [])
        .map((card: any) => String(card?.id || ''))
        .filter(Boolean),
    });
  } else {
    appendGameEvent(game, gameId, 'danceWithCalamityAdvanceCast', {
      playerId,
      effectId,
      sourceName,
      sourceImage,
      totalManaValue,
      orderedSpellIds,
      nextCastIndex: nextIndex,
    });

    processPendingDanceWithCalamity(io, game, gameId);
  }
}

export function completeDanceWithCalamityDeferredAdvance(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  castCardId: string,
): void {
  const pendingEntry = ((game.state as any)?.pendingDanceWithCalamity || {})[playerId];
  if (!pendingEntry || typeof pendingEntry !== 'object') return;

  const pendingAdvance = pendingEntry.pendingAdvanceAfterCast;
  if (!pendingAdvance || typeof pendingAdvance !== 'object') return;
  if (String(pendingAdvance.exiledCardId || '') !== String(castCardId || '')) return;

  delete pendingEntry.pendingAdvanceAfterCast;
  pendingEntry.queued = false;

  advanceDanceWithCalamityCastSequence(io, game, gameId, playerId, {
    effectId: String(pendingAdvance.effectId || ''),
    sourceName: String(pendingAdvance.sourceName || 'Dance with Calamity'),
    sourceImage: pendingAdvance.sourceImage,
    totalManaValue: Number(pendingAdvance.totalManaValue || 0),
    orderedSpellIds: Array.isArray(pendingAdvance.orderedSpellIds)
      ? pendingAdvance.orderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
      : [],
    nextCastIndex: Math.max(0, Number(pendingAdvance.nextCastIndex || 0)),
  });
}

export function processPendingDanceWithCalamity(io: Server, game: any, gameId: string): void {
  try {
    const pendingDance = (game.state as any)?.pendingDanceWithCalamity;
    if (!pendingDance || typeof pendingDance !== 'object') return;

    for (const [playerId, rawEntry] of Object.entries(pendingDance)) {
      const entry = rawEntry as any;
      if (!entry || typeof entry !== 'object') continue;
      if (entry.queued === true) continue;

      const sourceName = String(entry.sourceName || 'Dance with Calamity');
      const sourceImage = entry.sourceImage;
      const effectId = String(entry.effectId || '');
      const totalManaValue = Number(entry.totalManaValue || 0);
      const exiledCards = Array.isArray(entry.exiledCards) ? entry.exiledCards : [];
      const stage = String(entry.stage || 'exile');

      if (stage === 'exile') {
        const library = Array.isArray((game as any).libraries?.get(playerId))
          ? ((game as any).libraries.get(playerId) as any[])
          : [];

        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DANCE_WITH_CALAMITY,
          playerId: playerId as string,
          description: `${sourceName}: Exile the top card, or stop and cast spells from among the exiled cards.`,
          mandatory: true,
          sourceId: effectId,
          sourceName,
          sourceImage,
          effectId,
          exiledCards,
          totalManaValue,
          canContinue: library.length > 0 && totalManaValue <= 13,
        } as any);

        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: playerId as string,
          sourceId: effectId,
          queuedResolutionStep: step,
        });

        entry.queued = true;
        continue;
      }

      if (stage === 'select_casts') {
        const allowedIds = new Set(
          (Array.isArray(entry.spellCardIds) ? entry.spellCardIds : [])
            .map((value: any) => String(value || ''))
            .filter(Boolean)
        );
        const spellCards = exiledCards.filter((card: any) => allowedIds.has(String(card?.id || '')));
        if (spellCards.length === 0) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.DANCE_WITH_CALAMITY_CAST,
          playerId: playerId as string,
          description: `${sourceName}: Choose any number of exiled spells to cast, then set their cast order.`,
          mandatory: true,
          sourceId: effectId,
          sourceName,
          sourceImage,
          effectId,
          exiledCards,
          spellCards,
          totalManaValue,
        } as any);

        entry.queued = true;
        continue;
      }

      if (stage === 'cast_sequence') {
        const orderedSpellIds = Array.isArray(entry.orderedSpellIds)
          ? entry.orderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];
        const nextCastIndex = Math.max(0, Number(entry.nextCastIndex || 0));
        const nextCardId = orderedSpellIds[nextCastIndex];
        if (!nextCardId) continue;

        const exileZone = Array.isArray((game.state as any)?.zones?.[playerId]?.exile)
          ? (game.state as any).zones[playerId].exile
          : [];
        const nextCard = exileZone.find((card: any) => String(card?.id || '') === nextCardId)
          || exiledCards.find((card: any) => String(card?.id || '') === nextCardId);
        if (!nextCard) {
          entry.nextCastIndex = nextCastIndex + 1;
          entry.queued = false;
          continue;
        }

        upsertOneShotCastFromExilePromptPermission(game, String(playerId) as PlayerID, nextCard, sourceName, effectId);

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: playerId as string,
          description: `${sourceName}: You may cast ${nextCard?.name || 'that card'} from exile without paying its mana cost.`,
          mandatory: false,
          sourceId: effectId,
          sourceName,
          sourceImage,
          options: [
            { id: 'cast', label: `Cast ${nextCard?.name || 'that card'}` },
            { id: 'decline', label: 'Decline' },
          ],
          minSelections: 1,
          maxSelections: 1,
          castFromExileCardId: nextCard?.id,
          castFromExileCard: nextCard,
          castFromExileDeclineDestination: 'exile',
          danceWithCalamityCastPrompt: true,
          danceWithCalamityEffectId: effectId,
          danceWithCalamityOrderedSpellIds: orderedSpellIds,
          danceWithCalamityNextCastIndex: nextCastIndex,
        } as any);

        entry.queued = true;
      }
    }
  } catch (err) {
    debugWarn(1, '[processPendingDanceWithCalamity] Error:', err);
  }
}