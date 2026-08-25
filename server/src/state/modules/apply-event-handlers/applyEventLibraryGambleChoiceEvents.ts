// server/src/state/modules/apply-event-handlers/applyEventLibraryGambleChoiceEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Lim-Dul's Vault, Dance with Calamity, life redistribution, proliferate, fateseal, clash, explore.
// Public entry: applyLibraryGambleChoiceEvents(ctx, e) -> true when it handled the event.
//
// Handles: limDulsVaultContinue, limDulsVaultResolve, danceWithCalamityContinue, danceWithCalamityBeginCasting, danceWithCalamitySetCastOrder, danceWithCalamityAdvanceCast, danceWithCalamityResolve, lifeRedistributionResolve, proliferateResolve, fatesealResolve, clashResolve, exploreResolve
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { applyExplore } from "../zones";
import { updateCounters, runSBA } from "../counters_tokens";
import {
  clearReplayDanceWithCalamitySteps,
  clearReplayQueuedSteps,
  ensureReplayPlayerZones,
  mergeCardsIntoReplayExile,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryAfterPutOnBottom,
  buildLibraryAfterPutOnTop,
  buildLibraryFromRemainingIds,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";

export function applyLibraryGambleChoiceEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "limDulsVaultContinue": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || "Lim-Dul's Vault").trim();
        const sourceImage = (e as any).sourceImage;
        const lifePaid = Number((e as any).lifePaid || 0);
        const totalLifePaid = Number((e as any).totalLifePaid || 0);
        const orderedBottomIds = Array.isArray((e as any).orderedBottomIds)
          ? ((e as any).orderedBottomIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : orderedBottomIds.length > 0
            ? buildLibraryAfterPutOnBottom(getPlayerLibraryFromContext(ctx, pid), orderedBottomIds)
            : [];

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesVaultStep = (step: any): boolean => {
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.LIM_DULS_VAULT)
                  && String(step?.playerId || '') === pid
                  && (!effectId || String(step?.effectId || '') === effectId);
              };

              const activeStepMatched = matchesVaultStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesVaultStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          stateAny.life = stateAny.life || {};
          if (Number.isFinite(lifePaid) && lifePaid > 0) {
            const currentLife = Number(stateAny.life?.[pid] ?? stateAny.startingLife ?? 40);
            stateAny.life[pid] = currentLife - lifePaid;
          }
          if (Number.isFinite(lifePaid) && lifePaid > 0) {
            stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
            stateAny.lifeLostThisTurn[pid] = Number(stateAny.lifeLostThisTurn[pid] || 0) + lifePaid;
          }

          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          stateAny.pendingLimDulsVault = stateAny.pendingLimDulsVault || {};
          stateAny.pendingLimDulsVault[pid] = {
            effectId,
            sourceName,
            sourceImage,
            totalLifePaid,
            currentLife: Number(stateAny.life?.[pid] ?? stateAny.startingLife ?? 40),
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(limDulsVaultContinue): failed', err);
        }
        break;
      }

      case "limDulsVaultResolve": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const orderedTopIds = Array.isArray((e as any).orderedTopIds)
          ? ((e as any).orderedTopIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const shuffledRemainderIds = Array.isArray((e as any).shuffledRemainderIds)
          ? ((e as any).shuffledRemainderIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : orderedTopIds.length > 0
            ? buildLibraryAfterPutOnTop(
                getPlayerLibraryFromContext(ctx, pid),
                orderedTopIds,
                shuffledRemainderIds.length > 0 ? shuffledRemainderIds : undefined,
              )
            : [];

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesVaultStep = (step: any): boolean => {
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.LIM_DULS_VAULT)
                  && String(step?.playerId || '') === pid
                  && (!effectId || String(step?.effectId || '') === effectId);
              };

              const activeStepMatched = matchesVaultStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesVaultStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          if (stateAny.pendingLimDulsVault && typeof stateAny.pendingLimDulsVault === 'object') {
            delete stateAny.pendingLimDulsVault[pid];
            if (Object.keys(stateAny.pendingLimDulsVault).length === 0) {
              delete stateAny.pendingLimDulsVault;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(limDulsVaultResolve): failed', err);
        }
        break;
      }

      case "danceWithCalamityContinue": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const exiledCards = Array.isArray((e as any).exiledCards)
          ? ((e as any).exiledCards as any[]).map((card: any) => ({ ...card, zone: 'exile' }))
          : [];
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : buildLibraryFromRemainingIds(
              getPlayerLibraryFromContext(ctx, pid),
              exiledCards,
              remainingLibraryIds,
            );

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          mergeCardsIntoReplayExile(playerZones, exiledCards);
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards,
            totalManaValue,
            stage: 'exile',
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityContinue): failed', err);
        }
        break;
      }

      case "danceWithCalamityBeginCasting": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const spellCardIds = Array.isArray((e as any).spellCardIds)
          ? (e as any).spellCardIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          const existing = (stateAny.pendingDanceWithCalamity || {})[pid] || {};
          const replayExiledCards = Array.isArray(existing.exiledCards) && existing.exiledCards.length > 0
            ? existing.exiledCards
            : (Array.isArray(playerZones.exile) ? playerZones.exile.map((card: any) => ({ ...card, zone: 'exile' })) : []);
          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards: replayExiledCards,
            totalManaValue,
            stage: 'select_casts',
            spellCardIds,
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityBeginCasting): failed', err);
        }
        break;
      }

      case "danceWithCalamitySetCastOrder": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const orderedSpellIds = Array.isArray((e as any).orderedSpellIds)
          ? (e as any).orderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          const existing = (stateAny.pendingDanceWithCalamity || {})[pid] || {};
          const replayExiledCards = Array.isArray(existing.exiledCards) && existing.exiledCards.length > 0
            ? existing.exiledCards
            : (Array.isArray(playerZones.exile) ? playerZones.exile.map((card: any) => ({ ...card, zone: 'exile' })) : []);
          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards: replayExiledCards,
            totalManaValue,
            stage: 'cast_sequence',
            orderedSpellIds,
            nextCastIndex: 0,
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamitySetCastOrder): failed', err);
        }
        break;
      }

      case "danceWithCalamityAdvanceCast": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const orderedSpellIds = Array.isArray((e as any).orderedSpellIds)
          ? (e as any).orderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];
        const nextCastIndex = Math.max(0, Number((e as any).nextCastIndex || 0));

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          const existing = (stateAny.pendingDanceWithCalamity || {})[pid] || {};
          const replayExiledCards = Array.isArray(existing.exiledCards) && existing.exiledCards.length > 0
            ? existing.exiledCards
            : (Array.isArray(playerZones.exile) ? playerZones.exile.map((card: any) => ({ ...card, zone: 'exile' })) : []);
          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards: replayExiledCards,
            totalManaValue,
            stage: 'cast_sequence',
            orderedSpellIds,
            nextCastIndex,
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityAdvanceCast): failed', err);
        }
        break;
      }

      case "danceWithCalamityResolve": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const exiledCards = Array.isArray((e as any).exiledCards)
          ? ((e as any).exiledCards as any[]).map((card: any) => ({ ...card, zone: 'exile' }))
          : [];
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : buildLibraryFromRemainingIds(
              getPlayerLibraryFromContext(ctx, pid),
              exiledCards,
              remainingLibraryIds,
            );

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }
          if (exiledCards.length > 0) {
            mergeCardsIntoReplayExile(playerZones, exiledCards);
          }

          if (stateAny.pendingDanceWithCalamity && typeof stateAny.pendingDanceWithCalamity === 'object') {
            delete stateAny.pendingDanceWithCalamity[pid];
            if (Object.keys(stateAny.pendingDanceWithCalamity).length === 0) {
              delete stateAny.pendingDanceWithCalamity;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityResolve): failed', err);
        }
        break;
      }

      case "lifeRedistributionResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const redistributionId = String((e as any).redistributionId || '').trim();
          const lifeByPlayerId = (e as any).lifeByPlayerId;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.LIFE_REDISTRIBUTION) &&
                (!redistributionId || String((step as any)?.redistributionId || '').trim() === redistributionId)
              );
            });
          }

          if (!lifeByPlayerId || typeof lifeByPlayerId !== 'object' || Array.isArray(lifeByPlayerId)) break;

          const startingLife = Number((ctx.state as any)?.startingLife ?? 40);
          for (const [targetPlayerId, lifeRaw] of Object.entries(lifeByPlayerId as Record<string, unknown>)) {
            const pid = String(targetPlayerId || '').trim();
            if (!pid) continue;
            const nextLife = Math.max(0, Math.floor(Number(lifeRaw) || 0));
            const current = Number((ctx.state as any)?.life?.[pid] ?? ctx.life?.[pid as PlayerID] ?? startingLife);

            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx.state as any).life[pid] = nextLife;
            if (ctx.life) ctx.life[pid as PlayerID] = nextLife;

            const players = Array.isArray((ctx.state as any).players) ? (ctx.state as any).players : [];
            const player = players.find((entry: any) => String(entry?.id || '').trim() === pid);
            if (player) player.life = nextLife;

            const diff = nextLife - current;
            const stateAny = ctx.state as any;
            if (diff > 0) {
              stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
              stateAny.lifeGainedThisTurn[pid] = (stateAny.lifeGainedThisTurn[pid] || 0) + diff;
            } else if (diff < 0) {
              stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
              stateAny.lifeLostThisTurn[pid] = (stateAny.lifeLostThisTurn[pid] || 0) + Math.abs(diff);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(lifeRedistributionResolve): failed', err);
        }
        break;
      }

      case "proliferateResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const proliferateId = String((e as any).proliferateId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.PROLIFERATE) &&
                (!playerId || String(step?.playerId || '').trim() === playerId) &&
                (!proliferateId || String(step?.proliferateId || '').trim() === proliferateId)
              );
            });
          }

          const targetIds = Array.isArray((e as any).targetIds)
            ? ((e as any).targetIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          if (targetIds.length === 0) break;

          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          const players = Array.isArray(ctx.state?.players) ? ctx.state.players : [];

          for (const targetId of targetIds) {
            const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetId);
            if (permanent && permanent.counters && typeof permanent.counters === 'object') {
              const deltas: Record<string, number> = {};
              for (const [counterType, count] of Object.entries(permanent.counters as Record<string, number>)) {
                if (Number(count || 0) > 0) {
                  deltas[counterType] = 1;
                }
              }
              if (Object.keys(deltas).length > 0) {
                updateCounters(ctx as any, String(targetId), deltas);
              }
              continue;
            }

            const player = players.find((entry: any) => entry && String(entry.id || '') === targetId);
            if (player && player.counters && typeof player.counters === 'object') {
              for (const [counterType, count] of Object.entries(player.counters as Record<string, number>)) {
                if (Number(count || 0) > 0) {
                  (player.counters as any)[counterType] = Number(count || 0) + 1;
                }
              }
              const poisonTotal = Number((player.counters as any).poison || 0);
              if (poisonTotal > 0) {
                (ctx as any).poison = (ctx as any).poison || {};
                (ctx.state as any).poisonCounters = (ctx.state as any).poisonCounters || {};
                (ctx as any).poison[targetId] = poisonTotal;
                (ctx.state as any).poisonCounters[targetId] = poisonTotal;
                (player as any).poisonCounters = poisonTotal;
              }
            }
          }

          ctx.bumpSeq();
          try {
            runSBA(ctx as any);
          } catch {}
        } catch (err) {
          debugWarn(1, 'applyEvent(proliferateResolve): failed', err);
        }
        break;
      }

      case "fatesealResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const opponentId = String((e as any).opponentId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.FATESEAL) &&
                (!playerId || String(step?.playerId || '').trim() === playerId) &&
                (!opponentId || String(step?.opponentId || '').trim() === opponentId)
              );
            });
          }

          if (!opponentId) break;

          const keepTopOrder = Array.isArray((e as any).keepTopOrder) ? (e as any).keepTopOrder : [];
          const bottomOrder = Array.isArray((e as any).bottomOrder) ? (e as any).bottomOrder : [];
          const totalCards = keepTopOrder.length + bottomOrder.length;
          if (totalCards <= 0) break;

          const lib = (ctx as any).libraries?.get?.(opponentId);
          if (!Array.isArray(lib)) break;

          lib.splice(0, totalCards);
          for (let index = keepTopOrder.length - 1; index >= 0; index--) {
            lib.unshift({ ...keepTopOrder[index], zone: 'library' });
          }
          for (const card of bottomOrder) {
            lib.push({ ...card, zone: 'library' });
          }

          (ctx as any).libraries?.set?.(opponentId, lib);
          const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
          const playerZones = (zones[opponentId] = zones[opponentId] || {});
          playerZones.libraryCount = lib.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(fatesealResolve): failed', err);
        }
        break;
      }

      case "clashResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const revealedCard = (e as any).revealedCard;
          const putOnBottom = Boolean((e as any).putOnBottom);
          const opponentId = String((e as any).opponentId || '').trim();
          const revealedCardId = String((revealedCard as any)?.id || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              const stepRevealedId = String(step?.revealedCard?.id || '').trim();
              return (
                String(step?.type || '') === String(ResolutionStepType.CLASH) &&
                (!playerId || String(step?.playerId || '').trim() === playerId) &&
                (!opponentId || String(step?.opponentId || '').trim() === opponentId) &&
                (!revealedCardId || !stepRevealedId || stepRevealedId === revealedCardId)
              );
            });
          }

          if (!playerId || !revealedCard) break;

          const lib = (ctx as any).libraries?.get?.(playerId);
          if (!Array.isArray(lib)) break;

          if (putOnBottom) {
            const revealedId = String((revealedCard as any).id || '').trim();
            const revealedIndex = lib.findIndex((card: any) => card && String(card.id || '') === revealedId);
            if (revealedIndex >= 0) {
              const [card] = lib.splice(revealedIndex, 1);
              if (card) {
                lib.push({ ...card, zone: 'library' });
              }
            }
          }

          (ctx as any).libraries?.set?.(playerId, lib);
          const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
          const playerZones = (zones[playerId] = zones[playerId] || {});
          playerZones.libraryCount = lib.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(clashResolve): failed', err);
        }
        break;
      }

      case "exploreResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.EXPLORE_DECISION).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentId)
              );
            });
          }
        } catch {
          // best-effort only
        }

        applyExplore(
          ctx as any,
          (e as any).playerId,
          (e as any).permanentId,
          (e as any).revealedCardId,
          (e as any).isLand || false,
          (e as any).toGraveyard || false
        );
        break;
      }

      default:
        return false;
  }

  return true;
}
