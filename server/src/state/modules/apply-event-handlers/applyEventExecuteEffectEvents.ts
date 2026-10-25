import { applyTurnFaceUpCostEffects } from '../turnFaceUpCostPayment.js';
// server/src/state/modules/apply-event-handlers/applyEventExecuteEffectEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Generic executeEffect dispatch plus foretell, suspend, morph turn-face-up and phasing.
// Public entry: applyExecuteEffectEvents(ctx, e) -> true when it handled the event.
//
// Handles: executeEffect, foretellCard, suspendCard, morphTurnFaceUp, phaseOutPermanents
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { pushCardToGraveyardFromLibrary } from "../graveyardEntryUtils.js";
import { parsePT } from "../../utils";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../durable-permissions.js";
import { clearReplayQueuedSteps, clearReplayQueuedStepById } from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  applyReplaySacrificedPermanent,
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  reorderLibraryByIdList,
  buildLibraryFromRemainingIds,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { hydratePermanentCardOracleInPlace } from "../cardOracleHydration.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { consumeReplayedTriggeredAbilityStackItems } from "../replay-prompt-cleanup.js";
import { getOrInitManaPool } from "../../../socket/util.js";
import { addTemporaryEtbTrigger } from "../triggerEtbEntryEffects-handlers/triggerEtbTemporaryEntryTriggers.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

export function applyExecuteEffectEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "executeEffect": {
        // Execute a game effect (token creation, life change, draw, mill, etc.)
        const effectType = (e as any).effectType;
        const controllerId = (e as any).controllerId;
        const targetId = (e as any).targetId;
        const amount = (e as any).amount;
        const tokenData = (e as any).tokenData;

        if (
          (ctx as any).isReplaying
          && ((e as any).oracleIrReplayMutation === true || (e as any).effectProgramMutation === true)
        ) {
          consumeReplayedTriggeredAbilityStackItems(ctx, e as Record<string, unknown>);
        }
        
        try {
          switch (effectType) {
            case 'createToken': {
              if (tokenData) {
                ctx.state.battlefield = ctx.state.battlefield || [];
                const tokenId = tokenData.id || `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const typeLine = String(tokenData.typeLine || '');
                const isCreature = typeLine.toLowerCase().includes('creature');
                const rawPower = tokenData.power;
                const rawToughness = tokenData.toughness;
                const power = Number.isFinite(Number(rawPower)) ? Number(rawPower) : undefined;
                const toughness = Number.isFinite(Number(rawToughness)) ? Number(rawToughness) : undefined;
                
                // Check if token already exists (replay idempotency)
                const existingToken = ctx.state.battlefield.find((p: any) => p.id === tokenId);
                if (existingToken) {
                  debug(1, `applyEvent(executeEffect/createToken): token ${tokenId} already exists, skipping`);
                  break;
                }
                
                ctx.state.battlefield.push({
                  id: tokenId,
                  controller: controllerId,
                  owner: controllerId,
                  tapped: false,
                  counters: {},
                  ...(power != null ? { basePower: power } : {}),
                  ...(toughness != null ? { baseToughness: toughness } : {}),
                  summoningSickness: isCreature && !tokenData.hasHaste,
                  isToken: true,
                  ...(tokenData.isCopyToken || tokenData.copiedFromPermanentId
                    ? { isCopyToken: true, isCopyOfPrintedCard: true }
                    : {}),
                  ...(tokenData.copiedFromPermanentId
                    ? { copiedFromPermanentId: String(tokenData.copiedFromPermanentId) }
                    : {}),
                  ...(tokenData.chosenCreatureType
                    ? { chosenCreatureType: String(tokenData.chosenCreatureType) }
                    : {}),
                  ...(tokenData.chosenColor ? { chosenColor: String(tokenData.chosenColor) } : {}),
                  ...(tokenData.chosenCardName ? { chosenCardName: String(tokenData.chosenCardName) } : {}),
                  ...(tokenData.chosenPlayer ? { chosenPlayer: String(tokenData.chosenPlayer) } : {}),
                  card: {
                    id: tokenId,
                    name: tokenData.name,
                    type_line: typeLine,
                    ...(power != null ? { power: String(power) } : {}),
                    ...(toughness != null ? { toughness: String(toughness) } : {}),
                    colors: tokenData.colors || [],
                    oracle_text: String(tokenData.oracleText || tokenData.abilities?.join(', ') || ''),
                    keywords: tokenData.abilities || [],
                    zone: 'battlefield',
                    ...(tokenData.chosenCreatureType
                      ? { chosenCreatureType: String(tokenData.chosenCreatureType) }
                      : {}),
                    ...(tokenData.chosenColor ? { chosenColor: String(tokenData.chosenColor) } : {}),
                    ...(tokenData.chosenCardName ? { chosenCardName: String(tokenData.chosenCardName) } : {}),
                    ...(tokenData.chosenPlayer ? { chosenPlayer: String(tokenData.chosenPlayer) } : {}),
                  },
                } as any);
                stampPermanentEntryTimestamp(ctx.state, ctx.state.battlefield[ctx.state.battlefield.length - 1]);
                const createdToken = ctx.state.battlefield[ctx.state.battlefield.length - 1];
                try {
                  hydratePermanentCardOracleInPlace(createdToken);
                } catch {
                  // best-effort — printed oracle helps Morophon/Helm copies keep lords
                }
                // Restore Morophon / as-enters type map so lord effects survive restart.
                const restoredType = String(
                  tokenData.chosenCreatureType
                  || (createdToken as any)?.chosenCreatureType
                  || '',
                ).trim();
                if (
                  restoredType
                  && String(tokenData.name || (createdToken as any)?.card?.name || '').toLowerCase().includes('morophon')
                ) {
                  const morophonChosenType = ((ctx.state as any).morophonChosenType || {}) as Record<string, string>;
                  morophonChosenType[tokenId] = restoredType;
                  (ctx.state as any).morophonChosenType = morophonChosenType;
                }
                debug(2, `[applyEvent] Created token: ${tokenData.name} for ${controllerId}`);
              }
              break;
            }
            case 'dungeonExileCards': {
              const zones = ctx.state.zones = ctx.state.zones || {};
              const z = zones[controllerId] = zones[controllerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              const exiledCards = Array.isArray((e as any).exiledCards) ? (e as any).exiledCards as any[] : [];
              const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
              const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
                ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
                : [];
              const libraryAfter = hasLibraryAfterField
                ? cloneLibraryCards((e as any).libraryAfter as any[])
                : buildLibraryFromRemainingIds(
                    getPlayerLibraryFromContext(ctx, controllerId),
                    exiledCards,
                    remainingLibraryIds,
                  );
              z.exile = Array.isArray(z.exile) ? z.exile : [];
              for (const card of exiledCards) {
                if (!card || !String(card.id || '').trim()) continue;
                if ((z.exile as any[]).some((existing: any) => String(existing?.id || '') === String(card.id))) {
                  continue;
                }
                (z.exile as any[]).push({ ...card, zone: 'exile' });
              }
              z.exileCount = (z.exile as any[]).length;
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(controllerId, cloneLibraryCards(libraryAfter));
              }
              if ((e as any).grantPlayableFromExile === true) {
                const stateAny = ctx.state as any;
                stateAny.playableFromExile = stateAny.playableFromExile || {};
                const entry = (stateAny.playableFromExile[controllerId] = stateAny.playableFromExile[controllerId] || {});
                const grantedCardIds: string[] = [];
                for (const card of exiledCards) {
                  const grantedCardId = String(card?.id || '').trim();
                  if (!grantedCardId) continue;
                  entry[grantedCardId] = true;
                  grantedCardIds.push(grantedCardId);
                }
                if (grantedCardIds.length > 0) {
                  upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
                    playerId: controllerId as PlayerID,
                    cardIds: grantedCardIds,
                    action: 'play',
                    duration: 'static',
                    turnApplied: Number(stateAny.turnNumber || 0),
                    sourceName: String((e as any).sourceName || 'Dungeon').trim() || 'Dungeon',
                  }));
                }
              }
              break;
            }
            case 'dungeonDrawCards': {
              const zones = ctx.state.zones = ctx.state.zones || {};
              const z = zones[controllerId] = zones[controllerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              const drawnCards = Array.isArray((e as any).drawnCards) ? (e as any).drawnCards as any[] : [];
              const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
              const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
                ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
                : [];
              const libraryAfter = hasLibraryAfterField
                ? cloneLibraryCards((e as any).libraryAfter as any[])
                : buildLibraryFromRemainingIds(
                    getPlayerLibraryFromContext(ctx, controllerId),
                    drawnCards,
                    remainingLibraryIds,
                  );
              z.hand = Array.isArray(z.hand) ? z.hand : [];
              for (const card of drawnCards) {
                if (!card || !String(card.id || '').trim()) continue;
                if ((z.hand as any[]).some((existing: any) => String(existing?.id || '') === String(card.id))) {
                  continue;
                }
                (z.hand as any[]).push({ ...card, zone: 'hand' });
              }
              z.handCount = (z.hand as any[]).length;
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(controllerId, cloneLibraryCards(libraryAfter));
              }
              break;
            }
            case 'dungeonSetLibrary': {
              const zones = ctx.state.zones = ctx.state.zones || {};
              const z = zones[controllerId] = zones[controllerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
              const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
                ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
                : [];
              const libraryAfter = hasLibraryAfterField
                ? cloneLibraryCards((e as any).libraryAfter as any[])
                : reorderLibraryByIdList(
                    getPlayerLibraryFromContext(ctx, controllerId),
                    remainingLibraryIds,
                  );
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(controllerId, cloneLibraryCards(libraryAfter));
              }
              break;
            }
            case 'gainLife':
            case 'loseLife': {
              const player = (ctx.state.players || []).find((p: any) => p.id === targetId);
              if (player) {
                const delta = effectType === 'gainLife' ? amount : -amount;
                ctx.state.life = ctx.state.life || {};
                ctx.state.life[targetId] = (ctx.state.life[targetId] ?? 40) + delta;
                player.life = ctx.state.life[targetId];
                debug(1, `[applyEvent] ${targetId} ${effectType === 'gainLife' ? 'gained' : 'lost'} ${amount} life`);
              }
              break;
            }
            case 'drawCard': {
              // Draw is handled by drawCards, just bump seq
              break;
            }
            case 'mill': {
              const zones = ctx.state.zones?.[targetId] as any;
              if (zones?.library && Array.isArray(zones.library)) {
                for (let i = 0; i < amount && zones.library.length > 0; i++) {
                  const milledCard = zones.library.shift();
                  if (milledCard) {
                    zones.graveyard = zones.graveyard || [];
                    pushCardToGraveyardFromLibrary(ctx as any, String(targetId), milledCard, zones.graveyard);
                  }
                }
                zones.libraryCount = zones.library.length;
                zones.graveyardCount = (zones.graveyard || []).length;
                debug(2, `[applyEvent] ${targetId} milled ${amount} card(s)`);
              }
              break;
            }
            case 'grantTemporaryEtbTrigger': {
              const entry = (e as any).entry;
              if (entry && typeof entry === 'object') {
                const existing = Array.isArray((ctx.state as any)?.temporaryEtbTriggers)
                  ? (ctx.state as any).temporaryEtbTriggers
                  : [];
                const alreadyPresent = existing.some((current: any) => (
                  String(current?.controller || '') === String(entry?.controller || '')
                  && String(current?.sourceName || '') === String(entry?.sourceName || '')
                  && String(current?.effect || current?.description || '') === String(entry?.effect || entry?.description || '')
                ));
                if (!alreadyPresent) {
                  addTemporaryEtbTrigger(ctx.state, entry);
                }
              }
              break;
            }

          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(executeEffect): failed", err);
        }
        break;
      }

      case "foretellCard": {
        // Foretell: exile a card from hand face-down
        const pid = (e as any).playerId;
        const cardId = (e as any).cardId;
        const foretoldCardData = (e as any).card;
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          // Remove card from hand
          const hand = Array.isArray(z.hand) ? z.hand : [];
          const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
          if (cardIndex !== -1) {
            hand.splice(cardIndex, 1);
          }
          z.handCount = hand.length;
          
          // Add to exile with foretell data
          z.exile = z.exile || [];
          if (foretoldCardData) {
            (z.exile as any[]).push(foretoldCardData);
          }
          (z as any).exileCount = (z.exile as any[]).length;
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(foretellCard): failed", err);
        }
        break;
      }

      case "suspendCard": {
        const pid = (e as any).playerId;
        const cardId = (e as any).cardId;
        const suspendedCardData = (e as any).card;

        try {
          const playerId = String(pid || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.SUSPEND_CAST)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                const queuedCardId = String((step as any).card?.id || (step as any).cardId || '').trim();
                return !cardId || queuedCardId === String(cardId || '').trim();
              });
            }
          }

          if ((e as any).cancelled === true) break;

          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;

          const hand = Array.isArray(z.hand) ? z.hand : [];
          const cardIndex = hand.findIndex((c: any) => String(c?.id || '') === String(cardId || ''));
          if (cardIndex !== -1) {
            hand.splice(cardIndex, 1);
          }
          z.handCount = hand.length;

          try {
            const tappedPermanents = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (tappedPermanents.length > 0) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              for (const permanentId of tappedPermanents) {
                const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
                if (permanent) {
                  (permanent as any).tapped = true;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const sacrificedPermanents = Array.isArray((e as any).sacrificedPermanents)
              ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            for (const permanentId of sacrificedPermanents) {
              applyReplaySacrificedPermanent(ctx, permanentId);
            }
          } catch {
            // best-effort only
          }

          try {
            const manaDelta = (e as any).paymentManaDelta;
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

          z.exile = z.exile || [];
          if (suspendedCardData) {
            (z.exile as any[]).push(suspendedCardData);
          }
          (z as any).exileCount = (z.exile as any[]).length;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(suspendCard): failed", err);
        }
        break;
      }

      case "morphTurnFaceUp": {
        const permanentId = String((e as any).permanentId || '').trim();
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const actualCardData = (e as any).actualCard;

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.MORPH_TURN_FACE_UP)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                const queuedPermanentId = String((step as any).permanentId || '').trim();
                return !permanentId || queuedPermanentId === permanentId;
              });
            }
          }

          if ((e as any).cancelled === true) break;
          if (!permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
          if (!permanent) break;

          const actualCard = actualCardData && typeof actualCardData === 'object'
            ? { ...(actualCardData as any), zone: 'battlefield' }
            : (permanent.faceUpCard && typeof permanent.faceUpCard === 'object'
              ? { ...(permanent.faceUpCard as any), zone: 'battlefield' }
              : null);
          if (!actualCard) break;

          // Batch 13: special-action turn face up persists its payment; re-apply it on replay.
          if ((e as any).specialAction === true && (e as any).paymentAlreadyApplied !== true) {
            const tapped = Array.isArray((e as any).tappedPermanentIds) ? (e as any).tappedPermanentIds.map(String) : [];
            for (const tp of battlefield as any[]) if (tp && tapped.includes(String(tp.id))) tp.tapped = true;
            if (playerId) {
              applyTurnFaceUpCostEffects(ctx as any, String(playerId), {
                lifePaid: Number((e as any).lifePaid || 0),
                returnedPermanentIds: (e as any).returnedPermanentIds,
                sacrificedPermanentIds: (e as any).sacrificedPermanentIds,
                discardedCardIds: (e as any).discardedCardIds,
              }, { replay: true });
            }
          }

          permanent.isFaceDown = false;
          permanent.card = actualCard;

          const typeLine = String(actualCard?.type_line || '').toLowerCase();
          if (typeLine.includes('creature')) {
            permanent.basePower = parsePT((actualCard as any).power);
            permanent.baseToughness = parsePT((actualCard as any).toughness);
          }

          delete permanent.faceDownType;
          delete permanent.morphCost;
          delete permanent.faceUpCard;
          delete permanent.canTurnFaceUp;

          const faceUpOracle = String(actualCard?.oracle_text || '').toLowerCase();
          if (/\bmegamorph\b/.test(faceUpOracle)) {
            const counters = permanent.counters = permanent.counters || {};
            counters['+1/+1'] = (Number(counters['+1/+1']) || 0) + 1;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(morphTurnFaceUp): failed', err);
        }
        break;
      }

      case "phaseOutPermanents": {
        // Phase out multiple permanents
        const pid = (e as any).playerId;
        const permanentIds = (e as any).permanentIds as string[] || [];
        
        try {
          const battlefield = ctx.state.battlefield || [];
          for (const permId of permanentIds) {
            const permanent = battlefield.find((p: any) => p?.id === permId);
            if (permanent && permanent.controller === pid && !permanent.phasedOut) {
              (permanent as any).phasedOut = true;
              (permanent as any).phaseOutController = pid;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(phaseOutPermanents): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
