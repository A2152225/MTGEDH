// server/src/state/modules/apply-event-handlers/applyEventTapSacrificeCounterEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Tap/untap, exile and sacrifice of permanents, counter movement and control changes.
// Public entry: applyTapSacrificeCounterEvents(ctx, e) -> true when it handled the event.
//
// Handles: tapPermanent, untapPermanent, permanent_tapped, permanent_untapped, exilePermanent, sacrificePermanent, sacrificeSelected, randomPileSacrificeResolved, libraryChaosExchangeResolved, repeatedZoneDraftPick, counter_moved, changePermanentControl, setPermanentSelectedMode, counterTargetChosen, counterPlacementResolve
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { updateCounters, canonicalizeCounterKey, trackPermanentSacrificedThisTurn, movePermanentToExile } from "../counters_tokens";
import { syncPreparedPermanentAfterControlChange } from "../prepared.js";
import {
  clearReplayQueuedSteps,
  clearReplayQueuedStepById,
  matchesDungeonRoomPaymentStep,
  normalizeRecordedManaMap,
  applyRecordedManaToPool,
  inferLegacyManaLifeEffect,
  applyManaAbilityLifeLoss,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  applyReplaySacrificedPermanent,
  consumeRecordedManaCostFromPool,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";

export function applyTapSacrificeCounterEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "tapPermanent":
      case "untapPermanent": {
        // Tap or untap a permanent
        const permId = (e as any).permanentId;
        const tapped = e.type === "tapPermanent";
        const playerId = String((e as any).playerId || '').trim();
        if (!permId) break;
        try {
          const battlefield = ctx.state.battlefield || [];
          const perm = battlefield.find((p: any) => p.id === permId);
          if (tapped && playerId) {
            const stateAny = ctx.state as any;
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              colorless: 0,
            };

            const manaCost = String((e as any).manaCost || '').trim();
            if (manaCost) {
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
            }

            const recordedMana = normalizeRecordedManaMap((e as any).addedMana);
            applyRecordedManaToPool(ctx, playerId, recordedMana);

            const explicitLifeLost = Number((e as any).lifeLost || 0);
            const inferredLifeEffect = perm ? inferLegacyManaLifeEffect(perm, (e as any).manaColor) : { amount: 0, isDamage: false };
            const explicitLifeLossIsDamage = typeof (e as any).lifeLossIsDamage === 'boolean'
              ? Boolean((e as any).lifeLossIsDamage)
              : undefined;
            if (Number.isFinite(explicitLifeLost) && explicitLifeLost > 0) {
              applyManaAbilityLifeLoss(
                ctx,
                playerId,
                explicitLifeLost,
                explicitLifeLossIsDamage ?? inferredLifeEffect.isDamage,
              );
            }
          }
          if (perm) {
            (perm as any).tapped = tapped;

            // Intervening-if support: record that a player tapped a nonland permanent this turn.
            // Conservative: only set true on positive evidence when the event includes playerId.
            if (tapped) {
              try {
                const pid = playerId;
                const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
                const isLand = tl.includes('land');
                if (pid && !isLand) {
                  const stateAny = ctx.state as any;
                  stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                  stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
                }
              } catch {
                /* ignore */
              }
            }
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "permanent_tapped":
      case "permanent_untapped": {
        // Legacy/compat: bulk tap/untap emitted by some Resolution Queue steps.
        const tapped = e.type === 'permanent_tapped';
        const idsRaw = (e as any).permanentIds;
        const ids = Array.isArray(idsRaw) ? idsRaw.map((x: any) => String(x)) : [];
        if (ids.length === 0) break;
        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );

          const battlefield = ctx.state.battlefield || [];
          for (const permId of ids) {
            const perm = battlefield.find((p: any) => p && String(p.id) === String(permId));
            if (perm) {
              (perm as any).tapped = tapped;
            }
          }

          // Intervening-if support: record that a player tapped a nonland permanent this turn.
          if (tapped) {
            try {
              const pid = String((e as any).playerId || '').trim();
              if (pid) {
                const stateAny = ctx.state as any;
                stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
              }
            } catch {
              /* ignore */
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case 'exilePermanent': {
        const permanentId = String((e as any).permanentId || '').trim();
        if (!permanentId) break;
        try {
          const sourcePermanentId = (e as any).sourcePermanentId != null ? String((e as any).sourcePermanentId) : undefined;
          const sourceName = (e as any).sourceName != null ? String((e as any).sourceName) : undefined;
          movePermanentToExile(ctx as any, permanentId, {
            exiledWithSourceId: sourcePermanentId,
            exiledWithSourceName: sourceName,
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(exilePermanent): failed', err);
        }
        break;
      }

      case "sacrificePermanent": {
        // Sacrifice a permanent (move to graveyard)
        const permId = (e as any).permanentId;
        if (!permId) break;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && (resolvedStepId || (e as any).dungeonRoomPayment)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomPaymentStep(step, e as any);
            });
          }

          try {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p?.id === permId);
            if (perm) {
              // Tracking happens inside applyReplaySacrificedPermanent; only call here
              // when the permanent will be missing from the battlefield by the time
              // applyReplaySacrificedPermanent looks it up (e.g., already removed).
              const stillThere = battlefield.includes(perm);
              if (!stillThere) trackPermanentSacrificedThisTurn(ctx.state, perm);
            }
          } catch {
            // best-effort only
          }

          applyReplaySacrificedPermanent(ctx, String(permId || ''));
        } catch (err) {
          debugWarn(1, "applyEvent(sacrificePermanent): failed", err);
        }
        break;
      }

      case "sacrificeSelected": {
        // DEPRECATED legacy event name for multiple sacrifices.
        // Kept for event replay/backward compatibility.
        const permanentIds = ((e as any).permanentIds as string[]) || ((e as any).permanentId ? [String((e as any).permanentId)] : []);
        if (!Array.isArray(permanentIds) || permanentIds.length === 0) break;
        try {
          for (const permId of permanentIds) {
            // Same Clue-sacrifice tracking as sacrificePermanent.
            try {
              const battlefield = ctx.state.battlefield || [];
              const perm = battlefield.find((p: any) => p?.id === permId);
              const controllerId = perm?.controller != null ? String(perm.controller) : null;
              const tl = String(perm?.card?.type_line || '').toLowerCase();
              const nm = String(perm?.card?.name || '').toLowerCase();
              const isClue = tl.includes('clue') && (tl.includes('artifact') || tl.includes('token'));
              if (controllerId && isClue && (nm === 'clue' || tl.includes('— clue') || tl.includes('- clue') || tl.includes('clue'))) {
                const stateAny = ctx.state as any;
                stateAny.sacrificedCluesThisTurn = stateAny.sacrificedCluesThisTurn || {};
                stateAny.sacrificedCluesThisTurn[controllerId] = (stateAny.sacrificedCluesThisTurn[controllerId] || 0) + 1;

                // Aliases consumed by intervening-if.
                stateAny.cluesSacrificedThisTurn = stateAny.cluesSacrificedThisTurn || {};
                stateAny.cluesSacrificedThisTurn[controllerId] = (stateAny.cluesSacrificedThisTurn[controllerId] || 0) + 1;
                stateAny.cluesSacrificedThisTurnCount = stateAny.cluesSacrificedThisTurnCount || {};
                stateAny.cluesSacrificedThisTurnCount[controllerId] = (stateAny.cluesSacrificedThisTurnCount[controllerId] || 0) + 1;
              }

              // Same generic/permanent-type sacrifice tracking as sacrificePermanent.
              if (controllerId) {
                const stateAny = ctx.state as any;
                stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
                stateAny.permanentsSacrificedThisTurn[controllerId] = (stateAny.permanentsSacrificedThisTurn[controllerId] || 0) + 1;

                const isFood = tl.includes('food') && (tl.includes('artifact') || tl.includes('token'));
                if (isFood && (nm === 'food' || tl.includes('— food') || tl.includes('- food') || tl.includes('food'))) {
                  stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
                  stateAny.foodsSacrificedThisTurn[controllerId] = (stateAny.foodsSacrificedThisTurn[controllerId] || 0) + 1;
                }
              }
            } catch {
              // best-effort only
            }

            applyReplaySacrificedPermanent(ctx, String(permId || ''));
          }
        } catch (err) {
          debugWarn(1, "applyEvent(sacrificeSelected): failed", err);
        }
        break;
      }

      case "randomPileSacrificeResolved": {
        // Marker for sequential N-pile random sacrifice. Individual permanents are
        // already applied via sacrificePermanent events; this only clears the
        // prompt and advances the RNG cursor so later random effects stay aligned.
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              return String(step?.id || '').trim() === resolvedStepId;
            });
          }

          const playerOrder = Array.isArray((e as any).playerOrder)
            ? ((e as any).playerOrder as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const recorded = (e as any).randomPileByPlayer && typeof (e as any).randomPileByPlayer === 'object'
            ? (e as any).randomPileByPlayer as Record<string, unknown>
            : {};
          const draws = playerOrder.length > 0
            ? playerOrder.length
            : Object.keys(recorded).length;
          for (let i = 0; i < draws; i += 1) {
            if (typeof ctx.rng === 'function') ctx.rng();
          }
        } catch (err) {
          debugWarn(1, "applyEvent(randomPileSacrificeResolved): failed", err);
        }
        break;
      }

      case "libraryChaosExchangeResolved": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) =>
              String(step?.id || '').trim() === resolvedStepId);
          }

          const removedIds = new Set(
            (Array.isArray((e as any).removedPermanents) ? (e as any).removedPermanents : [])
              .map((entry: any) => String(entry?.id || '').trim())
              .filter(Boolean),
          );
          ctx.state.battlefield = (ctx.state.battlefield || [])
            .filter((permanent: any) => !removedIds.has(String(permanent?.id || '')));

          const librarySnapshots = (e as any).librarySnapshots && typeof (e as any).librarySnapshots === 'object'
            ? (e as any).librarySnapshots as Record<string, any[]>
            : {};
          const stateAny = ctx.state as any;
          stateAny.zones = stateAny.zones || {};
          for (const [playerId, snapshot] of Object.entries(librarySnapshots)) {
            const library = (Array.isArray(snapshot) ? snapshot : []).map((card: any) => ({
              ...card,
              zone: 'library',
            }));
            if ((ctx as any).libraries instanceof Map) {
              (ctx as any).libraries.set(playerId, library);
            }
            stateAny.zones[playerId] = stateAny.zones[playerId] || {};
            stateAny.zones[playerId].library = library;
            stateAny.zones[playerId].libraryCount = library.length;
            const player = (stateAny.players || []).find((entry: any) => String(entry?.id || '') === playerId);
            if (player) player.library = library;
          }

          const exileAdded = (e as any).exileAddedByPlayer && typeof (e as any).exileAddedByPlayer === 'object'
            ? (e as any).exileAddedByPlayer as Record<string, any[]>
            : {};
          for (const [playerId, cards] of Object.entries(exileAdded)) {
            stateAny.zones[playerId] = stateAny.zones[playerId] || {};
            const exile = Array.isArray(stateAny.zones[playerId].exile)
              ? stateAny.zones[playerId].exile
              : [];
            for (const card of Array.isArray(cards) ? cards : []) {
              if (!exile.some((entry: any) => String(entry?.id || '') === String(card?.id || ''))) {
                exile.push({ ...card, zone: 'exile' });
              }
            }
            stateAny.zones[playerId].exile = exile;
            stateAny.zones[playerId].exileCount = exile.length;
            const player = (stateAny.players || []).find((entry: any) => String(entry?.id || '') === playerId);
            if (player) player.exile = exile;
          }

          for (const permanent of Array.isArray((e as any).battlefieldAdded) ? (e as any).battlefieldAdded : []) {
            const permanentId = String(permanent?.id || '').trim();
            if (permanentId && !(ctx.state.battlefield || []).some((entry: any) => String(entry?.id || '') === permanentId)) {
              (ctx.state.battlefield || []).push({ ...permanent, card: { ...(permanent.card || {}) } });
            }
          }

          const rngDrawCount = Math.max(0, Math.floor(Number((e as any).rngDrawCount || 0)));
          for (let i = 0; i < rngDrawCount; i += 1) {
            if (typeof (ctx as any).rng === 'function') (ctx as any).rng();
          }
        } catch (err) {
          debugWarn(1, "applyEvent(libraryChaosExchangeResolved): failed", err);
        }
        break;
      }

      case "repeatedZoneDraftPick": {
        // Zone movement is applied by the paired effectProgramZoneMove event.
        // This marker clears the completed draft prompt; the next chooser prompt
        // is restored separately via resolveTopOfStackPrompt when present.
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              return String(step?.id || '').trim() === resolvedStepId;
            });
          }
        } catch (err) {
          debugWarn(1, "applyEvent(repeatedZoneDraftPick): failed", err);
        }
        break;
      }

      case "counter_moved": {
        const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const counterType = canonicalizeCounterKey(String((e as any).counterType || '').trim());

        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );

          if (!sourcePermanentId || !targetPermanentId || !counterType) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const sourcePermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === sourcePermanentId);
          const targetPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetPermanentId);
          if (!sourcePermanent || !targetPermanent) break;

          const sourceCounters = ((sourcePermanent as any).counters || {}) as Record<string, number>;
          const currentSourceCount = Number(sourceCounters[counterType] || 0);
          if (currentSourceCount <= 0) break;
          sourceCounters[counterType] = currentSourceCount - 1;
          if (sourceCounters[counterType] <= 0) {
            delete sourceCounters[counterType];
          }
          (sourcePermanent as any).counters = sourceCounters;

          const targetCounters = ((targetPermanent as any).counters || {}) as Record<string, number>;
          targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
          (targetPermanent as any).counters = targetCounters;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counter_moved): failed', err);
        }
        break;
      }

      case "changePermanentControl": {
        const permanentId = String((e as any).permanentId || '').trim();
        const newController = String((e as any).newController || '').trim();
        const oldController = String((e as any).oldController || '').trim();
        const duration = String((e as any).duration || '').trim();
        const appliedAt = Number((e as any).appliedAt || 0);
        if (!permanentId || !newController) break;

        try {
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
          if (permanent) {
            permanent.controller = newController;
            syncPreparedPermanentAfterControlChange(ctx.state, permanent, oldController);
            try {
              const { reconcileSoulbondPairing } = require('../soulbond.js') as typeof import('../soulbond.js');
              reconcileSoulbondPairing(ctx.state, permanent);
            } catch {
              // best-effort
            }
          }

          if (duration === 'eot' || duration === 'turn' || duration === 'until_end_of_turn') {
            const stateAny = ctx.state as any;
            stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];
            const alreadyTracked = stateAny.controlChangeEffects.some((entry: any) =>
              entry &&
              String(entry.permanentId || '') === permanentId &&
              String(entry.originalController || '') === oldController &&
              String(entry.newController || '') === newController &&
              ['eot', 'turn', 'until_end_of_turn'].includes(String(entry.duration || '').trim().toLowerCase())
            );

            if (!alreadyTracked) {
              stateAny.controlChangeEffects.push({
                permanentId,
                originalController: oldController,
                newController,
                duration,
                appliedAt,
              });
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(changePermanentControl): failed', err);
        }
        break;
      }

      case "setPermanentSelectedMode": {
        const permanentId = String((e as any).permanentId || '').trim();
        const rawSelectedMode = (e as any).selectedMode;
        if (!permanentId || !rawSelectedMode) break;

        try {
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
          if (!permanent) break;

          const nextSelectedMode = typeof rawSelectedMode === 'object'
            ? {
                id: String((rawSelectedMode as any).id || '').trim(),
                label: String((rawSelectedMode as any).label || (rawSelectedMode as any).description || '').trim(),
                description: String((rawSelectedMode as any).description || (rawSelectedMode as any).label || '').trim(),
              }
            : {
                id: '',
                label: String(rawSelectedMode || '').trim(),
                description: String(rawSelectedMode || '').trim(),
              };

          permanent.selectedMode = nextSelectedMode;
          permanent.card = {
            ...(permanent.card || {}),
            selectedMode: { ...nextSelectedMode },
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setPermanentSelectedMode): failed', err);
        }
        break;
      }

      case "counterTargetChosen": {
        const targetId = String((e as any).targetId || '').trim();
        const counterType = canonicalizeCounterKey(String((e as any).counterType || '').trim());
        const sourceId = String((e as any).sourceId || '').trim();
        const clearQueuedScavengePrompt = (e as any).clearQueuedScavengePrompt === true;
        const replayGameId = String((ctx as any).gameId || '').trim();

        try {
          if (!targetId || !counterType) break;

          if (clearQueuedScavengePrompt && sourceId && replayGameId) {
            const queue = ResolutionQueueManager.getQueue(replayGameId);
            const matchingStepIds: string[] = [];

            if ((queue as any)?.activeStep && (queue as any).activeStep.scavengeTargetSelection === true) {
              const activeStep = (queue as any).activeStep as any;
              if (String(activeStep.cardId || activeStep.sourceId || '').trim() === sourceId) {
                matchingStepIds.push(String(activeStep.id || '').trim());
              }
            }

            if (Array.isArray((queue as any)?.steps)) {
              for (const pendingStep of (queue as any).steps) {
                const stepAny = pendingStep as any;
                if (stepAny?.scavengeTargetSelection !== true) continue;
                if (String(stepAny.cardId || stepAny.sourceId || '').trim() !== sourceId) continue;
                matchingStepIds.push(String(stepAny.id || '').trim());
              }
            }

            for (const stepId of Array.from(new Set(matchingStepIds)).filter(Boolean)) {
              ResolutionQueueManager.cancelStep(replayGameId, stepId);
            }
          }

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const targetPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetId);
          if (!targetPermanent) break;

          const targetCounters = ((targetPermanent as any).counters || {}) as Record<string, number>;
          targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
          (targetPermanent as any).counters = targetCounters;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counterTargetChosen): failed', err);
        }
        break;
      }

      case "counterPlacementResolve": {
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const sourceController = String((e as any).sourceController || '').trim();
        const goadedByPlayerId = String((e as any).goadedByPlayerId || sourceController || '').trim();
        const effectType = String((e as any).effectType || '').trim().toLowerCase();
        const conditionalEffectOnAccept = String((e as any).conditionalEffectOnAccept || '').trim().toLowerCase();
        const playersWhoAccepted = Array.isArray((e as any).playersWhoAccepted)
          ? ((e as any).playersWhoAccepted as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
          : [];
        const creaturesWithCounters = Array.isArray((e as any).creaturesWithCounters)
          ? ((e as any).creaturesWithCounters as any[])
              .map((entry: any) => ({
                permanentId: String(entry?.permanentId || '').trim(),
                playerId: String(entry?.playerId || '').trim(),
              }))
              .filter((entry: any) => entry.permanentId)
          : [];

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                ((step as any).counterPlacementTrigger === true || (step as any).agitatorAntTrigger === true) &&
                (!sourceController || String((step as any)?.sourceController || '').trim() === sourceController)
              );
            });
          }

          for (const entry of creaturesWithCounters) {
            updateCounters(ctx as any, entry.permanentId, { '+1/+1': 2 });
          }

          if (effectType === 'goad' || conditionalEffectOnAccept === 'goad') {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            for (const entry of creaturesWithCounters) {
              const creature = battlefield.find((perm: any) => perm && String(perm.id || '') === entry.permanentId) as any;
              if (!creature || !goadedByPlayerId) continue;
              creature.goaded = creature.goaded || {};
              creature.goaded[goadedByPlayerId] = true;
            }
          } else if (effectType === 'cant_attack' || conditionalEffectOnAccept === 'cant_attack_controller') {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            for (const playerId of playersWhoAccepted) {
              for (const creature of battlefield) {
                const battlefieldCreature = creature as any;
                if (!battlefieldCreature || String(battlefieldCreature.controller || '') !== playerId) continue;
                battlefieldCreature.cantAttackPlayers = battlefieldCreature.cantAttackPlayers || {};
                battlefieldCreature.cantAttackPlayers[sourceController] = {
                  until: 'next_turn',
                  sourcePlayer: sourceController,
                };
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counterPlacementResolve): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
