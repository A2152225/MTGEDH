// server/src/state/modules/apply-event-handlers/applyEventActivateAbilityEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Non-battlefield activated abilities: sacrifice-draw, doubling cube, upgrade, tutor, planeswalker, cycling.
// Public entry: applyActivateAbilityEvents(ctx, e) -> true when it handled the event.
//
// Handles: activateAbility, activateSacrificeDrawAbility, activateDoublingCube, activateUpgradeAbility, activateTutorAbility, activatePlaneswalkerAbility, activateCycling
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardPutIntoGraveyardThisTurn } from "../turn-tracking.js";
import { filterLibraryCardsForSearch } from "../../../socket/library-search.js";
import { updateCounters, movePermanentToGraveyard } from "../counters_tokens";
import { generateDeterministicId } from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  consumeRecordedManaCostFromPool,
  applyAIActivateAbilityReplay,
  extractReplayActivationCost,
  snapshotLibraryForReplay,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { parsePlaneswalkerAbilities } from "../triggered-abilities.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import {
  parseUpgradeAbilities as parseCreatureUpgradeAbilities,
} from "../../../../../rules-engine/src/creatureUpgradeAbilities.js";
import { detectTutorEffect, getActivatedAbilityScopeText, parseSearchCriteria } from "../../../socket/interaction.js";

export function applyActivateAbilityEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "activateAbility": {
        try {
          applyAIActivateAbilityReplay(ctx as any, e as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(activateAbility): failed', err);
        }
        break;
      }

      case "activateSacrificeDrawAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const manaCost = String((e as any).manaCost || '').trim();
          if (!playerId || !permanentId) break;

          const stateAny = ctx.state as any;
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === permanentId);
          if (permIndex === -1) break;

          const zones = stateAny.zones = stateAny.zones || {};
          const zoneState = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
          };

          if (manaCost) {
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              colorless: 0,
            };
            consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
          }

          movePermanentToGraveyard(ctx as any, permanentId, true);

          const libraries = (ctx as any).libraries;
          const mapLibrary = libraries && typeof libraries.get === 'function' ? libraries.get(playerId) : undefined;
          const zoneLibrary = Array.isArray(zoneState.library) ? zoneState.library : undefined;
          const activeLibrary = Array.isArray(zoneLibrary) ? zoneLibrary : (Array.isArray(mapLibrary) ? mapLibrary : []);
          if (activeLibrary.length > 0) {
            const drawnCard = activeLibrary.shift();
            zoneState.hand = Array.isArray(zoneState.hand) ? zoneState.hand : [];
            (zoneState.hand as any[]).push({ ...drawnCard, zone: 'hand' });
            zoneState.handCount = (zoneState.hand as any[]).length;
          }
          zoneState.libraryCount = activeLibrary.length;
          if (Array.isArray(zoneLibrary)) {
            zoneState.library = activeLibrary;
          }
          if (libraries && typeof libraries.set === 'function') {
            libraries.set(playerId, activeLibrary);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateSacrificeDrawAbility): failed', err);
        }
        break;
      }

      case "activateDoublingCube": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          if (!playerId || !permanentId) break;

          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          const manaPool = stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };

          let remaining = 3;
          const poolCopy = {
            white: Number(manaPool.white || 0),
            blue: Number(manaPool.blue || 0),
            black: Number(manaPool.black || 0),
            red: Number(manaPool.red || 0),
            green: Number(manaPool.green || 0),
            colorless: Number(manaPool.colorless || 0),
          };

          const colorlessUsed = Math.min(remaining, poolCopy.colorless);
          poolCopy.colorless -= colorlessUsed;
          remaining -= colorlessUsed;

          if (remaining > 0) {
            const colors: Array<'white' | 'blue' | 'black' | 'red' | 'green'> = ['white', 'blue', 'black', 'red', 'green'];
            for (const color of colors) {
              if (remaining <= 0) break;
              const used = Math.min(remaining, poolCopy[color]);
              poolCopy[color] -= used;
              remaining -= used;
            }
          }

          stateAny.manaPool[playerId] = {
            white: poolCopy.white * 2,
            blue: poolCopy.blue * 2,
            black: poolCopy.black * 2,
            red: poolCopy.red * 2,
            green: poolCopy.green * 2,
            colorless: poolCopy.colorless * 2,
          };

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (permanent) {
            (permanent as any).tapped = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateDoublingCube): failed', err);
        }
        break;
      }

      case "activateUpgradeAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const upgradeIndexRaw = Number((e as any).upgradeIndex ?? 0);
          const upgradeIndex = Number.isFinite(upgradeIndexRaw) && upgradeIndexRaw >= 0 ? Math.floor(upgradeIndexRaw) : 0;
          if (!playerId || !permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (!permanent) break;

          const oracleText = String((permanent as any)?.card?.oracle_text || '');
          const cardName = String((permanent as any)?.card?.name || (e as any).cardName || '');
          const parsedUpgrades = parseCreatureUpgradeAbilities(oracleText, cardName);
          const upgrade = parsedUpgrades[upgradeIndex] || parsedUpgrades[0];
          if (!upgrade) break;

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
          consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], String(upgrade.cost || '').trim());

          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackId = generateDeterministicId(ctx, 'ability_upgrade', `${permanentId}:${upgradeIndex}`);
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: playerId,
              source: permanentId,
              sourceName: cardName,
              description: upgrade.fullText,
              abilityType: 'creature-upgrade',
              upgradeData: {
                newTypes: upgrade.newTypes,
                newPower: upgrade.newPower,
                newToughness: upgrade.newToughness,
                keywords: upgrade.keywords,
                counterCount: upgrade.counterCount,
                counterType: upgrade.counterType,
              },
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateUpgradeAbility): failed', err);
        }
        break;
      }

      case "activateTutorAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const abilityId = String((e as any).abilityId || '').trim();
          if (!playerId || !permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (!permanent) break;

          const card = (permanent as any)?.card || {};
          const oracleText = String(card.oracle_text || '');
          const cardName = String(card.name || (e as any).cardName || '');
          const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText.toLowerCase(), abilityId);
          const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
          const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText || '').trim();
          const tutorInfo = detectTutorEffect(scopedAbilityText || scopedAbilityFullText || oracleText);
          if (!tutorInfo.isTutor) break;

          const { requiresTap, manaCost, sacrificesSource } = extractReplayActivationCost(scopedAbilityFullText);
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
          consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);

          if (sacrificesSource) {
            const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
              ? { ...(permanent.card || {}), zone: 'graveyard' }
              : null;
            const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
            movePermanentToGraveyard(ctx as any, permanentId, true);

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
          } else if (requiresTap) {
            (permanent as any).tapped = true;
          }

          const filter = parseSearchCriteria(String(tutorInfo.searchCriteria || ''));
          const isSplit = tutorInfo.splitDestination === true;
          const destination = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped')
            ? 'battlefield'
            : (tutorInfo.destination === 'exile')
              ? 'exile'
              : 'hand';

          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'ability_tutor', `${permanentId}:${abilityId}`);
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: playerId,
              source: permanentId,
              sourceName: cardName,
              description: scopedAbilityText || scopedAbilityFullText,
              activatedAbilityText: scopedAbilityFullText || scopedAbilityText,
              abilityType: 'tutor',
              searchParams: {
                filter,
                searchCriteria: tutorInfo.searchCriteria,
                maxSelections: tutorInfo.maxSelections || 1,
                destination: tutorInfo.destination || 'hand',
                entersTapped: tutorInfo.entersTapped,
                splitDestination: tutorInfo.splitDestination,
                toBattlefield: tutorInfo.toBattlefield,
                toHand: tutorInfo.toHand,
              },
            });
          }

          const queue = ResolutionQueueManager.getQueue(ctx.gameId);
          const queueAlreadyPresent = queue.steps.some((step: any) =>
            step &&
            String((step as any).type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
            String((step as any).playerId || '') === playerId &&
            String((step as any).sourceName || '') === cardName &&
            String((step as any).searchCriteria || '') === String(tutorInfo.searchCriteria || 'any card')
          );
          if (!queueAlreadyPresent) {
            ResolutionQueueManager.addStep(ctx.gameId, {
              type: ResolutionStepType.LIBRARY_SEARCH,
              playerId: playerId as any,
              sourceName: cardName,
              description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
              searchCriteria: tutorInfo.searchCriteria || 'any card',
              minSelections: 0,
              maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
              mandatory: false,
              destination,
              reveal: false,
              shuffleAfter: true,
              availableCards: filterLibraryCardsForSearch(snapshotLibraryForReplay(ctx, playerId), filter, (ctx as any).state, playerId),
              filter,
              splitDestination: isSplit,
              toBattlefield: tutorInfo.toBattlefield || 1,
              toHand: tutorInfo.toHand || 1,
              entersTapped: tutorInfo.entersTapped || false,
            } as any);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateTutorAbility): failed', err);
        }
        break;
      }

      case "activatePlaneswalkerAbility": {
        // Planeswalker ability: adjust loyalty counters
        const permId = (e as any).permanentId;
        const loyaltyCost = (e as any).loyaltyCost || 0;
        const abilityIndex = (e as any).abilityIndex;
        const playerId = String((e as any).playerId || '').trim();
        try {
          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              // Match live activation semantics (no Doubling Season on cost apply here);
              // skipEventPersistence because this parent event already records the change.
              if (loyaltyCost) {
                updateCounters(ctx as any, String(permId), { loyalty: Number(loyaltyCost) || 0 }, {
                  skipEventPersistence: true,
                  skipCounterModifications: true,
                });
              }

              const parsed = parsePlaneswalkerAbilities((perm as any).card, perm);
              const loyaltyAbility = Number.isFinite(Number(abilityIndex))
                ? parsed?.abilities?.[Number(abilityIndex)]
                : undefined;
              const persistedAbilityText = String((e as any).abilityText || '').trim();
              const persistedActivatedAbilityText = String((e as any).activatedAbilityText || '').trim();
              const persistedStackItemId = String((e as any).stackItemId || '').trim();

              const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : ((ctx.state as any).stack = []);
              const existing = stack.find((item: any) =>
                item &&
                String(item.type || '') === 'ability' &&
                (
                  (persistedStackItemId && String(item.id || '') === persistedStackItemId) ||
                  (
                    String((item as any).source || '') === String(permId) &&
                    String((item as any).controller || '') === playerId &&
                    Number((item as any)?.planeswalker?.abilityIndex ?? -1) === Number(abilityIndex)
                  )
                )
              );

              if (!existing && loyaltyAbility) {
                stack.push({
                  id: persistedStackItemId || generateDeterministicId(ctx, 'ability_planeswalker', `${String(permId)}:${String(abilityIndex)}`),
                  type: 'ability',
                  controller: playerId || String((perm as any).controller || ''),
                  source: String(permId),
                  sourceName: String((perm as any)?.card?.name || 'Planeswalker'),
                  description: persistedAbilityText || String((loyaltyAbility as any).effect || ''),
                  activatedAbilityText: persistedActivatedAbilityText || `${String((loyaltyAbility as any).costDisplay || loyaltyCost)}: ${String((loyaltyAbility as any).effect || '')}`,
                  planeswalker: {
                    oracleId: (perm as any)?.card?.oracle_id,
                    abilityIndex: Number(abilityIndex),
                    loyaltyCost: Number(loyaltyCost),
                  },
                });
              }
            }
          }

          try {
            const persistedTargets = Array.isArray((e as any).targets) ? (e as any).targets : null;
            const retargetValidTargets = Array.isArray((e as any).copyRetargetValidTargets) ? (e as any).copyRetargetValidTargets : null;
            const retargetTargetTypes = Array.isArray((e as any).copyRetargetTargetTypes) ? (e as any).copyRetargetTargetTypes : null;
            const retargetMinTargets = Number((e as any).copyRetargetMinTargets ?? NaN);
            const retargetMaxTargets = Number((e as any).copyRetargetMaxTargets ?? NaN);
            const retargetTargetDescription = String((e as any).copyRetargetTargetDescription || '');
            const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
            if (Array.isArray(stack) && stack.length > 0) {
              for (let i = stack.length - 1; i >= 0; i--) {
                const item = stack[i];
                if (!item || String(item.type || '') !== 'ability') continue;
                if (permId != null && String((item as any).source || '') !== String(permId)) continue;
                if (abilityIndex != null && Number((item as any)?.planeswalker?.abilityIndex ?? -1) !== Number(abilityIndex)) continue;
                if (persistedTargets) {
                  (item as any).targets = persistedTargets.map((id: any) => String(id));
                }
                if (retargetValidTargets) {
                  (item as any).copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                  (item as any).copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                  if (Number.isFinite(retargetMinTargets)) (item as any).copyRetargetMinTargets = retargetMinTargets;
                  if (Number.isFinite(retargetMaxTargets)) (item as any).copyRetargetMaxTargets = retargetMaxTargets;
                  if (retargetTargetDescription) (item as any).copyRetargetTargetDescription = retargetTargetDescription;
                }
                break;
              }
            }
          } catch {
            // best-effort only
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activatePlaneswalkerAbility): failed", err);
        }
        break;
      }

      case "activateCycling": {
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const cardName = String((e as any).cardName || 'Unknown');
        const cyclingCost = String((e as any).cyclingCost || '');
        const stackId = String((e as any).stackId || generateDeterministicId(ctx, 'ability_cycling', String(cardId || cardName || 'card')));
        const abilityId = String((e as any).abilityId || 'cycling');
        const stackAbilityType = String((e as any).stackAbilityType || ((e as any).searchCriteria ? 'typecycling' : 'cycling'));
        const stackDescription = String((e as any).stackDescription || (stackAbilityType === 'typecycling' ? 'Search your library' : 'Draw a card'));
        const searchCriteria = typeof (e as any).searchCriteria === 'string' ? String((e as any).searchCriteria) : undefined;
        const searchFilter = ((e as any).searchFilter && typeof (e as any).searchFilter === 'object')
          ? { ...((e as any).searchFilter as any) }
          : undefined;
        try {
          const zones = (ctx.state as any)?.zones?.[pid];
          if (zones && Array.isArray(zones.hand) && cardId) {
            const hand = zones.hand as any[];
            const handIndex = hand.findIndex((card: any) => String(card?.id) === String(cardId));
            if (handIndex !== -1) {
              const [card] = hand.splice(handIndex, 1);
              zones.graveyard = zones.graveyard || [];
              (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
              zones.handCount = hand.length;
              zones.graveyardCount = (zones.graveyard as any[]).length;
              recordCardPutIntoGraveyardThisTurn(ctx as any, String(pid), card, { fromBattlefield: false });
            }
          }

          const manaPool = (ctx.state as any)?.manaPool?.[pid];
          if (manaPool && cyclingCost) {
            consumeRecordedManaCostFromPool(manaPool as Record<string, number>, cyclingCost);
          }

          const stateAny = ctx.state as any;
          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id) === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: pid,
              source: cardId,
              sourceName: cardName,
              description: stackDescription,
              abilityType: stackAbilityType,
              abilityId,
              cardId,
              cardName,
              searchCriteria,
              searchFilter,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateCycling): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
