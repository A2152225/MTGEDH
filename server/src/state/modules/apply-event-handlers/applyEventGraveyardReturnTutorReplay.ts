// server/src/state/modules/apply-event-handlers/applyEventGraveyardReturnTutorReplay.ts
// B47: split from applyEventActivateGraveyardAbilityEvents.ts. Replays graveyard tutor activations
// and return-from-graveyard activations (to hand or battlefield).
// Public entry symbols: replayGraveyardTutorActivation, replayGraveyardReturnActivation.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { filterLibraryCardsForSearch } from "../../../socket/library-search.js";
import { generateDeterministicId, applyRecordedLifePayment } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { applyRecordedBeamUpReturnCost, applyRecordedGraveyardKeywordNonManaCost } from "./applyEventGraveyardCastCostReplay.js"; // B42

/** graveyard abilities that search the library (isTutor). */
export function replayGraveyardTutorActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            const gameId = (ctx as any).gameId;
            if (z && Array.isArray(z.graveyard) && gameId) {
              const graveyard = z.graveyard as any[];
              const card = graveyard.find((c: any) => c && String(c.id) === String(cardId));
              if (card) {
                const manaCost = String((e as any).manaCost || '').trim();
                  const exileSourceOnActivate = (e as any).exileSourceOnActivate === true;
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);
                applyRecordedGraveyardKeywordNonManaCost(ctx, String(pid), (e as any).nonManaCost); // B42
                applyRecordedBeamUpReturnCost(ctx, (e as any).beamedUpPermanentIdsForCost); // B42

                  if (exileSourceOnActivate) {
                    const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === String(cardId));
                    if (cardIndex !== -1) {
                      const [movedCard] = graveyard.splice(cardIndex, 1);
                      z.graveyardCount = graveyard.length;
                      z.exile = Array.isArray((z as any).exile) ? (z as any).exile : [];
                      z.exile.push({ ...movedCard, zone: 'exile' });
                      z.exileCount = z.exile.length;
                      recordCardLeftGraveyardThisTurn(ctx as any, String(pid), movedCard);
                    }
                  }

                const destination = String((e as any).destination || 'hand');
                const searchCriteria = String((e as any).searchCriteria || 'any card');
                const maxSelectionsRaw = Number((e as any).maxSelections);
                const maxSelections = Number.isFinite(maxSelectionsRaw) ? maxSelectionsRaw : 1;
                const filter = ((e as any).filter && typeof (e as any).filter === 'object') ? { ...((e as any).filter as any) } : {};
                const availableCards = filterLibraryCardsForSearch(
                  ctx.libraries.get(pid) || [],
                  filter,
                  ctx.state as any,
                  pid,
                );

                ResolutionQueueManager.addStep(gameId, {
                  type: 'library_search' as any,
                  playerId: pid,
                  sourceId: String(cardId),
                  sourceName: String(card?.name || 'Card'),
                  description: searchCriteria ? `Search for: ${searchCriteria}` : 'Search your library',
                  searchCriteria,
                  minSelections: 0,
                  maxSelections,
                  mandatory: false,
                  destination,
                  reveal: false,
                  shuffleAfter: true,
                  availableCards,
                  filter,
                  splitDestination: (e as any).splitDestination === true,
                  toBattlefield: Number((e as any).toBattlefield || 1),
                  toHand: Number((e as any).toHand || 1),
                  entersTapped: (e as any).entersTapped === true,
                  persistLibrarySearchResolve: true,
                  persistLibrarySearchResolveReason: 'graveyard_ability',
                  persistLibrarySearchResolveAbilityId: String(abilityType || ''),
                } as any);
              }
            }
}

/** return-from-graveyard / graveyard-activated / *-return-*. */
export function replayGraveyardReturnActivation(ctx: GameContext, e: GameEvent, cardId: any, pid: any, abilityType: any): void {
            const destination = String((e as any).destination || '');
            const manaCost = String((e as any).manaCost || '').trim();
            const tappedCreatureIds = Array.isArray((e as any).tappedCreatureIds)
              ? ((e as any).tappedCreatureIds as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (destination === 'hand' || destination === 'battlefield') {
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                const graveyard = z.graveyard as any[];
                const idx = graveyard.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = graveyard.splice(idx, 1);
                  z.graveyardCount = graveyard.length;

                  recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                  const manaPool = (ctx.state as any).manaPool?.[pid];
                  if (manaPool && manaCost) {
                    consumeRecordedManaCostFromPool(manaPool, manaCost);
                  }
                  applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);
                applyRecordedGraveyardKeywordNonManaCost(ctx, String(pid), (e as any).nonManaCost); // B42
                applyRecordedBeamUpReturnCost(ctx, (e as any).beamedUpPermanentIdsForCost); // B42

                  if (tappedCreatureIds.length > 0) {
                    const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                    for (const permanentId of tappedCreatureIds) {
                      const permanent = battlefield.find((entry: any) => entry && String(entry.id) === String(permanentId));
                      if (permanent) {
                        (permanent as any).tapped = true;
                      }
                    }

                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[String(pid)] = true;
                  }

                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  if (destination === 'battlefield') {
                    ctx.state.battlefield = ctx.state.battlefield || [];
                    const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId));
                    (ctx.state.battlefield as any[]).push({
                      id: createdPermanentId,
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      card: { ...card, zone: 'battlefield' },
                    });
                  } else {
                    z.hand = z.hand || [];
                    (z.hand as any[]).push({ ...card, zone: 'hand' });
                    z.handCount = (z.hand as any[]).length;
                  }
                }
              }
            }
}
