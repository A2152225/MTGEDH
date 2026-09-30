// server/src/state/modules/apply-event-handlers/applyEventEffectProgramZoneEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Effect-program driven zone moves and resolved instant/sorcery placement.
// Public entry: applyEffectProgramZoneEvents(ctx, e) -> true when it handled the event.
//
// Handles: moveResolvedInstantOrSorcery, effectProgramZoneMove, putCardFromHandOntoBattlefield
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";
import {
  repairReplayCardSourceZones,
  repairCardIdAwayFromZones,
  isImpossibleFaceUpNonPermanentBattlefieldCard,
  isFaceDownBattlefieldPermanentFlags,
} from "../stackReplayUtils.js";
import { parsePT } from "../../utils";
import { debugWarn } from "../../../utils/debug.js";
import { pickMutablePlayerLibrary, writePlayerLibrary } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { stampPermanentEntryTimestamp } from '../../../../../rules-engine/src/permanentTimestamps.js';

export function applyEffectProgramZoneEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "moveResolvedInstantOrSorcery": {
        try {
          const controller = String((e as any).controller || (e as any).playerId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const destination = String((e as any).destination || 'graveyard').trim().toLowerCase();
          const cardSnapshot = (e as any).card && typeof (e as any).card === 'object' && !Array.isArray((e as any).card)
            ? { ...((e as any).card as any) }
            : null;

          if (!controller || !cardId) break;

          const stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          const stackIndex = stack.findIndex(
            (entry: any) => entry && String(entry?.card?.id || '') === cardId,
          );
          if (stackIndex !== -1) {
            stack.splice(stackIndex, 1);
          }

          if (destination === 'ceased') {
            ctx.bumpSeq();
            break;
          }

          const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
          const playerZones = zones[controller] = zones[controller] || {};
          const card = cardSnapshot || { id: cardId };

          if (destination === 'graveyard') {
            playerZones.graveyard = playerZones.graveyard || [];
            if (!playerZones.graveyard.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              if (pushCardToPlayerGraveyardWithReplacements(ctx, controller as any, card, playerZones.graveyard)) {
                playerZones.graveyardCount = playerZones.graveyard.length;
              }
            }
          } else if (destination === 'exile') {
            playerZones.exile = playerZones.exile || [];
            if (!playerZones.exile.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              playerZones.exile.push({ ...card, zone: 'exile' });
              playerZones.exileCount = playerZones.exile.length;
            }
          } else if (destination === 'library') {
            const lib = ctx.libraries?.get(controller) || [];
            if (!lib.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              lib.push({ ...card, zone: 'library' });
              ctx.libraries?.set(controller, lib);
              playerZones.libraryCount = lib.length;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(moveResolvedInstantOrSorcery): failed', err);
        }
        break;
      }

      case "effectProgramZoneMove": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const fromPlayerId = String((e as any).fromPlayerId || playerId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const fromZone = String((e as any).fromZone || '').trim().toLowerCase();
          const toZone = String((e as any).toZone || '').trim().toLowerCase();
          const permanentId = String((e as any).permanentId || '').trim();
          const fromPermanentId = String((e as any).fromPermanentId || '').trim();
          const cardSnapshot = (e as any).card && typeof (e as any).card === 'object' && !Array.isArray((e as any).card)
            ? { ...((e as any).card as any) }
            : null;

          if (!playerId || !fromZone || !toZone) break;

          if (toZone === 'battlefield' && permanentId) {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            if (battlefield.some((perm: any) => perm && String(perm.id || '') === permanentId)) {
              break;
            }
          } else if (cardId && toZone !== 'library' && toZone !== 'battlefield') {
            const zones = (ctx.state as any).zones || {};
            const dest = zones[playerId] || {};
            const destList = Array.isArray(dest[toZone]) ? dest[toZone] as any[] : [];
            if (destList.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              break;
            }
          }

          let card: any = cardSnapshot ? { ...cardSnapshot } : null;

          if (fromZone === 'battlefield' && fromPermanentId) {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === fromPermanentId);
            if (permIndex !== -1) {
              const [permanent] = battlefield.splice(permIndex, 1);
              if (!card && permanent?.card) {
                card = { ...permanent.card };
              }
            }
          } else if (fromZone === 'library') {
            const lib = pickMutablePlayerLibrary(ctx, fromPlayerId);
            const libIndex = cardId
              ? lib.findIndex((entry: any) => entry && String(entry.id || '') === cardId)
              : -1;
            if (libIndex !== -1) {
              [card] = lib.splice(libIndex, 1);
              writePlayerLibrary(ctx, fromPlayerId, lib);
            }
          } else if (fromZone === 'hand' || fromZone === 'graveyard' || fromZone === 'exile') {
            const zones = (ctx.state as any).zones || {};
            const z = zones[fromPlayerId] || {};
            const sourceList = Array.isArray(z[fromZone]) ? z[fromZone] as any[] : [];
            const sourceIndex = cardId
              ? sourceList.findIndex((entry: any) => entry && String(entry.id || '') === cardId)
              : -1;
            if (sourceIndex !== -1) {
              [card] = sourceList.splice(sourceIndex, 1);
              z[`${fromZone}Count`] = sourceList.length;
            }
          }

          if (!card && cardSnapshot) {
            card = { ...cardSnapshot };
          }

          // Undo/replay can miss the source splice (id drift) and still enter from
          // cardSnapshot — strip any remaining ghost with the same card.id first.
          if (card) {
            const resolvedCardId = String(card.id || cardId || '').trim();
            if (resolvedCardId) {
              if (toZone === 'battlefield') {
                repairReplayCardSourceZones(ctx, fromPlayerId, resolvedCardId);
              } else if (toZone === 'graveyard') {
                repairCardIdAwayFromZones(ctx, fromPlayerId, resolvedCardId, [
                  'hand',
                  'exile',
                  'library',
                ]);
              } else if (toZone === 'exile') {
                repairCardIdAwayFromZones(ctx, fromPlayerId, resolvedCardId, [
                  'hand',
                  'library',
                ]);
              } else if (toZone === 'hand') {
                repairCardIdAwayFromZones(ctx, fromPlayerId, resolvedCardId, [
                  'exile',
                  'library',
                  'graveyard',
                ]);
              }
            }
          }

          if (toZone === 'battlefield' && permanentId && card) {
            if (isImpossibleFaceUpNonPermanentBattlefieldCard(card, e)) {
              // Face-up instants/sorceries cannot enter the battlefield via replay.
              // Divert to graveyard so the physical card is not lost after the source splice.
              const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
              const z = zones[playerId] = zones[playerId] || {
                hand: [],
                handCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
              const gy = z.graveyard as any[];
              if (!gy.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
                pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, gy);
                z.graveyardCount = gy.length;
              }
            } else {
              const battlefield = Array.isArray(ctx.state.battlefield)
                ? ctx.state.battlefield
                : ((ctx.state as any).battlefield = []);
              const typeLine = String(card.type_line || '').toLowerCase();
              const isCreature = typeLine.includes('creature');
              const faceDown = isFaceDownBattlefieldPermanentFlags(e, card);
              battlefield.push({
                id: permanentId,
                controller: String((e as any).controllerId || playerId).trim() || playerId,
                owner: String((e as any).ownerId || (e as any).fromPlayerId || playerId).trim() || playerId,
                tapped: (e as any).tapped === true || (e as any).entersTapped === true,
                counters: {},
                faceDown: faceDown || undefined,
                basePower: isCreature ? parsePT(card.power) : undefined,
                baseToughness: isCreature ? parsePT(card.toughness) : undefined,
                summoningSickness: isCreature,
                card: { ...card, zone: 'battlefield' },
              } as any);
              stampPermanentEntryTimestamp(ctx.state, battlefield[battlefield.length - 1]);
            }
          } else if (toZone === 'library' && card) {
            const lib = pickMutablePlayerLibrary(ctx, playerId);
            if (!lib.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
              const placement = String((e as any).libraryPlacement || '').trim().toLowerCase() === 'bottom'
                ? 'bottom'
                : 'top';
              if (placement === 'bottom') {
                lib.push({ ...card, zone: 'library' });
              } else {
                lib.unshift({ ...card, zone: 'library' });
              }
              writePlayerLibrary(ctx, playerId, lib);
            }
          } else if ((toZone === 'hand' || toZone === 'graveyard' || toZone === 'exile') && card) {
            const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
            const z = zones[playerId] = zones[playerId] || {
              hand: [],
              handCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };
            z[toZone] = Array.isArray(z[toZone]) ? z[toZone] : [];
            const destList = z[toZone] as any[];
            if (!destList.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
              if (toZone === 'graveyard') {
                pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, destList);
              } else {
                destList.push({ ...card, zone: toZone });
              }
              z[`${toZone}Count`] = destList.length;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(effectProgramZoneMove): failed', err);
        }
        break;
      }

      case "putCardFromHandOntoBattlefield": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const tappedAndAttacking = (e as any).tappedAndAttacking === true;
          const cardSnapshot = (e as any).card && typeof (e as any).card === 'object' && !Array.isArray((e as any).card)
            ? { ...((e as any).card as any) }
            : null;

          if (!playerId || !permanentId) break;

          const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
          const z = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };

          let card: any = null;
          if (Array.isArray(z.hand)) {
            const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id || '') === cardId);
            if (handIndex !== -1) {
              [card] = (z.hand as any[]).splice(handIndex, 1);
              z.handCount = (z.hand as any[]).length;
            }
          }

          if (!card && cardSnapshot) {
            card = { ...cardSnapshot };
          }

          // Same undo/replay dual-zone guard as effectProgramZoneMove.
          if (card) {
            const resolvedCardId = String(card.id || cardId || '').trim();
            if (resolvedCardId) {
              repairReplayCardSourceZones(ctx, playerId, resolvedCardId);
            }
          }

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : ((ctx.state as any).battlefield = []);
          const existingPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);

          if (!existingPermanent && card) {
            if (isImpossibleFaceUpNonPermanentBattlefieldCard(card, e)) {
              z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
              const gy = z.graveyard as any[];
              if (!gy.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
                pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, gy);
                z.graveyardCount = gy.length;
              }
            } else {
              const typeLine = String(card.type_line || '').toLowerCase();
              const isCreature = typeLine.includes('creature');
              const faceDown = isFaceDownBattlefieldPermanentFlags(e, card);
              battlefield.push({
                id: permanentId,
                controller: playerId,
                owner: playerId,
                tapped: tappedAndAttacking,
                counters: {},
                faceDown: faceDown || undefined,
                basePower: isCreature ? parsePT(card.power) : undefined,
                baseToughness: isCreature ? parsePT(card.toughness) : undefined,
                summoningSickness: isCreature && !tappedAndAttacking,
                isAttacking: tappedAndAttacking,
                card: { ...card, zone: 'battlefield' },
              } as any);
              stampPermanentEntryTimestamp(ctx.state, battlefield[battlefield.length - 1]);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(putCardFromHandOntoBattlefield): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
