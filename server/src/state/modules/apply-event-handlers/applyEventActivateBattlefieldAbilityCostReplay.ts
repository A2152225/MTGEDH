// server/src/state/modules/apply-event-handlers/applyEventActivateBattlefieldAbilityCostReplay.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts
// (activateBattlefieldAbility case body cluster).
//
// Cluster: Replay recorded activation costs (discard/exile/sac/tap/mana/life/hideaway).
// Public entry: applyActivateBattlefieldAbilityCostReplay(ctx, e) -> true when
// Humble Defector handling already finished the activation (original case break).
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { buildDiscardProvenanceFields } from "../graveyardEntryUtils.js";
import { drawCards, movePermanentToHand } from "../zones";
import { updateCounters, movePermanentToGraveyard } from "../counters_tokens";
import { cardFromHideawayToHand, clearStoredHideawayCard } from "../hideawayExile.js";
import { syncPreparedPermanentAfterControlChange } from "../prepared.js";
import { rememberReplayManaActivationLifeCost } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { getOrInitManaPool } from "../../../socket/util.js";

export function applyActivateBattlefieldAbilityCostReplay(ctx: GameContext, e: GameEvent): boolean {
  const stateAny = ctx.state as any;
  const playerId = (e as any).playerId;
  const permId = (e as any).permanentId;
  const abilityId = (e as any).abilityId;
  const abilityText = String((e as any).abilityText || '');
  const activatedAbilityText = String((e as any).activatedAbilityText || '');
  const activatedAbilityIndex = Number((e as any).activatedAbilityIndex);


          // If the server persisted which cards were discarded from hand to pay activation costs,
          // apply those discards during replay so zones are deterministic.
          try {
            const discarded = (e as any).discardedCardIds;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(discarded) && discarded.length > 0) {
              (ctx.state as any).zones = (ctx.state as any).zones || {};
              const zones = (ctx.state as any).zones;
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                for (const cid of discarded) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.hand as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.hand as any[]).splice(idx, 1);
                  (z.graveyard as any[]).push({
                    ...card,
                    zone: 'graveyard',
                    ...buildDiscardProvenanceFields(ctx.state, pid),
                  });
                }

                z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;

                const stateAny = ctx.state as any;
                stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                stateAny.discardedCardThisTurn[pid] = true;
                stateAny.anyPlayerDiscardedCardThisTurn = true;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which cards were exiled from hand to pay activation costs,
          // apply those exiles during replay so zones are deterministic.
          try {
            const exiledFromHand = (e as any).exiledCardIdsFromHandForCost;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(exiledFromHand) && exiledFromHand.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                z.exile = Array.isArray(z.exile) ? z.exile : [];

                for (const cid of exiledFromHand) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.hand as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.hand as any[]).splice(idx, 1);
                  (z.exile as any[]).push({ ...card, zone: 'exile' });
                }

                z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                if (z.exileCount !== undefined) z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

                const stateAny = ctx.state as any;
                stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                stateAny.discardedCardThisTurn[pid] = true;
                stateAny.anyPlayerDiscardedCardThisTurn = true;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were sacrificed to pay activation costs,
          // apply those sacrifices during replay so battlefield state is deterministic.
          try {
            const sacrificed = (e as any).sacrificedPermanents;
            if (Array.isArray(sacrificed) && sacrificed.length > 0) {
              for (const sid of sacrificed) {
                const id = String(sid || '').trim();
                if (!id) continue;
                // Best-effort: only move if still on battlefield.
                const bf = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                const permanent = bf.find((p: any) => p && String(p.id) === id) as any;
                if (!permanent) continue;
                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
                movePermanentToGraveyard(ctx as any, id, true);

                if (tokenGraveyardSnapshot && graveyardOwnerId) {
                  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                  const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                    hand: [],
                    handCount: 0,
                    libraryCount: 0,
                    graveyard: [],
                    graveyardCount: 0,
                    exile: [],
                    exileCount: 0,
                  });
                  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                    if (!card) return false;
                    const cardId = String((card as any).id || '').trim();
                    const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                    if (cardId && snapshotId) return cardId === snapshotId;
                    return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                  });

                  if (!alreadyPresent) {
                    (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were returned to hand to pay activation costs,
          // apply those bounces during replay so battlefield/zones are deterministic.
          try {
            const returned = (e as any).returnedPermanentsToHandForCost;
            if (Array.isArray(returned) && returned.length > 0) {
              for (const rid of returned) {
                const id = String(rid || '').trim();
                if (!id) continue;
                // Best-effort: only move if still on battlefield.
                const bf = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                if (!bf.some((p: any) => p && String(p.id) === id)) continue;
                movePermanentToHand(ctx as any, id);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were tapped to pay activation costs,
          // apply those taps during replay so battlefield state is deterministic.
          try {
            const tapped = (e as any).tappedPermanents;
            if (Array.isArray(tapped) && tapped.length > 0) {
              const battlefield = ctx.state.battlefield || [];
              const tappedSet = new Set(tapped.map((x: any) => String(x)));
              const unresolvedTapped: string[] = [];

              for (const p of battlefield as any[]) {
                if (!p) continue;
                if (tappedSet.has(String(p.id))) {
                  (p as any).tapped = true;
                }
              }

              for (const targetId of tappedSet) {
                const found = (battlefield as any[]).some((permanent: any) => permanent && String(permanent.id || '') === targetId);
                if (!found) unresolvedTapped.push(targetId);
              }

              const tapCostTargetFilter = (e as any).tapCostTargetFilter;
              if (unresolvedTapped.length > 0 && tapCostTargetFilter && typeof tapCostTargetFilter === 'object') {
                const controllerFilter = String((tapCostTargetFilter as any).controller || 'any').toLowerCase();
                const tapStatus = String((tapCostTargetFilter as any).tapStatus || 'any').toLowerCase();
                const excludeSource = (tapCostTargetFilter as any).excludeSource === true;
                const requireAllTypes = (tapCostTargetFilter as any).requireAllTypes === true;
                const filterTypes = Array.isArray((tapCostTargetFilter as any).types)
                  ? (tapCostTargetFilter as any).types.map((value: any) => String(value || '').toLowerCase()).filter(Boolean)
                  : [];
                const sourcePermanentId = String(permId || '').trim();
                const preferTokens = (e as any).tapCostPreferTokens === true;
                const preferNonTokens = (e as any).tapCostPreferNonTokens === true;
                const neededCount = Math.max(
                  unresolvedTapped.length,
                  Number.isFinite(Number((e as any).tapCostTargetCount)) ? Number((e as any).tapCostTargetCount) : unresolvedTapped.length
                );

                const candidates = (battlefield as any[])
                  .filter((permanent: any) => {
                    if (!permanent) return false;
                    const permanentId = String(permanent.id || '').trim();
                    if (!permanentId) return false;
                    if (excludeSource && sourcePermanentId && permanentId === sourcePermanentId) return false;
                    if (tappedSet.has(permanentId)) return false;

                    if (controllerFilter === 'you' && String(permanent.controller || '') !== String(playerId || '')) return false;
                    if (controllerFilter === 'opponent' && String(permanent.controller || '') === String(playerId || '')) return false;
                    if (tapStatus === 'tapped' && !permanent.tapped) return false;
                    if (tapStatus === 'untapped' && permanent.tapped) return false;

                    if (filterTypes.length > 0) {
                      const typeLine = String(permanent.card?.type_line || permanent.type_line || permanent.cardType || '').toLowerCase();
                      const matches = requireAllTypes
                        ? filterTypes.every((type: string) => typeLine.includes(type))
                        : filterTypes.some((type: string) => typeLine.includes(type));
                      if (!matches) return false;
                    }

                    return true;
                  })
                  .map((permanent: any, index: number) => {
                    let score = 0;
                    if (preferTokens && permanent.isToken) score += 100;
                    if (preferNonTokens && !permanent.isToken) score += 100;
                    return { permanent, index, score };
                  })
                  .sort((left: any, right: any) => {
                    if (right.score !== left.score) return right.score - left.score;
                    return left.index - right.index;
                  })
                  .slice(0, neededCount);

                for (const candidate of candidates) {
                  if (candidate?.permanent) {
                    candidate.permanent.tapped = true;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted that activating this ability exerted the source as a cost,
          // restore the next-untap restriction and turn-scoped exert marker during replay.
          try {
            const exertedPermanentId = String((e as any).exertedPermanentIdForCost || '').trim();
            if (exertedPermanentId) {
              const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === exertedPermanentId) as any;
              if (permanent) {
                permanent.doesntUntapNextTurn = true;
                permanent.exertedThisTurn = true;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted the net mana-pool change caused by paying activation costs,
          // apply it during replay so exact floating-mana restoration survives undo/restart.
          try {
            const manaDelta = (e as any).paymentManaDelta;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              const pool = getOrInitManaPool(ctx.state as any, pid as any) as any;
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                pool[poolKey] = Number(pool[poolKey] || 0) + amount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted counter updates performed by shortcut activations,
          // apply them during replay so counter state survives undo/restart.
          try {
            const counterUpdates = Array.isArray((e as any).counterUpdates) ? (e as any).counterUpdates : [];
            for (const entry of counterUpdates) {
              const permanentId = String(entry?.permanentId || '').trim();
              const deltas = entry?.deltas;
              if (!permanentId || !deltas || typeof deltas !== 'object' || Array.isArray(deltas)) continue;
              // Parent event already recorded the final deltas; do not re-emit updateCounters or
              // re-apply Vorinclex/Doubling Season modifiers during replay/apply.
              updateCounters(ctx as any, permanentId, deltas as Record<string, number>, {
                skipEventPersistence: true,
                skipCounterModifications: true,
              });
            }
          } catch (err) {
            debugWarn(1, 'applyEvent(activateBattlefieldAbility): counterUpdates failed', err);
          }

          // If the server persisted a hideaway card moving to hand, replay that zone change
          // and clear the source permanent's hidden card so reconnect/undo stay deterministic.
          try {
            const movedHideawayCard = (e as any).hideawayMovedCardToHand;
            const clearedHideawayPermanentId = String((e as any).clearedHideawayPermanentId || permId || '').trim();
            const pid = playerId != null ? String(playerId) : '';
            if (pid && movedHideawayCard && typeof movedHideawayCard === 'object' && !Array.isArray(movedHideawayCard)) {
              const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
              const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
              z.hand = Array.isArray(z.hand) ? z.hand : [];
              (z.hand as any[]).push(cardFromHideawayToHand(movedHideawayCard));
              z.handCount = (z.hand as any[]).length;
            }

            if (clearedHideawayPermanentId) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === clearedHideawayPermanentId) as any;
              if (permanent) {
                clearStoredHideawayCard(ctx.state, permanent, pid);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted a queued battlefield prompt for an activation,
          // rebuild that prompt during replay so reconnect/undo preserves the pre-response state.
          try {
            const rawStep = (e as any).queuedResolutionStep;
            const gameId = String((ctx as any).gameId || '').trim();
            const stepId = String((rawStep as any)?.id || '').trim();
            const stepType = String((rawStep as any)?.type || '').trim();
            if (gameId && rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep) && stepType) {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === stepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === stepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(gameId, {
                  ...(rawStep as any),
                  ...(stepId ? { id: stepId } : {}),
                  type: stepType as any,
                  playerId: String((rawStep as any).playerId || playerId || '') as any,
                  description: String((rawStep as any).description || ''),
                  mandatory: (rawStep as any).mandatory !== false,
                } as any);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted an immediate until-end-of-turn animation shortcut,
          // apply it during replay so the permanent's temporary state is deterministic.
          try {
            const animation = (e as any).specialAnimation;
            if (permId && animation && typeof animation === 'object' && !Array.isArray(animation)) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId)) as any;
              if (permanent) {
                if ((animation as any).animatedUntilEOT === true) permanent.animatedUntilEOT = true;
                if (Number.isFinite(Number((animation as any).basePower))) permanent.basePower = Number((animation as any).basePower);
                if (Number.isFinite(Number((animation as any).baseToughness))) permanent.baseToughness = Number((animation as any).baseToughness);
                if (Number.isFinite(Number((animation as any).effectivePower))) permanent.effectivePower = Number((animation as any).effectivePower);
                if (Number.isFinite(Number((animation as any).effectiveToughness))) permanent.effectiveToughness = Number((animation as any).effectiveToughness);
                if (Array.isArray((animation as any).typeAdditions)) {
                  permanent.typeAdditions = Array.from(
                    new Set(
                      [
                        ...(Array.isArray(permanent.typeAdditions) ? permanent.typeAdditions : []),
                        ...((animation as any).typeAdditions as any[]),
                      ].map((value: any) => String(value || '').trim()).filter(Boolean)
                    )
                  );
                }
                if ((animation as any).hasAllCreatureTypes === true) permanent.hasAllCreatureTypes = true;
                if ((animation as any).untilEndOfTurn && typeof (animation as any).untilEndOfTurn === 'object') {
                  permanent.untilEndOfTurn = {
                    ...(permanent.untilEndOfTurn && typeof permanent.untilEndOfTurn === 'object' ? permanent.untilEndOfTurn : {}),
                    ...((animation as any).untilEndOfTurn || {}),
                  };
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which counters were removed to pay activation costs,
          // apply those counter removals during replay so battlefield state is deterministic.
          try {
            const removed = (e as any).removedCountersForCost;
            if (Array.isArray(removed) && removed.length > 0) {
              for (const entry of removed) {
                const permanentId = String(entry?.permanentId || '').trim();
                const counterType = String(entry?.counterType || '').trim();
                const count = Number(entry?.count || 0);
                if (!permanentId || !counterType || !Number.isFinite(count) || count <= 0) continue;
                updateCounters(ctx as any, permanentId, { [counterType]: -count }, {
                  skipEventPersistence: true,
                  skipCounterModifications: true,
                });
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted life paid to activate this ability, apply it during replay.
          try {
            const paid = Number((e as any).lifePaidForCost || 0);
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Number.isFinite(paid) && paid > 0) {
              (ctx.state as any).life = (ctx.state as any).life || {};
              const cur = Number((ctx.state as any).life?.[pid] ?? 40);
              (ctx.state as any).life[pid] = Math.max(0, cur - paid);
              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[pid] = ((ctx.state as any).lifeLostThisTurn[pid] || 0) + paid;

              const player = Array.isArray((ctx.state as any).players)
                ? (ctx.state as any).players.find((entry: any) => entry && String(entry.id || '') === pid)
                : null;
              if (player) {
                player.life = (ctx.state as any).life[pid];
              }

              rememberReplayManaActivationLifeCost(ctx.state, pid, permId, (e as any).abilityId, paid);
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which cards were exiled from the activator's graveyard to pay activation costs,
          // apply those exiles during replay so zones are deterministic.
          try {
            const exiled = (e as any).exiledCardIdsFromGraveyardForCost;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(exiled) && exiled.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                z.exile = Array.isArray(z.exile) ? z.exile : [];

                for (const cid of exiled) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.graveyard as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.graveyard as any[]).splice(idx, 1);
                  (z.exile as any[]).push({ ...card, zone: 'exile' });
                }

                z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                if (z.exileCount !== undefined) z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted Blight N as an activation cost ("put N -1/-1 counters on a creature you control"),
          // apply the counters during replay so battlefield state is deterministic.
          try {
            const blightTargetId = String((e as any).blightTargetPermanentIdForCost || '').trim();
            const blightN = Number((e as any).blightNForCost || 0);
            if (blightTargetId && Number.isFinite(blightN) && blightN > 0) {
              updateCounters(ctx as any, blightTargetId, { '-1/-1': blightN }, {
                skipEventPersistence: true,
                skipCounterModifications: true,
              });
            }
          } catch {
            // best-effort only
          }

          try {
            const persistedAbilityType = String((e as any).abilityType || '').trim().toLowerCase();
            if (persistedAbilityType === 'humble-defector') {
              drawCards(ctx as any, String(playerId || ''), 2);

              const targetOpponentId = String((e as any).targetOpponentId || '').trim();
              if (targetOpponentId) {
                const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                const humbleDefector = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId || '')) as any;
                if (humbleDefector) {
                  const previousController = String(humbleDefector.controller || '');
                  humbleDefector.controller = targetOpponentId;
                  syncPreparedPermanentAfterControlChange(ctx.state, humbleDefector, previousController);
                  humbleDefector.summoningSickness = true;
                }
              }

              ctx.bumpSeq();
              return true;
            }
          } catch {
            // best-effort only
          }

          // If the server persisted the full activated ability text (including cost),
          // attach it to the matching ability stack item to support intervening-if inference.
          try {
            if (activatedAbilityText) {
              const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  (item as any).activatedAbilityText = activatedAbilityText;
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }
  return false;
}
